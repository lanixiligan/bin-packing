"""
Sized bin packing with Google OR-Tools CP-SAT: put every item in the fewest trucks.

Each item has a footprint (length x width, mm), a height and a weight. A truck is
one or more cargo decks (a rectangle with an inside height) and a payload. An item
stands on a deck as an axis-aligned rectangle, possibly turned 90 degrees, or on top
of a column of items with the same footprint (stacking, see `Item.key`).

The CP-SAT model (all integers: mm and kg):
  a[i][t][d] = item i is on deck d of truck t; y[t] = truck t is used.
  floor[i]   = i stands on the floor; base[i][b] = i stands in the column of b.
  - every item on exactly one deck of one truck; trucks used in order 0, 1, ...
  - weight per truck <= payload * y[t]
  - each item is a floor item or sits in exactly one column; a column's base is
    a stackable floor item with the same footprint, on the same deck, and the
    column (base plus everything on it) fits under that deck's inside height
  - floor items are rectangles (x, y, optional 90 degree turn) inside their deck;
    on one deck they never overlap (NoOverlap2D with optional intervals per deck)
  - dangerous goods: z[g][t] = "DG group g is in truck t", and
    z[g][t] + z[h][t] <= 1 for every incompatible pair (ADG Table 9.1/9.2)
  - optional axle limits (`Truck.axle_limits`, see "Axle limits" below)
  Minimise sum(y).

Axle limits: an axle group's load is linear in each item's weight and position, so a limit is a
linear constraint. For an item of weight w whose centre is x mm from the front of deck d, the
group takes w * (alpha_d + beta_d * x) (`AxleLimit.coef`, from the planner's beam model). With
c2[i] = twice the centre of item i's column (2x + length for a floor item, its base's for a
stacked one) and g[i][t][d] = c2[i] if a[i][t][d] else 0, per truck and group:
    sum_i sum_d  A[i][d] * a[i][t][d] + B[i][d] * g[i][t][d]  <=  cap * y[t]
where A = ceil(w * alpha * AXLE_SCALE), B = ceil(w * beta * AXLE_SCALE / 2) and
cap = floor(cap_kg * AXLE_SCALE). Every variable is >= 0, so rounding the coefficients up and the
cap down makes the integer model at least as tight as the real one: a packing it accepts never
overloads a group. The greedy start uses the same integers, so its packing is a valid hint.
Without axle limits none of this is built and the model is exactly the one above.

Symmetry breaking: the k-th item (largest footprint first) only goes in trucks
0..k, identical neighbours go in non-decreasing truck order, and a column's base
is its first member in that order (the members of a column can be swapped
freely, so the reported column is reordered heaviest at the bottom afterwards).

A greedy packing (largest footprint first; stack into an existing column when
possible, else the front-most free spot on a deck, else a new truck) caps the
number of trucks and is passed to CP-SAT as a hint. If CP-SAT finds nothing in
the time limit, the greedy packing is returned. Every answer is re-checked
geometrically (`_check`) before it is returned.
"""

import math
import time
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field

from ortools.sat.python import cp_model

from app import dg as dgrules

NUM_WORKERS = 8
# Axle constraints are scaled to integers: 1 kg = AXLE_SCALE. Rounding costs each item at most
# (1 + twice the deck length in mm) / AXLE_SCALE kg of a group's capacity (under 0.03 kg).
AXLE_SCALE = 1_000_000


@dataclass(frozen=True)
class DeckSpec:
    id: str
    name: str
    length: int   # mm along x
    width: int    # mm along y
    height: int   # inside height, mm


@dataclass(frozen=True)
class AxleLimit:
    """One axle group's limit on the freight. An item of weight w with its centre x mm from the
    front of deck d adds w * (alpha + beta * x) kg to the group, (alpha, beta) = coef[d]."""
    name: str
    cap_kg: float                             # the group's limit minus its unladen (tare) load
    coef: tuple[tuple[float, float], ...]     # per Truck.decks: (alpha, beta)

    def share(self, deck: int, centre_mm: float) -> float:
        """The part of a load at `centre_mm` on `deck` that this group carries (can be negative)."""
        alpha, beta = self.coef[deck]
        return alpha + beta * centre_mm


@dataclass(frozen=True)
class Truck:
    payload_kg: int
    decks: tuple[DeckSpec, ...]
    name: str = "truck"
    axle_limits: tuple[AxleLimit, ...] = ()   # empty: axle loads are not limited
    max_floor_mm2: int | None = None          # cap on the floor area in use (None: the decks' area)

    @property
    def floor_mm2(self) -> int:
        """Usable floor area: the decks', or `max_floor_mm2` when that is less."""
        area = sum(d.length * d.width for d in self.decks)
        return area if self.max_floor_mm2 is None else min(area, self.max_floor_mm2)

    @property
    def volume_mm3(self) -> int:
        return sum(d.length * d.width * d.height for d in self.decks)


