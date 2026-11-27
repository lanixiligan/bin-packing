"""
Bin packing with Google OR-Tools CP-SAT: put every unit in the fewest trucks.

Each unit has a weight (kg) and may take pallet spaces; a truck limits weight
and, optionally, pallet spaces. A truck's load fits when it is within the
limit in every limited dimension.

The CP-SAT model:
  x[i][t] = 1 if unit i is in truck t, y[t] = 1 if truck t is used.
  - every unit in exactly one truck; a unit only goes in a used truck
  - per limited dimension and truck: sum of sizes <= capacity * y[t]
  - y[t] >= y[t+1] and sum(y) >= the lower bound
  - symmetry breaking: the k-th largest unit only goes in trucks 0..k, and
    identical units are loaded in non-decreasing truck order
  - dangerous goods: z[g][t] = "DG group g is in truck t", and
    z[g][t] + z[h][t] <= 1 for every incompatible pair (ADG Table 9.1/9.2)
  Minimise sum(y).

CP-SAT needs integers, so sizes are scaled (grams, 1/1000 pallet space) and
rounded CONSERVATIVELY: unit sizes up, capacities down, so an integer answer
always fits with the real numbers too. Every answer is re-checked with the
real floats before it is returned.

A quick first-fit packing (largest first) gives CP-SAT a starting solution
and caps the number of trucks; CP-SAT then improves on it and proves when no
better packing exists.
"""

import math
import time
from collections.abc import Sequence
from dataclasses import dataclass

from ortools.sat.python import cp_model

from app import dg as dgrules

EPS = 1e-9  # float tolerance for capacity checks
# Integer resolution per dimension for CP-SAT: grams and 1/1000 pallet space.
SCALE = {"weight_kg": 1_000, "pallets": 1_000}
# Float noise allowance in SCALED units (0.3 * 1000 = 299.99999999999994 must floor to 300).
ROUND_TOL = 1e-6
NUM_WORKERS = 8


@dataclass(frozen=True)
class Capacity:
    """Per-truck limits; None = not limited (weight is always set in the demo)."""
    weight_kg: float | None = None
    pallets: float | None = None


@dataclass(frozen=True)
class Unit:
    id: int
    name: str
    weight_kg: float
    pallets: float = 0
    dg: dgrules.DgInfo | None = None   # incompatible units never share a truck


@dataclass
class Solution:
    loads: list[list[int]]       # unit ids per truck, largest first
    lower_bound: int             # max over the limited dimensions
    lower_bounds: dict[str, int]  # ceil(total / capacity) per limited dimension
    status: str                  # CP-SAT status: "OPTIMAL", "FEASIBLE" ("UNKNOWN": starting packing)
    optimal: bool                # proven optimal, or equal to the lower bound
    solve_time_ms: float


def _dims(capacity: Capacity) -> list[tuple[str, str, float]]:
    """(dimension, attribute, capacity) for every dimension `capacity` limits."""
    out = []
    for dim, attr in (("weight", "weight_kg"), ("pallets", "pallets")):
        cap = getattr(capacity, attr)
        if cap is not None:
            out.append((dim, attr, float(cap)))
    return out


def _scaled(value: float, attr: str, *, up: bool) -> int:
    v = value * SCALE[attr]
    return max(0, math.ceil(v - ROUND_TOL) if up else math.floor(v + ROUND_TOL))


def _dg_groups(units: Sequence[Unit]) -> tuple[list[int], set[tuple[int, int]]]:
    """(group of each unit, incompatible group pairs g < h). Units with the same DG
    data share a group; general freight is one group."""
    keys: dict[str, int] = {}
    profiles: list[dgrules.DgInfo | None] = []
    group: list[int] = []
    for u in units:
        k = "" if dgrules.is_general(u.dg) else u.dg.key()
        if k not in keys:
            keys[k] = len(profiles)
            profiles.append(None if k == "" else u.dg)
        group.append(keys[k])
    pairs = {(g, h) for g in range(len(profiles)) for h in range(g + 1, len(profiles))
             if dgrules.conflicts(profiles[g], profiles[h])}
    return group, pairs


def lower_bounds(units: Sequence[Unit], capacity: Capacity) -> dict[str, int]:
    """ceil(total / capacity) per limited dimension (a small tolerance absorbs float noise)."""
    return {
        dim: max(0, math.ceil(sum(getattr(u, attr) for u in units) / cap - EPS))
        for dim, attr, cap in _dims(capacity)
    }


def _first_fit(units, order, dims, group, conflicts) -> list[list[int]]:
    """Largest first, each unit into the first truck where it fits: CP-SAT's starting point."""
    caps = [cap + EPS for _, _, cap in dims]
    loads: list[list[int]] = []
    used: list[list[float]] = []
    groups: list[set[int]] = []
    for i in order:
        size = [getattr(units[i], attr) for _, attr, _ in dims]
        g = group[i]
        for t, use in enumerate(used):
            if all(use[d] + size[d] <= caps[d] for d in range(len(caps))) \
                    and not any((min(g, h), max(g, h)) in conflicts for h in groups[t]):
                loads[t].append(i)
                groups[t].add(g)
                for d in range(len(caps)):
                    use[d] += size[d]
                break
        else:
            loads.append([i])
            used.append(list(size))
            groups.append({g})
    return loads


