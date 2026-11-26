"""
Multi-dimension bin packing: units -> loads of one capacity profile.

Each unit has a weight (kg), a volume (m³) and a number of pallet spaces; the
capacity limits any of those (None = not limited). A load fits when it is
within the capacity in EVERY limited dimension.

1. First-Fit Decreasing (FFD): sort the units largest first, put each one in
   the first load where it fits in every limited dimension, else open a load.
2. CP-SAT: the 1D model with one capacity constraint per limited dimension,
   warm-started with the FFD answer (which also caps the number of loads).

CP-SAT needs integers, so sizes are scaled (grams, cm³, 1/1000 pallet space)
and rounded CONSERVATIVELY: unit sizes up, capacities down. A load that is
feasible in the integer model is therefore feasible with the real numbers.
Every final load is still checked with the real floats (`exceeded()`); a
CP-SAT answer that fails the check is dropped and FFD is recommended.
"""

import logging
import math
import time
from collections.abc import Sequence
from dataclasses import dataclass

from ortools.sat.python import cp_model

from app.schemas import Capacity, LowerBounds, MethodResult, PackedLoad, PackUnit, SolveResult
from app.solver.core import EPS, exceeded, fill_percent, find_misfits, limited_dims, usage_of

log = logging.getLogger(__name__)

# Integer resolution per dimension for CP-SAT: grams, cm³ and 1/1000 pallet space.
# Coefficients stay below ~1e9 for the largest allowed items and vehicles.
SCALE = {"weight_kg": 1_000, "volume_m3": 1_000_000, "pallets": 1_000}
# Float noise allowance in SCALED units (0.3 m³ * 1e6 = 299999.99999999994 must floor to 300000).
ROUND_TOL = 1e-6
NUM_WORKERS = 8
# Above this many x[i][t] variables the CP-SAT model is not built (FFD is used).
# Measured: ~25k variables (600 units, 43 loads) solve to OPTIMAL in ~7 s in total;
# ~67k (1000 units, 70 loads) find nothing within the 10 s limit, and model building
# in Python grows with the variable count, so larger models only cost time.
MAX_CPSAT_VARS = 50_000

Loads = list[list[int]]  # each load: unit positions (indexes into `units`), in loading order


@dataclass
class _Problem:
    units: list[PackUnit]
    capacity: Capacity
    dims: list[tuple[str, str, float]]  # limited dimensions: (name, attribute, capacity)
    order: list[int]                    # unit positions, largest first
    rank: list[int]                     # rank[i] = index of unit i in `order`


def _size_key(u: PackUnit, dims) -> tuple[float, float]:
    """Largest fraction of the capacity over the limited dimensions, ties by the sum."""
    fractions = [getattr(u, attr) / cap for _, attr, cap in dims]
    return max(fractions), sum(fractions)


def _problem(units: Sequence[PackUnit], capacity: Capacity) -> _Problem:
    units = list(units)
    dims = limited_dims(capacity)
    if not dims:
        raise ValueError("The vehicle has no capacity limit set: set weight, volume or pallets.")
    if any(cap <= 0 for _, _, cap in dims):
        raise ValueError("Vehicle capacities must be greater than zero.")
    if not units:
        raise ValueError("There are no units to pack: the orders have no lines.")
    misfits = find_misfits(units, capacity)
    if misfits:
        raise ValueError(
            f"{len(misfits)} item(s) can never fit the vehicle: "
            + "; ".join(m.message for m in misfits)
        )
    keys = [_size_key(u, dims) for u in units]
    # sorted() is stable, so equal units keep their input order (as the 1D demo did).
    order = sorted(range(len(units)), key=lambda i: (-keys[i][0], -keys[i][1]))
    rank = [0] * len(units)
    for k, i in enumerate(order):
        rank[i] = k
    return _Problem(units, capacity, dims, order, rank)