def loose_key(length: int, width: int) -> str:
    return f"loose:{min(length, width)}x{max(length, width)}"


def pallet_key(pallet_id: str) -> str:
    return f"pallet:{pallet_id}"


@dataclass(frozen=True)
class Item:
    id: int
    name: str
    weight: int
    length: int
    width: int
    height: int
    stackable: bool = False
    footprint: str = ""                 # stacking key (pallet_key / loose_key); "" = loose_key(L, W)
    dg: dgrules.DgInfo | None = None    # incompatible items never share a truck

    @property
    def key(self) -> str:
        return self.footprint or loose_key(self.length, self.width)

    @property
    def area(self) -> int:
        return self.length * self.width


@dataclass(frozen=True)
class Placed:
    id: int          # the item's id
    truck: int       # 0-based
    deck: int        # index into Truck.decks
    x: int
    y: int
    z: int
    length: int      # extent along x, after any turn
    width: int       # extent along y
    height: int
    rotated: bool
    base: int        # id of the column's floor item (its own id on the floor)
    level: int       # 0 on the floor


@dataclass
class Solution:
    trucks: list[list[Placed]]   # per truck: floor items first (by deck, x, y), then upper levels
    lower_bound: int
    lower_bounds: dict[str, int]
    status: str                  # CP-SAT status: "OPTIMAL", "FEASIBLE" ("UNKNOWN": greedy packing)
    optimal: bool                # proven optimal, or equal to the lower bound
    solve_time_ms: float


@dataclass
class _Column:
    """A floor footprint on one deck and the items standing in it (members[0] at the bottom)."""
    truck: int
    deck: int
    x: int
    y: int
    lx: int
    ly: int
    members: list[int] = field(default_factory=list)   # item indices
    top: int = 0


