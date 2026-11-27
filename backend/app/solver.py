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
  Minimise sum(y).

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

import time
from collections.abc import Sequence
from dataclasses import dataclass, field

from ortools.sat.python import cp_model

NUM_WORKERS = 8


@dataclass(frozen=True)
class DeckSpec:
    id: str
    name: str
    length: int   # mm along x
    width: int    # mm along y
    height: int   # inside height, mm


@dataclass(frozen=True)
class Truck:
    payload_kg: int
    decks: tuple[DeckSpec, ...]
    name: str = "truck"

    @property
    def floor_mm2(self) -> int:
        return sum(d.length * d.width for d in self.decks)

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


def never_fit(items: Sequence[Item], truck: Truck) -> list[str]:
    """Why each item that can never travel on `truck` doesn't fit (empty = all can)."""
    longest = max(d.length for d in truck.decks)
    widest = max(d.width for d in truck.decks)
    tallest = max(d.height for d in truck.decks)
    out = []
    for it in items:
        if it.weight > truck.payload_kg:
            out.append(f"'{it.name}' weighs {it.weight:,} kg and the payload is {truck.payload_kg:,} kg")
        if any(_fits(it, d) for d in truck.decks):
            continue
        reasons = []
        if it.height > tallest:
            reasons.append(f"'{it.name}' is {it.height:,} mm tall and the inside height is {tallest:,} mm")
        if max(it.length, it.width) > longest:
            reasons.append(f"'{it.name}' is {max(it.length, it.width):,} mm long and the longest deck is "
                           f"{longest:,} mm")
        elif min(it.length, it.width) > widest:
            reasons.append(f"'{it.name}' is {min(it.length, it.width):,} mm wide and the widest deck is "
                           f"{widest:,} mm")
        if not reasons:
            reasons.append(f"'{it.name}' ({it.length:,} x {it.width:,} x {it.height:,} mm) fits no deck "
                           f"either way round")
        out.extend(reasons)
    return out


def lower_bounds(items: Sequence[Item], truck: Truck) -> dict[str, int]:
    """No packing can use fewer trucks than any of these (geometry ignored)."""
    return {
        "weight": _ceil(sum(it.weight for it in items), truck.payload_kg),
        "volume": _ceil(sum(it.area * it.height for it in items), truck.volume_mm3),
        "floor": _ceil(sum(it.area for it in items if not it.stackable), truck.floor_mm2),
    }


# ---------------------------------------------------------------------------
# Greedy starting packing
# ---------------------------------------------------------------------------

def _overlaps(ax, ay, alx, aly, bx, by, blx, bly) -> bool:
    return ax < bx + blx and bx < ax + alx and ay < by + bly and by < ay + aly


def _floor_spot(cols: list[_Column], item: Item, deck: DeckSpec) -> tuple[int, int, int, int] | None:
    """(x, y, lx, ly) of the front-most free spot for `item` on a deck holding `cols`, or None.
    Candidate corners come from the edges of the footprints already there."""
    xs = sorted({0, *(c.x + c.lx for c in cols)})
    ys = sorted({0, *(c.y + c.ly for c in cols)})
    best = None
    for lx, ly in _orientations(item, deck):
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


def _greedy(items: Sequence[Item], truck: Truck, order: list[int]) -> list[_Column]:
    """Largest footprint first: into an existing column if it can stack there, else the
    front-most free floor spot of the first truck that takes it, else a new truck."""
    cols: list[_Column] = []
    on_deck: dict[tuple[int, int], list[_Column]] = {}
    load: list[int] = []

    def takes(t: int, i: int) -> bool:
        return load[t] + items[i].weight <= truck.payload_kg

    def add(t: int, i: int) -> None:
        load[t] += items[i].weight

    for i in order:
        it = items[i]
        col = next((c for c in cols if it.stackable and _can_stack(it, items[c.members[0]])
                    and c.top + it.height <= truck.decks[c.deck].height and takes(c.truck, i)), None)
        if col is not None:
            col.members.append(i)
            col.top += it.height
            add(col.truck, i)
            continue
        t = 0
        while True:
            if t == len(load):
                load.append(0)
            if takes(t, i):
                spot = None
                for d, deck in enumerate(truck.decks):
                    if it.height <= deck.height:
                        spot = _floor_spot(on_deck.get((t, d), []), it, deck)
                        if spot:
                            break
                if spot:
                    c = _Column(t, d, *spot, members=[i], top=it.height)
                    cols.append(c)
                    on_deck.setdefault((t, d), []).append(c)
                    add(t, i)
                    break
            t += 1
            if t > len(items) + 1:
                raise RuntimeError(f"Greedy packing could not place '{it.name}'.")
    return cols


def _signature(it: Item) -> tuple:
    return (it.length, it.width, it.height, it.weight, it.stackable, it.key)


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
    order = sorted(range(n), key=lambda i: (-items[i].area, -items[i].height, -items[i].weight,
                                            items[i].key))
    rank = [0] * n
    for k, i in enumerate(order):
        rank[i] = k
    sig = [_signature(items[i]) for i in range(n)]

    start = time.perf_counter()
    hint = _greedy(items, truck, order)
    _canonical(hint, order, rank, sig)
    _check(items, truck, _finish(items, hint, rank))  # a greedy bug shows up here
    num_trucks = 1 + max(c.truck for c in hint)

    model, var = _build_model(items, truck, num_trucks, lb, order, rank, sig)
    _add_hints(model, var, items, hint, num_trucks)

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = max(float(time_limit_s) - (time.perf_counter() - start), 0.05)
    solver.parameters.num_workers = NUM_WORKERS
    status = solver.solve(model)
    name = solver.status_name(status)
    cols = _extract(solver, var, items) if status in (cp_model.OPTIMAL, cp_model.FEASIBLE) else hint
    elapsed = time.perf_counter() - start

    trucks = _finish(items, cols, rank)
    _check(items, truck, trucks)
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


def _build_model(items, truck, num_trucks, lb, order, rank, sig):
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

    # Identical neighbours in `order`: truck(a) <= truck(b).
    for k in range(n - 1):
        i, j = order[k], order[k + 1]
        if sig[i] == sig[j]:
            model.add(sum(t * a[i, t, d] for t, d in on[i]) <= sum(t * a[j, t, d] for t, d in on[j]))

    model.minimize(sum(used))
    return model, _Vars(a=a, f=f, floor=floor, base=base, x=xs, y=ys, r=rs, ext=ext, used=used)


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


def _check(items: Sequence[Item], truck: Truck, trucks: list[list[Placed]]) -> None:
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
        floor = [p for p in load if p.level == 0]
        for k, p in enumerate(floor):
            for q in floor[k + 1:]:
                if p.deck == q.deck and _overlaps(p.x, p.y, p.length, p.width, q.x, q.y, q.length, q.width):
                    fail(f"truck {number}: '{items[by_id[p.id]].name}' and '{items[by_id[q.id]].name}' "
                         f"overlap.")