def lower_bounds(units: Sequence[PackUnit], capacity: Capacity) -> dict[str, int]:
    """ceil(total / capacity) per limited dimension (a small tolerance absorbs float noise)."""
    return {
        dim: max(0, math.ceil(sum(getattr(u, attr) for u in units) / cap - EPS))
        for dim, attr, cap in limited_dims(capacity)
    }


# ---------------------------------------------------------------------------
# First-Fit Decreasing
# ---------------------------------------------------------------------------

def _ffd(p: _Problem) -> tuple[Loads, float]:
    start = time.perf_counter()
    caps = [cap + EPS for _, _, cap in p.dims]
    attrs = [attr for _, attr, _ in p.dims]
    loads: Loads = []
    used: list[list[float]] = []  # per load, per limited dimension
    for i in p.order:
        size = [getattr(p.units[i], a) for a in attrs]
        for t, use in enumerate(used):
            if all(use[d] + size[d] <= caps[d] for d in range(len(caps))):
                loads[t].append(i)
                for d in range(len(caps)):
                    use[d] += size[d]
                break
        else:
            loads.append([i])
            used.append(list(size))
    return loads, time.perf_counter() - start


# ---------------------------------------------------------------------------
# CP-SAT
# ---------------------------------------------------------------------------

def _scaled(value: float, attr: str, *, up: bool) -> int:
    v = value * SCALE[attr]
    return max(0, math.ceil(v - ROUND_TOL) if up else math.floor(v + ROUND_TOL))


def _cpsat(p: _Problem, hint: Loads, lb: int, time_limit_s: float) -> tuple[Loads | None, str, float]:
    """
    x[i][t] = 1 if unit i is in load t, y[t] = 1 if load t is used.
      - every unit in exactly one load; a unit only goes in a used load
      - per limited dimension d and load t: sum size_d[i] * x[i][t] <= cap_d * y[t]
      - y[t] >= y[t+1] and sum(y) >= lower bound
      - symmetry breaking: the k-th largest unit only goes in loads 0..k (in
        particular the largest is in load 0), and identical units are loaded
        in non-decreasing load order
    Minimise sum(y). Returns (loads or None, status name, seconds).
    """
    n, max_loads = len(p.units), len(hint)
    allowed = [min(p.rank[i] + 1, max_loads) for i in range(n)]  # x[i][t] exists for t < allowed[i]
    if sum(allowed) > MAX_CPSAT_VARS:
        log.warning("CP-SAT skipped: %d units x %d loads is too large", n, max_loads)
        return None, "MODEL_TOO_LARGE", 0.0

    model = cp_model.CpModel()
    y = [model.new_bool_var(f"y_{t}") for t in range(max_loads)]
    x = [[model.new_bool_var(f"x_{i}_{t}") for t in range(allowed[i])] for i in range(n)]

    for i in range(n):
        model.add_exactly_one(x[i])

    # sizes[d][i]: unit i in limited dimension d, scaled and rounded up.
    sizes = [[_scaled(getattr(u, attr), attr, up=True) for u in p.units] for _, attr, _ in p.dims]
    for d, (_, attr, cap) in enumerate(p.dims):
        cap_int = _scaled(cap, attr, up=False)
        for t in range(max_loads):
            terms = [sizes[d][i] * x[i][t] for i in range(n) if t < allowed[i] and sizes[d][i] > 0]
            if terms:
                model.add(sum(terms) <= cap_int * y[t])

    # A unit with a size in some limited dimension can't be in an unused load (cap * 0 = 0);
    # units of size 0 everywhere need it said explicitly.
    for i in range(n):
        if not any(s[i] for s in sizes):
            for t in range(allowed[i]):
                model.add_implication(x[i][t], y[t])

    for t in range(max_loads - 1):
        model.add(y[t] >= y[t + 1])
    model.add(sum(y) >= min(lb, max_loads))

    # Identical neighbours in the sorted order: load(a) <= load(b). FFD satisfies this too.
    for k in range(n - 1):
        a, b = p.order[k], p.order[k + 1]
        if all(getattr(p.units[a], attr) == getattr(p.units[b], attr) for _, attr, _ in p.dims):
            model.add(sum(t * v for t, v in enumerate(x[a])) <= sum(t * v for t, v in enumerate(x[b])))

    # Warm start from FFD. FFD opens loads in sorted order, so its k-th unit is in a load <= k.
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
    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return None, name, elapsed

    loads: Loads = []
    for t in range(max_loads):
        if solver.value(y[t]):
            members = [i for i in range(n) if t < allowed[i] and solver.value(x[i][t])]
            if members:
                loads.append(sorted(members, key=p.rank.__getitem__))  # largest first
    return loads, name, elapsed