def _ceil(a: int, b: int) -> int:
    return -(-a // b)


def _can_stack(a: Item, b: Item) -> bool:
    return a.stackable and b.stackable and a.key == b.key


def _orientations(item: Item, deck: DeckSpec) -> list[tuple[int, int]]:
    """(extent along x, extent along y) for each way the footprint fits the deck."""
    out = []
    if item.length <= deck.length and item.width <= deck.width:
        out.append((item.length, item.width))
    if item.length != item.width and item.width <= deck.length and item.length <= deck.width:
        out.append((item.width, item.length))
    return out


def _fits(item: Item, deck: DeckSpec) -> bool:
    return item.height <= deck.height and bool(_orientations(item, deck))


# ---------------------------------------------------------------------------
# Axle limits (integers, see the module docstring)
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class _Axle:
    """One axle group's constraint in integers: sum(A[d] + B[d] * c2) <= cap over a truck's items,
    c2 = twice the centre of the item's column on deck d."""
    name: str
    cap: int
    a: tuple[tuple[int, ...], ...]   # [item][deck]
    b: tuple[tuple[int, ...], ...]   # [item][deck]


def _axles(items: Sequence[Item], truck: Truck) -> list[_Axle]:
    """The integer axle constraints, without the groups that the payload alone keeps under their
    limit (wherever the freight stands)."""
    out = []
    for lim in truck.axle_limits:
        worst = max(max(lim.share(d, 0), lim.share(d, deck.length)) for d, deck in enumerate(truck.decks))
        if max(worst, 0.0) * truck.payload_kg <= lim.cap_kg:
            continue
        out.append(_Axle(
            name=lim.name, cap=math.floor(lim.cap_kg * AXLE_SCALE),
            a=tuple(tuple(math.ceil(it.weight * alpha * AXLE_SCALE) for alpha, _ in lim.coef)
                    for it in items),
            b=tuple(tuple(math.ceil(it.weight * beta * AXLE_SCALE / 2) for _, beta in lim.coef)
                    for it in items)))
    return out


def _axle_x_range(axles: Sequence[_Axle], loads: Sequence[int], i: int, d: int, lx: int,
                  deck: DeckSpec) -> tuple[int, int] | None:
    """(lowest, highest) x at which item `i`, `lx` long, may stand on deck `d` of a truck whose
    groups already carry `loads`, or None when no x keeps every group within its limit."""
    lo, hi = 0, deck.length - lx
    for ax, load in zip(axles, loads, strict=True):
        spare, slope = ax.cap - load - ax.a[i][d], ax.b[i][d]   # need slope * (2x + lx) <= spare
        if slope == 0:
            if spare < 0:
                return None
        elif slope > 0:
            hi = min(hi, (spare // slope - lx) // 2)
        else:
            lo = max(lo, _ceil(_ceil(-spare, -slope) - lx, 2))
    return (lo, hi) if lo <= hi else None


def never_fit_reasons(item: Item, truck: Truck) -> list[str]:
    """Why `item` can never travel on an otherwise empty `truck` (empty list: it can)."""
    out = []
    if item.weight > truck.payload_kg:
        out.append(f"'{item.name}' weighs {item.weight:,} kg and the payload is {truck.payload_kg:,} kg")
    decks = [(d, deck) for d, deck in enumerate(truck.decks) if _fits(item, deck)]
    if not decks:
        longest = max(d.length for d in truck.decks)
        widest = max(d.width for d in truck.decks)
        tallest = max(d.height for d in truck.decks)
        reasons = []
        if item.height > tallest:
            reasons.append(f"'{item.name}' is {item.height:,} mm tall and the inside height is "
                           f"{tallest:,} mm")
        if max(item.length, item.width) > longest:
            reasons.append(f"'{item.name}' is {max(item.length, item.width):,} mm long and the longest deck "
                           f"is {longest:,} mm")
        elif min(item.length, item.width) > widest:
            reasons.append(f"'{item.name}' is {min(item.length, item.width):,} mm wide and the widest deck "
                           f"is {widest:,} mm")
        if not reasons:
            reasons.append(f"'{item.name}' ({item.length:,} x {item.width:,} x {item.height:,} mm) fits no "
                           f"deck either way round")
        return out + reasons
    if item.area > truck.floor_mm2:
        out.append(f"'{item.name}' takes {item.area / 1e6:.1f} m2 of floor and the truck has "
                   f"{truck.floor_mm2 / 1e6:.1f} m2")
    if truck.axle_limits and item.weight <= truck.payload_kg:
        axles = _axles([item], truck)
        empty = [0] * len(axles)
        if not any(_axle_x_range(axles, empty, 0, d, lx, deck) for d, deck in decks
                   for lx, _ in _orientations(item, deck)):
            names = [ax.name for k, ax in enumerate(axles)
                     if not any(_axle_x_range(axles[k:k + 1], [0], 0, d, lx, deck) for d, deck in decks
                                for lx, _ in _orientations(item, deck))]
            groups = " and the ".join(names) if names else "axle groups"
            out.append(f"'{item.name}' weighs {item.weight:,} kg and would overload the {groups} wherever "
                       f"it stands")
    return out


def never_fit(items: Sequence[Item], truck: Truck) -> list[str]:
    """Why each item that can never travel on `truck` doesn't fit (empty = all can)."""
    return [reason for it in items for reason in never_fit_reasons(it, truck)]


def lower_bounds(items: Sequence[Item], truck: Truck) -> dict[str, int]:
    """No packing can use fewer trucks than any of these (DG segregation and geometry ignored)."""
    return {
        "weight": _ceil(sum(it.weight for it in items), truck.payload_kg),
        "volume": _ceil(sum(it.area * it.height for it in items), truck.volume_mm3),
        "floor": _ceil(sum(it.area for it in items if not it.stackable), truck.floor_mm2),
    }


def _dg_groups(items: Sequence[Item]) -> tuple[list[int], set[tuple[int, int]]]:
    """(group of each item, incompatible group pairs g < h). Items with the same DG
    data share a group; general freight is one group."""
    keys: dict[str, int] = {}
    profiles: list[dgrules.DgInfo | None] = []
    group: list[int] = []
    for it in items:
        k = "" if dgrules.is_general(it.dg) else it.dg.key()
        if k not in keys:
            keys[k] = len(profiles)
            profiles.append(None if k == "" else it.dg)
        group.append(keys[k])
    pairs = {(g, h) for g in range(len(profiles)) for h in range(g + 1, len(profiles))
             if dgrules.conflicts(profiles[g], profiles[h])}
    return group, pairs


dg_groups = _dg_groups


# ---------------------------------------------------------------------------
# Greedy starting packing
# ---------------------------------------------------------------------------

def _overlaps(ax, ay, alx, aly, bx, by, blx, bly) -> bool:
    return ax < bx + blx and bx < ax + alx and ay < by + bly and by < ay + aly


def _floor_spot(cols: list[_Column], item: Item, deck: DeckSpec,
                x_range: Callable[[int], tuple[int, int] | None] | None = None,
                ) -> tuple[int, int, int, int] | None:
    """(x, y, lx, ly) of the front-most free spot for `item` on a deck holding `cols`, or None.
    Candidate corners come from the edges of the footprints already there. `x_range(lx)` narrows
    the x allowed for an `lx` long footprint to (lowest, highest), or None for nowhere (axle
    limits); its lowest x is a candidate too."""
    edges = {0, *(c.x + c.lx for c in cols)}
    ys = sorted({0, *(c.y + c.ly for c in cols)})
    best = None
    for lx, ly in _orientations(item, deck):
        xs = sorted(edges)
        if x_range is not None:
            allowed = x_range(lx)
            if allowed is None:
                continue
            xs = sorted(x for x in edges | {allowed[0]} if allowed[0] <= x <= allowed[1])
        found = None
        for x in xs:
            if x + lx > deck.length:
                break
            for y in ys:
                if y + ly > deck.width:
                    break
                if not any(_overlaps(x, y, lx, ly, c.x, c.y, c.lx, c.ly) for c in cols):
                    found = (x + lx, y, x, lx, ly)
                    break
            if found:
                break
        if found and (best is None or found < best):
            best = found
    if best is None:
        return None
    _, y, x, lx, ly = best
    return x, y, lx, ly


def _greedy(items: Sequence[Item], truck: Truck, order: list[int], group: list[int],
            conflicts: set[tuple[int, int]], axles: Sequence[_Axle] = ()) -> list[_Column]:
    """Largest footprint first: into an existing column if it can stack there, else the
    front-most free floor spot of the first truck that takes it, else a new truck. A column or
    spot that would push an axle group over its limit (`axles`) is skipped."""
    cols: list[_Column] = []
    on_deck: dict[tuple[int, int], list[_Column]] = {}
    load: list[int] = []
    floor: list[int] = []
    groups: list[set[int]] = []
    axle_load: list[list[int]] = []

    def takes(t: int, i: int) -> bool:
        g = group[i]
        return (load[t] + items[i].weight <= truck.payload_kg
                and not any((min(g, h), max(g, h)) in conflicts for h in groups[t]))

    def axle_add(i: int, d: int, c2: int) -> list[int]:
        return [ax.a[i][d] + ax.b[i][d] * c2 for ax in axles]

    def axles_take(c: _Column, i: int) -> bool:
        extra = axle_add(i, c.deck, 2 * c.x + c.lx)
        return all(now + more <= ax.cap
                   for ax, now, more in zip(axles, axle_load[c.truck], extra, strict=True))

    def add(c: _Column, i: int) -> None:
        load[c.truck] += items[i].weight
        groups[c.truck].add(group[i])
        extra = axle_add(i, c.deck, 2 * c.x + c.lx)
        axle_load[c.truck] = [now + more for now, more in zip(axle_load[c.truck], extra, strict=True)]

    for i in order:
        it = items[i]
        col = next((c for c in cols if it.stackable and _can_stack(it, items[c.members[0]])
                    and c.top + it.height <= truck.decks[c.deck].height and takes(c.truck, i)
                    and axles_take(c, i)), None)
        if col is not None:
            col.members.append(i)
            col.top += it.height
            add(col, i)
            continue
        t = 0
        while True:
            if t == len(load):
                load.append(0)
                floor.append(0)
                groups.append(set())
                axle_load.append([0] * len(axles))
            if takes(t, i) and floor[t] + it.area <= truck.floor_mm2:
                spot = None
                for d, deck in enumerate(truck.decks):
                    if it.height <= deck.height:
                        x_range = None
                        if axles:
                            def x_range(lx, i=i, t=t, d=d, deck=deck):
                                return _axle_x_range(axles, axle_load[t], i, d, lx, deck)
                        spot = _floor_spot(on_deck.get((t, d), []), it, deck, x_range)
                        if spot:
                            break
                if spot:
                    c = _Column(t, d, *spot, members=[i], top=it.height)
                    cols.append(c)
                    on_deck.setdefault((t, d), []).append(c)
                    floor[t] += it.area
                    add(c, i)
                    break
            t += 1
            if t > len(items) + 1:
                raise RuntimeError(f"Greedy packing could not place '{it.name}'.")
    return cols


def _signature(it: Item, g: int) -> tuple:
    return (it.length, it.width, it.height, it.weight, it.stackable, it.key, g)


def _canonical(cols: list[_Column], order: list[int], rank: list[int], sig: list[tuple]) -> None:
    """Rewrite a packing (in place) so it obeys the model's symmetry breaking: identical
    neighbours in non-decreasing truck order, trucks numbered by their first item, and each
    column's first member is its base."""
    where = {i: (c, k) for c in cols for k, i in enumerate(c.members)}
    start = 0
    while start < len(order):
        end = start
        while end + 1 < len(order) and sig[order[end + 1]] == sig[order[start]]:
            end += 1
        run = order[start:end + 1]
        if len(run) > 1:
            spots = sorted((where[i] for i in run), key=lambda ck: ck[0].truck)
            for i, (c, k) in zip(run, spots, strict=True):
                c.members[k] = i
                where[i] = (c, k)
        start = end + 1
    first: dict[int, int] = {}
    for c in cols:
        for i in c.members:
            first[c.truck] = min(first.get(c.truck, len(rank)), rank[i])
    renumber = {t: k for k, t in enumerate(sorted(first, key=first.__getitem__))}
    for c in cols:
        c.truck = renumber[c.truck]
        c.members.sort(key=rank.__getitem__)


# ---------------------------------------------------------------------------
# Solve
# ---------------------------------------------------------------------------

def solve(items: Sequence[Item], truck: Truck, time_limit_s: float = 10.0) -> Solution:
    """
    Pack `items` into the fewest trucks with CP-SAT (`time_limit_s` limit).
    Raises ValueError for no items or an item that can never fit (the message names
    them and why), and RuntimeError if the packing fails the final check (a bug).
    If CP-SAT finds nothing within the time limit, the greedy packing is returned
    (`status` then says why, e.g. "UNKNOWN").
    """
    items = list(items)
    if not items:
        raise ValueError("There are no shipments to pack.")
    if not truck.decks or truck.payload_kg <= 0:
        raise ValueError("The truck has no cargo deck or no payload.")
    problems = never_fit(items, truck)
    if problems:
        raise ValueError(f"These shipments can never fit a {truck.name}: " + "; ".join(problems) + ".")

    per_bound = lower_bounds(items, truck)
    lb = max(1, *per_bound.values())
    n = len(items)
    group, conflicts = _dg_groups(items)
    order = sorted(range(n), key=lambda i: (-items[i].area, -items[i].height, -items[i].weight,
                                            items[i].key, group[i]))
    rank = [0] * n
    for k, i in enumerate(order):
        rank[i] = k
    sig = [_signature(items[i], group[i]) for i in range(n)]

    axles = _axles(items, truck)

    start = time.perf_counter()
    hint = _greedy(items, truck, order, group, conflicts, axles) if axles \
        else _greedy(items, truck, order, group, conflicts)
    _canonical(hint, order, rank, sig)
    _check(items, truck, _finish(items, hint, rank), group, conflicts)  # a greedy bug shows up here
    num_trucks = 1 + max(c.truck for c in hint)

    model, var = _build_model(items, truck, num_trucks, lb, order, rank, sig, group, conflicts, axles)
    _add_hints(model, var, items, hint, num_trucks)

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = max(float(time_limit_s) - (time.perf_counter() - start), 0.05)
    solver.parameters.num_workers = NUM_WORKERS
    status = solver.solve(model)
    name = solver.status_name(status)
    cols = _extract(solver, var, items) if status in (cp_model.OPTIMAL, cp_model.FEASIBLE) else hint
    elapsed = time.perf_counter() - start

    trucks = _finish(items, cols, rank)
    _check(items, truck, trucks, group, conflicts)
    return Solution(
        trucks=trucks,
        lower_bound=lb,
        lower_bounds=per_bound,
        status=name,
        optimal=name == "OPTIMAL" or len(trucks) == lb,
        solve_time_ms=round(elapsed * 1000, 1),
    )


@dataclass
class _Vars:
    a: dict[tuple[int, int, int], cp_model.IntVar]       # (i, t, d) -> on that deck
    f: dict[tuple[int, int, int], cp_model.IntVar]       # (i, t, d) -> on that deck's floor
    floor: list[cp_model.IntVar]
    base: dict[tuple[int, int], cp_model.IntVar]         # (i, b) -> i stands in b's column
    x: list[cp_model.IntVar]
    y: list[cp_model.IntVar]
    r: list[cp_model.IntVar | None]                       # turned 90 degrees (None: square)
    ext: list[tuple]                                      # (lx, ly, ex, ey) per item
    used: list[cp_model.IntVar]
    c2: dict[int, cp_model.IntVar] = field(default_factory=dict)              # i -> twice its column's centre
    g: dict[tuple[int, int, int], cp_model.IntVar] = field(default_factory=dict)   # c2 if a else 0


def _build_model(items, truck, num_trucks, lb, order, rank, sig, group, conflicts, axles=()):
    n = len(items)
    decks = truck.decks
    model = cp_model.CpModel()
    used = [model.new_bool_var(f"y_{t}") for t in range(num_trucks)]

    # Assignment: item i only on decks it fits, in trucks 0..rank[i].
    a: dict[tuple[int, int, int], cp_model.IntVar] = {}
    for i in range(n):
        for t in range(min(rank[i] + 1, num_trucks)):
            for d, deck in enumerate(decks):
                if _fits(items[i], deck):
                    a[i, t, d] = model.new_bool_var(f"a_{i}_{t}_{d}")
    on = [[(t, d) for t in range(num_trucks) for d in range(len(decks)) if (i, t, d) in a] for i in range(n)]
    for i in range(n):
        model.add_exactly_one(a[i, t, d] for t, d in on[i])

    def in_truck(i: int, t: int):
        return sum(a[i, t, d] for d in range(len(decks)) if (i, t, d) in a)

    for t in range(num_trucks):
        model.add(sum(items[i].weight * in_truck(i, t) for i in range(n)) <= truck.payload_kg * used[t])
        model.add(sum(items[i].area * items[i].height * in_truck(i, t) for i in range(n))
                  <= truck.volume_mm3 * used[t])
    for t in range(num_trucks - 1):
        model.add(used[t] >= used[t + 1])
    model.add(sum(used) >= min(lb, num_trucks))

    # Columns: the base of a column is its first member in `order`.
    floor = [model.new_bool_var(f"floor_{i}") for i in range(n)]
    base: dict[tuple[int, int], cp_model.IntVar] = {}
    for i in range(n):
        for b in range(n):
            if rank[b] < rank[i] and _can_stack(items[i], items[b]):
                base[i, b] = model.new_bool_var(f"base_{i}_{b}")
    above: dict[int, list[int]] = {}
    for i, b in base:
        above.setdefault(b, []).append(i)
    for i in range(n):
        model.add_exactly_one([floor[i], *(base[i, b] for b in range(n) if (i, b) in base)])
    for (i, b), v in base.items():
        model.add_implication(v, floor[b])
        for t, d in on[b]:   # same truck and deck as the base
            if (i, t, d) in a:
                model.add_bool_or([a[i, t, d], a[b, t, d].Not(), v.Not()])
            else:
                model.add_bool_or([a[b, t, d].Not(), v.Not()])

    # f = on that deck's floor.
    f: dict[tuple[int, int, int], cp_model.IntVar] = {}
    for (i, t, d), v in a.items():
        if not items[i].stackable:
            f[i, t, d] = v
        else:
            fv = model.new_bool_var(f"f_{i}_{t}_{d}")
            model.add_implication(fv, v)
            model.add_implication(fv, floor[i])
            model.add_bool_or([v.Not(), floor[i].Not(), fv])
            f[i, t, d] = fv
    for i in range(n):
        if not items[i].stackable:
            model.add(floor[i] == 1)

    # Column height: base plus everything on it under the deck's inside height.
    for b, members in above.items():
        model.add(sum(items[i].height * base[i, b] for i in members)
                  <= sum((decks[d].height - items[b].height) * f[b, t, d] for t, d in on[b]))

    # Floor rectangles.
    xs, ys, rs, ext = [], [], [], []
    boxes: dict[tuple[int, int], tuple[list, list]] = {}
    for i, it in enumerate(items):
        max_len = max(decks[d].length for _, d in on[i])
        max_wid = max(decks[d].width for _, d in on[i])
        x = model.new_int_var(0, max_len, f"x_{i}")
        y = model.new_int_var(0, max_wid, f"y_{i}")
        if it.length == it.width:
            r, lx, ly = None, it.length, it.width
        else:
            r = model.new_bool_var(f"r_{i}")
            lx = model.new_int_var_from_domain(cp_model.Domain.from_values([it.length, it.width]), f"lx_{i}")
            ly = model.new_int_var_from_domain(cp_model.Domain.from_values([it.length, it.width]), f"ly_{i}")
            model.add(lx == it.length + (it.width - it.length) * r)
            model.add(ly == it.width + (it.length - it.width) * r)
        ex = model.new_int_var(0, max_len, f"ex_{i}")
        ey = model.new_int_var(0, max_wid, f"ey_{i}")
        model.add(ex == x + lx)
        model.add(ey == y + ly)
        if it.stackable:   # an item up a column has no floor position of its own
            model.add(x == 0).only_enforce_if(floor[i].Not())
            model.add(y == 0).only_enforce_if(floor[i].Not())
            if r is not None:
                model.add(r == 0).only_enforce_if(floor[i].Not())
        for t, d in on[i]:
            p = f[i, t, d]
            if decks[d].length < max_len:
                model.add(ex <= decks[d].length).only_enforce_if(p)
            if decks[d].width < max_wid:
                model.add(ey <= decks[d].width).only_enforce_if(p)
            bx, by = boxes.setdefault((t, d), ([], []))
            bx.append(model.new_optional_interval_var(x, lx, ex, p, f"ix_{i}_{t}_{d}"))
            by.append(model.new_optional_interval_var(y, ly, ey, p, f"iy_{i}_{t}_{d}"))
        xs.append(x)
        ys.append(y)
        rs.append(r)
        ext.append((lx, ly, ex, ey))
    for (t, d), (bx, by) in boxes.items():
        model.add_no_overlap_2d(bx, by)
        model.add(sum(items[i].area * f[i, t, d] for i in range(n) if (i, t, d) in f)
                  <= decks[d].length * decks[d].width)
    if truck.max_floor_mm2 is not None:
        for t in range(num_trucks):
            model.add(sum(items[i].area * v for (i, tt, _d), v in f.items() if tt == t) <= truck.floor_mm2)

    # Axle limits: c2 = twice the centre of the item's column, gate (g) = c2 on the item's deck, else 0.
    c2: dict[int, cp_model.IntVar] = {}
    gate: dict[tuple[int, int, int], cp_model.IntVar] = {}
    if axles:
        longest = max(deck.length for deck in decks)
        own = [2 * xs[i] + ext[i][0] for i in range(n)]
        centre: list = list(own)   # a floor-only item's centre is its own
        for i, it in enumerate(items):
            if it.stackable:
                c2[i] = centre[i] = model.new_int_var(0, 2 * longest, f"c2_{i}")
                model.add(c2[i] == own[i]).only_enforce_if(floor[i])
        for (i, b), v in base.items():
            model.add(c2[i] == c2[b]).only_enforce_if(v)
        for (i, t, d), v in a.items():
            if any(ax.b[i][d] for ax in axles):
                gate[i, t, d] = model.new_int_var(0, 2 * decks[d].length, f"g_{i}_{t}_{d}")
                model.add(gate[i, t, d] == centre[i]).only_enforce_if(v)
                model.add(gate[i, t, d] == 0).only_enforce_if(v.Not())
        for t in range(num_trucks):
            for ax in axles:
                model.add(sum(ax.a[i][d] * v + (ax.b[i][d] * gate[i, t, d] if ax.b[i][d] else 0)
                              for (i, tt, d), v in a.items() if tt == t) <= ax.cap * used[t])

    # Dangerous goods.
    if conflicts:
        involved = sorted({g for pair in conflicts for g in pair})
        z = {g: [model.new_bool_var(f"z_{g}_{t}") for t in range(num_trucks)] for g in involved}
        for (i, t, _d), v in a.items():
            if group[i] in z:
                model.add_implication(v, z[group[i]][t])
        for g, h in conflicts:
            for t in range(num_trucks):
                model.add_at_most_one(z[g][t], z[h][t])

    # Identical neighbours in `order`: truck(a) <= truck(b).
    for k in range(n - 1):
        i, j = order[k], order[k + 1]
        if sig[i] == sig[j]:
            model.add(sum(t * a[i, t, d] for t, d in on[i]) <= sum(t * a[j, t, d] for t, d in on[j]))

    model.minimize(sum(used))
    return model, _Vars(a=a, f=f, floor=floor, base=base, x=xs, y=ys, r=rs, ext=ext, used=used, c2=c2, g=gate)


def _add_hints(model: cp_model.CpModel, var: _Vars, items, cols: list[_Column], num_trucks: int) -> None:
    col_of = {i: c for c in cols for i in c.members}
    for (i, t, d), v in var.a.items():
        c = col_of[i]
        model.add_hint(v, c.truck == t and c.deck == d)
    for (i, t, d), v in var.f.items():
        if v is not var.a.get((i, t, d)):
            c = col_of[i]
            model.add_hint(v, c.truck == t and c.deck == d and c.members[0] == i)
    for i, c in col_of.items():
        model.add_hint(var.floor[i], c.members[0] == i)
        bottom = c.members[0] == i
        turned = bottom and c.lx != items[i].length
        lx, ly = (items[i].width, items[i].length) if turned else (items[i].length, items[i].width)
        hx, hy = (c.x, c.y) if bottom else (0, 0)
        model.add_hint(var.x[i], hx)
        model.add_hint(var.y[i], hy)
        if var.r[i] is not None:
            model.add_hint(var.r[i], turned)
            model.add_hint(var.ext[i][0], lx)
            model.add_hint(var.ext[i][1], ly)
        model.add_hint(var.ext[i][2], hx + lx)
        model.add_hint(var.ext[i][3], hy + ly)
    for (i, b), v in var.base.items():
        c = col_of[i]
        model.add_hint(v, c.members[0] == b and c.members[0] != i)
    for i, v in var.c2.items():
        model.add_hint(v, 2 * col_of[i].x + col_of[i].lx)
    for (i, t, d), v in var.g.items():
        c = col_of[i]
        model.add_hint(v, 2 * c.x + c.lx if c.truck == t and c.deck == d else 0)
    for t in range(num_trucks):
        model.add_hint(var.used[t], True)


def _extract(solver: cp_model.CpSolver, var: _Vars, items) -> list[_Column]:
    n = len(items)
    cols = []
    for b in range(n):
        if not solver.boolean_value(var.floor[b]):
            continue
        t, d = next((t, d) for (i, t, d), v in var.f.items() if i == b and solver.boolean_value(v))
        turned = var.r[b] is not None and solver.boolean_value(var.r[b])
        lx, ly = (items[b].width, items[b].length) if turned else (items[b].length, items[b].width)
        members = [b] + [i for (i, bb), v in var.base.items() if bb == b and solver.boolean_value(v)]
        cols.append(_Column(t, d, solver.value(var.x[b]), solver.value(var.y[b]), lx, ly, members))
    return cols


def _finish(items: Sequence[Item], cols: list[_Column], rank: list[int]) -> list[list[Placed]]:
    """Placements per truck (trucks renumbered 0, 1, ... in order); each column heaviest at
    the bottom; a truck lists its floor items first (by deck, x, y), then each level up."""
    numbers = {t: k for k, t in enumerate(sorted({c.truck for c in cols}))}
    trucks: list[list[Placed]] = [[] for _ in numbers]
    for c in cols:
        members = sorted(c.members, key=lambda i: (-items[i].weight, rank[i]))
        z = 0
        for level, i in enumerate(members):
            it = items[i]
            trucks[numbers[c.truck]].append(Placed(
                id=it.id, truck=numbers[c.truck], deck=c.deck, x=c.x, y=c.y, z=z, length=c.lx, width=c.ly,
                height=it.height, rotated=it.length != c.lx, base=items[members[0]].id, level=level))
            z += it.height
    for placed in trucks:
        placed.sort(key=lambda p: (p.level, p.deck, p.x, p.y))
    return trucks


def _check(items: Sequence[Item], truck: Truck, trucks: list[list[Placed]], group: list[int],
           conflicts: set[tuple[int, int]]) -> None:
    """Re-check a packing from scratch (a failure here is a bug)."""
    def fail(msg: str) -> None:
        raise RuntimeError(f"OR-Tools packing: {msg}")

    by_id = {it.id: k for k, it in enumerate(items)}
    if sorted(p.id for load in trucks for p in load) != sorted(by_id):
        fail("not every shipment is placed exactly once.")
    for number, load in enumerate(trucks, start=1):
        if not load:
            fail(f"truck {number} is empty.")
        if sum(items[by_id[p.id]].weight for p in load) > truck.payload_kg:
            fail(f"truck {number} is over its payload.")
        gs = {group[by_id[p.id]] for p in load}
        if any((g, h) in conflicts for g in gs for h in gs):
            fail(f"truck {number} carries incompatible dangerous goods.")
        here = {p.id: p for p in load}
        columns: dict[int, list[Placed]] = {}
        for p in load:
            it = items[by_id[p.id]]
            if p.truck != number - 1 or not 0 <= p.deck < len(truck.decks):
                fail(f"'{it.name}' has a bad truck or deck.")
            deck = truck.decks[p.deck]
            want = (it.width, it.length) if p.rotated else (it.length, it.width)
            if (p.length, p.width) != want or p.height != it.height:
                fail(f"'{it.name}' has the wrong size.")
            if p.x < 0 or p.y < 0 or p.z < 0 or p.x + p.length > deck.length or p.y + p.width > deck.width \
                    or p.z + p.height > deck.height:
                fail(f"'{it.name}' is not inside its deck.")
            columns.setdefault(p.base, []).append(p)
        for base_id, column in columns.items():
            bottom = here.get(base_id)
            if bottom is None or bottom.level != 0 or bottom.base != base_id:
                fail(f"a column in truck {number} has no floor item.")
            column.sort(key=lambda p: p.level)
            z = 0
            for level, p in enumerate(column):
                it = items[by_id[p.id]]
                if p.level != level or p.z != z:
                    fail(f"'{it.name}' is not stacked level by level.")
                if (p.deck, p.x, p.y, p.length, p.width) != (bottom.deck, bottom.x, bottom.y, bottom.length,
                                                             bottom.width):
                    fail(f"'{it.name}' is not over its column's footprint.")
                if level and not _can_stack(it, items[by_id[base_id]]):
                    fail(f"'{it.name}' stands on an item it can't stack on.")
                z += p.height
        for lim in truck.axle_limits:
            added = sum(items[by_id[p.id]].weight * lim.share(p.deck, p.x + p.length / 2) for p in load)
            if added > lim.cap_kg + 1e-6:
                fail(f"truck {number} overloads the {lim.name} ({added:,.1f} kg on a spare "
                     f"{lim.cap_kg:,.1f} kg).")
        floor = [p for p in load if p.level == 0]
        if sum(p.length * p.width for p in floor) > truck.floor_mm2:
            fail(f"truck {number} uses more floor than allowed.")
        for k, p in enumerate(floor):
            for q in floor[k + 1:]:
                if p.deck == q.deck and _overlaps(p.x, p.y, p.length, p.width, q.x, q.y, q.length, q.width):
                    fail(f"truck {number}: '{items[by_id[p.id]].name}' and '{items[by_id[q.id]].name}' "
                         f"overlap.")