def solve(units: Sequence[Unit], capacity: Capacity, time_limit_s: float = 10.0) -> Solution:
    """
    Pack `units` into the fewest trucks of `capacity` with CP-SAT (`time_limit_s` limit).
    Raises ValueError for no units, no limit, or a unit that can never fit, and
    RuntimeError if the packing fails the final check (a bug). If CP-SAT finds
    nothing within the time limit, its first-fit starting packing is returned
    (`status` then says why, e.g. "UNKNOWN").
    """
    units = list(units)
    dims = _dims(capacity)
    if not dims or any(cap <= 0 for _, _, cap in dims):
        raise ValueError("Set a capacity greater than zero.")
    if not units:
        raise ValueError("There are no units to pack.")
    for u in units:
        over = [dim for dim, attr, cap in dims if getattr(u, attr) > cap + EPS]
        if over:
            raise ValueError(f"'{u.name}' can never fit a truck ({', '.join(over)}).")

    per_dim = lower_bounds(units, capacity)
    lb = max(1, *per_dim.values())
    n = len(units)
    # Largest first: by the largest fraction of any limit, ties by the sum (stable sort).
    fracs = [[getattr(u, attr) / cap for _, attr, cap in dims] for u in units]
    order = sorted(range(n), key=lambda i: (-max(fracs[i]), -sum(fracs[i])))
    rank = [0] * n
    for k, i in enumerate(order):
        rank[i] = k
    group, conflicts = _dg_groups(units)

    hint = _first_fit(units, order, dims, group, conflicts)
    max_loads = len(hint)
    allowed = [min(rank[i] + 1, max_loads) for i in range(n)]  # x[i][t] exists for t < allowed[i]

    model = cp_model.CpModel()
    y = [model.new_bool_var(f"y_{t}") for t in range(max_loads)]
    x = [[model.new_bool_var(f"x_{i}_{t}") for t in range(allowed[i])] for i in range(n)]
    for i in range(n):
        model.add_exactly_one(x[i])

    sizes = [[_scaled(getattr(u, attr), attr, up=True) for u in units] for _, attr, _ in dims]
    for d, (_, attr, cap) in enumerate(dims):
        cap_int = _scaled(cap, attr, up=False)
        for t in range(max_loads):
            terms = [sizes[d][i] * x[i][t] for i in range(n) if t < allowed[i] and sizes[d][i] > 0]
            if terms:
                model.add(sum(terms) <= cap_int * y[t])
    # Units of size 0 in every limited dimension still need a used truck.
    for i in range(n):
        if not any(s[i] for s in sizes):
            for t in range(allowed[i]):
                model.add_implication(x[i][t], y[t])

    if conflicts:
        involved = sorted({g for pair in conflicts for g in pair})
        z = {g: [model.new_bool_var(f"z_{g}_{t}") for t in range(max_loads)] for g in involved}
        for i in range(n):
            if group[i] in z:
                for t in range(allowed[i]):
                    model.add_implication(x[i][t], z[group[i]][t])
        for g, h in conflicts:
            for t in range(max_loads):
                model.add_at_most_one(z[g][t], z[h][t])

    for t in range(max_loads - 1):
        model.add(y[t] >= y[t + 1])
    model.add(sum(y) >= min(lb, max_loads))

    # Identical neighbours in the sorted order: truck(a) <= truck(b).
    for k in range(n - 1):
        a, b = order[k], order[k + 1]
        same_size = all(getattr(units[a], attr) == getattr(units[b], attr) for _, attr, _ in dims)
        if group[a] == group[b] and same_size:
            model.add(sum(t * v for t, v in enumerate(x[a])) <= sum(t * v for t, v in enumerate(x[b])))

    where = {i: t for t, load in enumerate(hint) for i in load}
    for i in range(n):
        for t in range(allowed[i]):
            model.add_hint(x[i][t], where[i] == t)
    for t in range(max_loads):
        model.add_hint(y[t], True)

    model.minimize(sum(y))
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = max(float(time_limit_s), 0.01)
    solver.parameters.num_workers = NUM_WORKERS
    start = time.perf_counter()
    status = solver.solve(model)
    elapsed = time.perf_counter() - start
    name = solver.status_name(status)
    if status in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        loads = []
        for t in range(max_loads):
            members = [i for i in range(n) if t < allowed[i] and solver.value(x[i][t])]
            if members:
                loads.append(sorted(members, key=rank.__getitem__))
    else:
        # Rare (a big input on a busy machine): no CP-SAT answer within the time
        # limit. Return its starting packing, reported as not proven.
        loads = hint
    _check(units, loads, dims, group, conflicts)
    return Solution(
        loads=[[units[i].id for i in load] for load in loads],
        lower_bound=lb,
        lower_bounds=per_dim,
        status=name,
        optimal=name == "OPTIMAL" or len(loads) == lb,
        solve_time_ms=round(elapsed * 1000, 1),
    )


def _check(units, loads, dims, group, conflicts) -> None:
    """Re-check the packing with the real floats (a failure here is a bug)."""
    if sorted(i for load in loads for i in load) != list(range(len(units))):
        raise RuntimeError("OR-Tools packing does not place every unit exactly once.")
    for number, load in enumerate(loads, start=1):
        for dim, attr, cap in dims:
            if sum(getattr(units[i], attr) for i in load) > cap + EPS:
                raise RuntimeError(f"OR-Tools packing: truck {number} is over capacity in {dim}.")
        gs = {group[i] for i in load}
        if any((g, h) in conflicts for g in gs for h in gs):
            raise RuntimeError(f"OR-Tools packing: truck {number} carries incompatible dangerous goods.")