# ---------------------------------------------------------------------------
# Results
# ---------------------------------------------------------------------------

def _problems_with(p: _Problem, loads: Loads) -> str | None:
    """Why `loads` is not a valid packing (checked with the real floats), or None."""
    placed = sorted(i for load in loads for i in load)
    if placed != list(range(len(p.units))):
        return "not every unit is placed exactly once"
    for number, load in enumerate(loads, start=1):
        over = exceeded(usage_of(p.units[i] for i in load), p.capacity)
        if over:
            return f"load {number} is over capacity in {', '.join(over)}"
    return None


def _method_result(p: _Problem, loads: Loads, drop_order: list[int], seconds: float,
                   status: str, optimal: bool) -> MethodResult:
    packed = []
    for number, load in enumerate(loads, start=1):
        usage = usage_of(p.units[i] for i in load)
        packed.append(PackedLoad(
            number=number,
            unit_ids=[p.units[i].id for i in load],
            usage=usage,
            fill_percent=fill_percent(usage, p.capacity),
        ))
    return MethodResult(
        num_loads=len(loads),
        loads=packed,
        solve_time_ms=round(seconds * 1000, 3),
        drop_order=[p.units[i].id for i in drop_order],
        optimal=optimal,
        status=status,
    )


def solve(units: Sequence[PackUnit], capacity: Capacity,
          time_limit_s: float = 10.0) -> tuple[SolveResult, str]:
    """`pack()`, plus the CP-SAT status name (kept even when `ortools` is None)."""
    p = _problem(units, capacity)
    per_dim = lower_bounds(p.units, capacity)
    lb = max(1, *per_dim.values())  # at least one load when there are units

    ffd_loads, ffd_time = _ffd(p)
    problem = _problems_with(p, ffd_loads)
    if problem:  # FFD checks every dimension, so this is a bug
        raise RuntimeError(f"FFD produced an invalid packing: {problem}")
    ffd = _method_result(p, ffd_loads, p.order, ffd_time, "HEURISTIC", len(ffd_loads) == lb)

    cp_loads, cp_status, cp_time = _cpsat(p, ffd_loads, lb, time_limit_s)
    ortools = None
    if cp_loads is not None:
        problem = _problems_with(p, cp_loads)
        if problem:
            log.error("Discarding the CP-SAT solution (%s); using FFD", problem)
        else:
            optimal = cp_status == "OPTIMAL" or len(cp_loads) == lb
            drop = [i for load in cp_loads for i in load]
            ortools = _method_result(p, cp_loads, drop, cp_time, cp_status, optimal)

    recommended = "ortools" if ortools is not None and ortools.num_loads <= ffd.num_loads else "ffd"
    result = SolveResult(
        capacity=capacity,
        totals=usage_of(p.units),
        lower_bound=lb,
        lower_bounds=LowerBounds(**per_dim),
        units=p.units,
        ffd=ffd,
        ortools=ortools,
        recommended=recommended,
        time_limit_s=time_limit_s,
    )
    return result, cp_status


def pack(units: Sequence[PackUnit], capacity: Capacity, time_limit_s: float = 10.0) -> SolveResult:
    """
    Pack `units` into the fewest loads of `capacity`, with multi-dimension FFD
    and CP-SAT (warm-started from FFD, `time_limit_s` limit), and return both.
    Raises ValueError if any unit can't fit (see find_misfits) or there are no units.
    """
    return solve(units, capacity, time_limit_s)[0]
