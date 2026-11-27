"""
The default heuristic planner: fast, explainable rules rather than an optimiser.

Everything here is a pure function except `HeuristicPlanner.plan`, which orchestrates. The rule
modules are imported as modules (`checks.precheck`, `axles.estimate_axle_loads`) so tests can
monkeypatch them and a better implementation plugs in without touching this file.

`HeuristicPlanner.plan(req, ref)`
---------------------------------
1. Look up the vehicle and resolve the body (`checks.resolve_body`). Expand each FreightItem into
   `quantity` units with `unit_id = "<item.id>#<n>"`, n from 1 (`expand_units`).
2. `checks.precheck` reports problems with the requested freight (unknown types, mixed freight,
   body compatibility, heights, reefers...). Its warnings are kept as they are.
3. Units with an unknown type_id can't be placed and go straight to `unplaced` (precheck already
   reported them). If the request mixes pallets and containers nothing is placed (precheck
   reports MIXED_FREIGHT). Otherwise pallets go to `place_pallets` and containers to
   `place_containers`.
4. `axles.estimate_axle_loads` estimates axle group loads from the placements, then
   `checks.postcheck` checks payload, overall height and axle limits.
5. Utilisation, total weight (of the PLACED units) and the tallest point above the ground are
   computed, and `fits` / `reasons` follow the fit rule in models.py: fits = no error warnings.

The heuristic itself only emits OVER_CAPACITY (error), CONTAINER_COMBO (error) and
UNSTACKABLE_FLOOR_SPACE (warning). Every other code comes from `checks`.

Pallets (`place_pallets`)
-------------------------
1. Height: a unit without `height_mm` is treated as a full stack (pallet_defaults.max_stack_height_mm).
   The stack height cap is min(max_stack_height_mm, body internal height, overall height limit
   minus deck height). Stacks are built before decks are chosen, so the highest cargo deck is used.
2. Stacks (`build_stacks`): only stackable units with the same type_id AND the same stop share a
   stack, while the summed height stays within the cap. Units are taken heaviest first and each
   goes into the first stack it fits (first-fit decreasing on weight), so the heaviest unit of a
   stack is at the bottom. Unstackable or too-tall units are stacks of one.
3. Order (`order_stacks`): stop descending (LIFO: the last drop is loaded first and rides at the
   front; no stop counts as the highest stop), then footprint area, then weight, both descending.
4. Rows (`fill_rows`): stacks are laid in rows across the deck width, flush from the driver's
   side. A pallet may turn 90 degrees about the vertical: the orientation that fits the most across
   the deck is tried first (ties: the shorter one along the deck). A row holds one stop only, may
   mix pallet types when the width allows, and is as deep as its longest stack. Rows advance from
   the deck front; when a deck is full the next cargo deck (vehicle.cargo_decks order) is used.
   A stack that fits nowhere is unplaced and the plan reports OVER_CAPACITY, counted in floor
   positions, with the smallest vehicle that has enough pallet spaces as the suggestion.
5. Balance (`balance_rows`): within each stop group on each deck (so LIFO is never broken) the
   rows are reordered so the heaviest sit nearest the midpoint of the deck's supports and out of
   the rear overhang, then x is rewritten. It's a separate function so a better balancer can
   replace it.
6. UNSTACKABLE_FLOOR_SPACE (`unstackable_floor_warning`): unstackable items that would take fewer
   floor positions if they were stacked within the cap are named with the positions they cost.

Containers (`place_containers`)
-------------------------------
The first `vehicle.container_combos` entry that gives every container its own slot of the same
size class is used (unused slots are fine). Within a size class the heaviest container takes the
slot nearest the midpoint of its deck's supports; with delivery stops, the last drop takes the
frontmost slot instead, and STOP_ORDER_BLOCKED warns when the slots force an earlier drop ahead of
a later one. x = slot.x_mm, y = centred across the deck,
z = 0. Types without external dimensions use nominal size-class dimensions. No combo (or a
vehicle with no combos) is a CONTAINER_COMBO error that spells out the allowed mixes, and every
container is unplaced.

Known limitations
-----------------
- Rows only: no lengthwise pinwheeling, no filling a short row's leftover depth, and an open row
  is closed as soon as a stack doesn't fit it.
- Stacks never mix pallet types or stops, even when the footprints match.
- Balancing is greedy and approximate when row depths differ (slot centres use the average depth).
- Decks fill in order: a deck is not revisited once the next one is in use.
"""

import math
from collections import Counter, defaultdict
from dataclasses import dataclass, field, replace
from itertools import groupby

from app.planner import axles, checks
from app.planner.models import (
    FreightItem,
    Placement,
    PlanRequest,
    PlanResult,
    PlanWarning,
    Usage,
    Utilisation,
)
from app.reference.schemas import BodyType, ContainerType, Deck, ReferenceData, VehicleConfig

AU_PALLET = "AU_STD"
AU_SIDE_MM = 1165
AU_AREA_MM2 = AU_SIDE_MM * AU_SIDE_MM

# Nominal ISO external dimensions (length, width, height) for types without their own.
NOMINAL_CONTAINER_DIMS: dict[str, tuple[int, int, int]] = {
    "20": (6058, 2438, 2591),
    "40": (12192, 2438, 2591),
    "45": (13716, 2438, 2591),
    "48": (14630, 2438, 2591),
}
SIZE_CLASS_ORDER = ["20", "40", "45", "48"]


# ---------------------------------------------------------------------------
# Units
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class Unit:
    """One physical pallet or container: an item expanded by quantity."""
    unit_id: str
    item: FreightItem

    @property
    def weight_kg(self) -> float:
        return self.item.gross_weight_kg


def expand_units(items: list[FreightItem]) -> list[Unit]:
    """One Unit per quantity, `unit_id = "<item.id>#<n>"` with n from 1."""
    return [Unit(f"{item.id}#{n}", item) for item in items for n in range(1, item.quantity + 1)]


def _is_known(unit: Unit, ref: ReferenceData) -> bool:
    table = ref.pallets if unit.item.kind == "pallet" else ref.containers
    return unit.item.type_id in table


def _plural(n: float, word: str) -> str:
    return f"{n:g} {word}" if n == 1 else f"{n:g} {word}s"


def _a(name: str, *, capital: bool = False) -> str:
    article = "an" if name[:1].lower() in "aeiou" else "a"
    return f"{article.capitalize() if capital else article} {name}"


# ---------------------------------------------------------------------------
# Pallets: stacks
# ---------------------------------------------------------------------------

@dataclass
class Stack:
    """Units sharing one floor position, bottom first. Footprint is the pallet type's, unrotated."""
    type_id: str
    stop: int | None
    length_mm: int
    width_mm: int
    units: list[tuple[Unit, int]] = field(default_factory=list)  # (unit, height_mm)

    @property
    def height_mm(self) -> int:
        return sum(h for _, h in self.units)

    @property
    def weight_kg(self) -> float:
        return sum(u.weight_kg for u, _ in self.units)

    @property
    def area_mm2(self) -> int:
        return self.length_mm * self.width_mm


def unit_height(unit: Unit, ref: ReferenceData) -> int:
    """The unit's height, or a full stack when it isn't given."""
    return unit.item.height_mm or ref.pallet_defaults.max_stack_height_mm


def stack_height_cap(vehicle: VehicleConfig, body: BodyType, ref: ReferenceData) -> int:
    """Tallest stack allowed: max stack height, body internal height, overall limit above the deck."""
    deck_height = max((d.deck_height_mm for d in vehicle.cargo_decks), default=0)
    caps = [ref.pallet_defaults.max_stack_height_mm, vehicle.overall_height_limit_mm - deck_height]
    if body.internal_height_mm is not None:
        caps.append(body.internal_height_mm)
    return min(caps)


def build_stacks(units: list[Unit], cap_mm: int, ref: ReferenceData) -> list[Stack]:
    """Group pallet units into stacks (first-fit decreasing on weight, same type_id and stop only).

    Returned in the order of each stack's first unit in `units`."""
    order = {u.unit_id: i for i, u in enumerate(units)}

    def new_stack(unit: Unit, height: int) -> Stack:
        p = ref.pallets[unit.item.type_id]
        return Stack(unit.item.type_id, unit.item.stop, p.length_mm, p.width_mm, [(unit, height)])

    stacks: list[Stack] = []
    groups: dict[tuple[str, int | None], list[tuple[Unit, int]]] = defaultdict(list)
    for u in units:
        h = unit_height(u, ref)
        if u.item.stackable and h <= cap_mm:
            groups[(u.item.type_id, u.item.stop)].append((u, h))
        else:
            stacks.append(new_stack(u, h))
    for members in groups.values():
        members.sort(key=lambda m: -m[0].weight_kg)  # stable: input order breaks ties
        group: list[Stack] = []
        for u, h in members:
            target = next((s for s in group if s.height_mm + h <= cap_mm), None)
            if target is None:
                group.append(new_stack(u, h))
            else:
                target.units.append((u, h))
        stacks.extend(group)
    stacks.sort(key=lambda s: min(order[u.unit_id] for u, _ in s.units))
    return stacks


def order_stacks(stacks: list[Stack]) -> list[Stack]:
    """Loading order: stop descending (None first), then footprint area, then weight, descending."""
    return sorted(stacks, key=lambda s: (s.stop is not None, -(s.stop or 0), -s.area_mm2, -s.weight_kg))


# ---------------------------------------------------------------------------
# Pallets: rows
# ---------------------------------------------------------------------------

@dataclass
class RowSlot:
    stack: Stack
    y_mm: int
    length_mm: int  # along the deck, after rotation
    width_mm: int   # across the deck, after rotation
    rotated: bool


@dataclass
class Row:
    """Stacks side by side across a deck, front edges aligned at x_mm. One stop per row."""
    deck_id: str
    x_mm: int
    stop: int | None
    slots: list[RowSlot] = field(default_factory=list)

    @property
    def depth_mm(self) -> int:
        return max((s.length_mm for s in self.slots), default=0)

    @property
    def used_width_mm(self) -> int:
        return sum(s.width_mm for s in self.slots)

    @property
    def weight_kg(self) -> float:
        return sum(s.stack.weight_kg for s in self.slots)


def orientations(stack: Stack, deck_width_mm: int) -> list[tuple[int, int, bool]]:
    """(length, width, rotated) options that fit the deck width, most across first, then shortest."""
    opts = [(stack.length_mm, stack.width_mm, False)]
    if stack.length_mm != stack.width_mm:
        opts.append((stack.width_mm, stack.length_mm, True))
    opts = [o for o in opts if o[1] <= deck_width_mm]
    return sorted(opts, key=lambda o: (-(deck_width_mm // o[1]), o[0], o[2]))


def _join_row(row: Row, stack: Stack, deck: Deck) -> bool:
    """Add `stack` to the free width of `row` if some orientation fits. True when it was added."""
    for length, width, rotated in orientations(stack, deck.width_mm):
        depth = max(row.depth_mm, length)
        if row.used_width_mm + width <= deck.width_mm and row.x_mm + depth <= deck.length_mm:
            row.slots.append(RowSlot(stack, row.used_width_mm, length, width, rotated))
            return True
    return False


def fill_rows(stacks: list[Stack], decks: list[Deck],
              max_spaces: float | None = None) -> tuple[list[Row], list[Stack]]:
    """Lay ordered stacks in rows from the front of the first deck, spilling to later decks.

    `max_spaces` caps the floor used, in AU-equivalent pallet spaces (the vehicle's pallet_spaces,
    which may be overridden lower than the decks could hold). Returns (rows in loading order,
    stacks that didn't fit)."""
    rows: list[Row] = []
    unplaced: list[Stack] = []
    deck_end: dict[str, int] = {d.id: 0 for d in decks}  # x where the next row starts
    deck_idx = 0
    open_row: Row | None = None
    used = 0.0

    for stack in stacks:
        spaces = floor_au_equivalent(stack.type_id, stack.length_mm, stack.width_mm)
        if max_spaces is not None and used + spaces > max_spaces + 1e-9:
            unplaced.append(stack)
            continue
        used += spaces
        same_stop = open_row is not None and open_row.stop == stack.stop
        if same_stop and _join_row(open_row, stack, decks[deck_idx]):
            deck_end[open_row.deck_id] = open_row.x_mm + open_row.depth_mm
            continue
        placed = False
        for di in range(deck_idx, len(decks)):
            deck = decks[di]
            x = deck_end[deck.id]
            for length, width, rotated in orientations(stack, deck.width_mm):
                if x + length <= deck.length_mm:
                    open_row = Row(deck.id, x, stack.stop, [RowSlot(stack, 0, length, width, rotated)])
                    rows.append(open_row)
                    deck_end[deck.id] = x + length
                    deck_idx = di
                    placed = True
                    break
            if placed:
                break
        if not placed:
            used -= spaces
            unplaced.append(stack)
    return rows, unplaced


def balance_target_mm(deck: Deck) -> float:
    """Midpoint between the deck's front and rear supports, in deck coordinates."""
    return (deck.front_support.position_mm + deck.rear_support.position_mm) / 2 - deck.x_mm


def balance_rows(rows: list[Row], vehicle: VehicleConfig) -> list[Row]:
    """Reorder rows within each (deck, stop) block so the heaviest are nearest the deck's balance
    target and out of the rear overhang. Block positions don't move, so LIFO order is kept.

    Greedy: block slots are approximated with the block's average row depth, ranked by (in the
    rear overhang, distance from the target), and the heaviest row takes the best slot. Then x is
    rewritten front to back with each row's real depth. Blocks of equal-weight rows are untouched.
    Replaceable by a better balancer with the same signature."""
    out: list[Row] = []
    for (deck_id, _stop), block_iter in groupby(rows, key=lambda r: (r.deck_id, r.stop)):
        block = list(block_iter)
        if len(block) < 2 or len({r.weight_kg for r in block}) == 1:
            out.extend(block)
            continue
        deck = vehicle.deck(deck_id)
        target = balance_target_mm(deck)
        rear_support = deck.rear_support.position_mm - deck.x_mm
        start = block[0].x_mm
        avg_depth = sum(r.depth_mm for r in block) / len(block)
        centres = [start + (k + 0.5) * avg_depth for k in range(len(block))]
        best_slots = sorted(range(len(block)),
                            key=lambda k: (centres[k] > rear_support, abs(centres[k] - target)))
        heaviest_first = sorted(block, key=lambda r: -r.weight_kg)
        arranged: list[Row] = [block[0]] * len(block)
        for k, row in zip(best_slots, heaviest_first, strict=True):
            arranged[k] = row
        x = start
        for row in arranged:
            out.append(replace(row, x_mm=x))
            x += row.depth_mm
    return out


def rows_to_placements(rows: list[Row], first_stack_id: int = 1) -> list[Placement]:
    """One Placement per unit; stack ids numbered in row order."""
    placements: list[Placement] = []
    stack_id = first_stack_id
    for row in rows:
        for slot in row.slots:
            z = 0
            for level, (unit, height) in enumerate(slot.stack.units):
                item = unit.item
                placements.append(Placement(
                    unit_id=unit.unit_id, item_id=item.id, label=item.label or item.id, kind="pallet",
                    type_id=item.type_id, deck_id=row.deck_id, x_mm=row.x_mm, y_mm=slot.y_mm, z_mm=z,
                    length_mm=slot.length_mm, width_mm=slot.width_mm, height_mm=height,
                    rotated=slot.rotated, stack_id=stack_id, stack_level=level,
                    weight_kg=item.gross_weight_kg, stop=item.stop, stackable=item.stackable,
                    temp_controlled=item.temp_controlled,
                ))
                z += height
            stack_id += 1
    return placements


def place_pallets(units: list[Unit], vehicle: VehicleConfig, body: BodyType,
                  ref: ReferenceData) -> tuple[list[Placement], list[str]]:
    """Place pallet units (known type_ids only). Returns (placements, unplaced unit_ids)."""
    stacks = order_stacks(build_stacks(units, stack_height_cap(vehicle, body, ref), ref))
    rows, unplaced = fill_rows(stacks, vehicle.cargo_decks, vehicle.pallet_spaces)
    rows = balance_rows(rows, vehicle)
    return rows_to_placements(rows), [u.unit_id for s in unplaced for u, _ in s.units]


# ---------------------------------------------------------------------------
# Pallets: warnings
# ---------------------------------------------------------------------------

def oversize_warning(units: list[Unit], vehicle: VehicleConfig, ref: ReferenceData) -> PlanWarning | None:
    """OVERSIZE_FOOTPRINT for pallets narrower than no deck in either orientation (they can't go on
    this vehicle at all, so a bigger vehicle of the same width won't help)."""
    widest = max((d.width_mm for d in vehicle.cargo_decks), default=0)
    ids = oversize_unit_ids(units, vehicle, ref)
    big = [u for u in units if u.unit_id in ids]
    if not big:
        return None
    p = ref.pallets[big[0].item.type_id]
    return PlanWarning(
        code="OVERSIZE_FOOTPRINT", severity="error",
        message=(f"A {p.name} pallet ({p.length_mm} × {p.width_mm} mm) is wider than the "
                 f"{vehicle.name}'s {widest} mm deck whichever way it turns."),
        suggestion="Check the pallet size, or move it as an over-dimensional load.",
        item_ids=list(dict.fromkeys(u.item.id for u in big)),
    )


def oversize_unit_ids(units: list[Unit], vehicle: VehicleConfig, ref: ReferenceData) -> set[str]:
    widest = max((d.width_mm for d in vehicle.cargo_decks), default=0)
    return {u.unit_id for u in units
            if min(ref.pallets[u.item.type_id].length_mm, ref.pallets[u.item.type_id].width_mm) > widest}


def floor_au_equivalent(type_id: str, length_mm: int, width_mm: int) -> float:
    """One floor position in AU-standard pallet spaces: exactly 1 for AU_STD, else by area."""
    return 1.0 if type_id == AU_PALLET else length_mm * width_mm / AU_AREA_MM2


def over_capacity_warning(unplaced_units: list[Unit], placements: list[Placement], vehicle: VehicleConfig,
                          body: BodyType, ref: ReferenceData) -> PlanWarning:
    """OVER_CAPACITY for pallets that didn't fit, counted in floor positions, with a vehicle to try."""
    stacks = build_stacks(unplaced_units, stack_height_cap(vehicle, body, ref), ref)
    over = len(stacks)
    needed = sum(floor_au_equivalent(p.type_id, p.length_mm, p.width_mm)
                 for p in placements if p.kind == "pallet" and p.stack_level == 0)
    needed += sum(floor_au_equivalent(s.type_id, s.length_mm, s.width_mm) for s in stacks)
    needed_spaces = math.ceil(round(needed, 6))
    bigger = sorted(
        (v for v in ref.vehicles.values()
         if v.id != vehicle.id and not v.configurable and not v.route_restricted
         and v.pallet_spaces >= needed_spaces),
        key=lambda v: (v.pallet_spaces, v.max_payload_kg),
    )
    loads = max(2, math.ceil(needed_spaces / vehicle.pallet_spaces)) if vehicle.pallet_spaces else 2
    if bigger:
        suggestion = f"Try {_a(bigger[0].name)} or split into {loads} loads."
    else:
        suggestion = f"Split into {loads} loads."
    item_ids = list(dict.fromkeys(u.item.id for u in unplaced_units))
    return PlanWarning(
        code="OVER_CAPACITY", severity="error",
        message=(f"Over by {_plural(over, 'pallet')}: {_plural(len(unplaced_units), 'unit')} didn't fit "
                 f"on the {vehicle.name}, which has {_plural(vehicle.pallet_spaces, 'pallet space')}."),
        suggestion=suggestion, item_ids=item_ids,
    )


def unstackable_floor_warning(units: list[Unit], cap_mm: int, ref: ReferenceData,
                              *, short_of_space: bool = True) -> PlanWarning | None:
    """UNSTACKABLE_FLOOR_SPACE when unstackable items would take fewer floor positions stacked.

    A warning when the load ran out of floor space, otherwise just info."""
    by_item: dict[str, list[Unit]] = defaultdict(list)
    for u in units:
        if not u.item.stackable:
            by_item[u.item.id].append(u)
    extra: dict[str, int] = {}
    for item_id, item_units in by_item.items():
        as_stackable = [Unit(u.unit_id, u.item.model_copy(update={"stackable": True})) for u in item_units]
        saved = len(item_units) - len(build_stacks(as_stackable, cap_mm, ref))
        if saved > 0:
            extra[item_id] = saved
    if not extra:
        return None
    total = sum(extra.values())
    named = ", ".join(f"{i} ({_plural(n, 'extra position')})" for i, n in extra.items())
    return PlanWarning(
        code="UNSTACKABLE_FLOOR_SPACE", severity="warning" if short_of_space else "info",
        message=f"Unstackable pallets take {_plural(total, 'more floor position')} than stacked: {named}.",
        suggestion=f"If they can be stacked (up to {cap_mm} mm), mark them stackable to free "
                   f"{_plural(total, 'position')}.",
        item_ids=list(extra),
    )


# ---------------------------------------------------------------------------
# Containers
# ---------------------------------------------------------------------------

def container_dims(ct: ContainerType) -> tuple[int, int, int]:
    """External (length, width, height), nominal for the size class where the type has none."""
    nl, nw, nh = NOMINAL_CONTAINER_DIMS[ct.size_class]
    return ct.ext_length_mm or nl, ct.ext_width_mm or nw, ct.ext_height_mm or nh


def _mix(size_classes: list[str]) -> str:
    counts = Counter(size_classes)
    return " + ".join(f"{counts[sc]} × {sc}'" for sc in SIZE_CLASS_ORDER if counts[sc])


def _combo_fits(size_classes: list[str], combo_slots: list[str]) -> bool:
    have = Counter(combo_slots)
    return all(have[sc] >= n for sc, n in Counter(size_classes).items())


def place_containers(units: list[Unit], vehicle: VehicleConfig,
                     ref: ReferenceData) -> tuple[list[Placement], list[str], list[PlanWarning]]:
    """Place container units (known type_ids only) in the first combo that fits.

    Returns (placements, unplaced unit_ids, warnings)."""
    if not units:
        return [], [], []
    types = {u.unit_id: ref.containers[u.item.type_id] for u in units}
    wanted = [types[u.unit_id].size_class for u in units]
    deck_order = {d.id: i for i, d in enumerate(vehicle.decks)}
    by_stop = any(u.item.stop is not None for u in units)

    for combo in vehicle.container_combos:
        if not _combo_fits(wanted, [s.size_class for s in combo.slots]):
            continue
        placements: list[Placement] = []
        for sc in SIZE_CLASS_ORDER:
            members = [u for u in units if types[u.unit_id].size_class == sc]
            if not members:
                continue
            same_size = [s for s in combo.slots if s.size_class == sc]
            if by_stop:
                # Multi-drop: the last drop rides at the front (as for pallets), weight breaks ties.
                group = sorted(members, key=lambda u: (u.item.stop is not None, -(u.item.stop or 0),
                                                        -u.weight_kg))
                slots = sorted(same_size, key=lambda s: (deck_order[s.deck_id], s.x_mm))
            else:
                nominal_length = NOMINAL_CONTAINER_DIMS[sc][0]

                def off_centre(slot, nominal_length=nominal_length) -> float:
                    deck = vehicle.deck(slot.deck_id)
                    return abs(slot.x_mm + nominal_length / 2 - balance_target_mm(deck))

                group = sorted(members, key=lambda u: -u.weight_kg)
                slots = sorted(same_size, key=off_centre)
            for unit, slot in zip(group, slots, strict=False):
                deck = vehicle.deck(slot.deck_id)
                length, width, height = container_dims(types[unit.unit_id])
                item = unit.item
                placements.append(Placement(
                    unit_id=unit.unit_id, item_id=item.id, label=item.label or item.id, kind="container",
                    type_id=item.type_id, deck_id=deck.id, x_mm=slot.x_mm, y_mm=(deck.width_mm - width) // 2,
                    z_mm=0, length_mm=length, width_mm=width, height_mm=height, stack_id=0, stack_level=0,
                    weight_kg=item.gross_weight_kg, stop=item.stop, stackable=item.stackable,
                    temp_controlled=item.temp_controlled or types[unit.unit_id].temp_controlled,
                ))
        placements.sort(key=lambda p: (deck_order[p.deck_id], p.x_mm))
        placements = [p.model_copy(update={"stack_id": i}) for i, p in enumerate(placements, start=1)]
        blocked = stop_order_warning(placements) if by_stop else None
        return placements, [], [blocked] if blocked else []

    return [], [u.unit_id for u in units], [container_combo_warning(units, wanted, vehicle, ref)]


def stop_order_warning(placements: list[Placement]) -> PlanWarning | None:
    """STOP_ORDER_BLOCKED when, front to back, an earlier drop rides ahead of a later one. Container
    slots fix where each size goes (a B-double's 20' is always on the lead trailer), so the stop
    order can't always be kept. `placements` must be sorted front to back."""
    for i, front in enumerate(placements):
        for rear in placements[i + 1:]:
            if front.stop is not None and rear.stop is not None and front.stop < rear.stop:
                return PlanWarning(
                    code="STOP_ORDER_BLOCKED", severity="warning",
                    message=(f"{front.label} (stop {front.stop}) rides in front of {rear.label} "
                             f"(stop {rear.stop}); this vehicle's container slots fix that order."),
                    suggestion="Check the first site can lift it off past the other, or swap the drops.",
                    item_ids=[front.item_id, rear.item_id],
                )
    return None


def container_combo_warning(units: list[Unit], wanted: list[str], vehicle: VehicleConfig,
                            ref: ReferenceData) -> PlanWarning:
    """CONTAINER_COMBO: which mixes the vehicle takes, and a vehicle that takes this one."""
    allowed = list(dict.fromkeys(_mix([s.size_class for s in c.slots]) for c in vehicle.container_combos))
    if allowed:
        message = f"{_a(vehicle.name, capital=True)} takes {' or '.join(allowed)}, not {_mix(wanted)}."
    else:
        message = f"{_a(vehicle.name, capital=True)} doesn't take containers ({_mix(wanted)} requested)."
    others = sorted(
        (v for v in ref.vehicles.values()
         if v.id != vehicle.id and not v.configurable and not v.route_restricted
         and any(_combo_fits(wanted, [s.size_class for s in c.slots]) for c in v.container_combos)),
        key=lambda v: (v.max_teu, v.max_payload_kg),
    )
    suggestion = f"Try {_a(others[0].name)}, or split the containers across vehicles." if others \
        else "Split the containers across vehicles."
    return PlanWarning(code="CONTAINER_COMBO", severity="error", message=message, suggestion=suggestion,
                       item_ids=list(dict.fromkeys(u.item.id for u in units)))


# ---------------------------------------------------------------------------
# Utilisation and the planner
# ---------------------------------------------------------------------------

def _usage(used: float, available: float, ndigits: int) -> Usage:
    pct = used / available * 100 if available else 0.0
    return Usage(used=round(used, ndigits), available=round(available, ndigits), pct=round(pct, 1))


def utilisation(placements: list[Placement], vehicle: VehicleConfig, body: BodyType,
                ref: ReferenceData) -> Utilisation:
    floor = sum(floor_au_equivalent(p.type_id, p.length_mm, p.width_mm)
                for p in placements if p.kind == "pallet" and p.stack_level == 0)
    teu = sum(ref.containers[p.type_id].teu for p in placements if p.kind == "container")
    payload = sum(p.weight_kg for p in placements)
    volume = sum(p.length_mm * p.width_mm * p.height_mm for p in placements) / 1e9
    capacity = sum(
        d.length_mm * d.width_mm
        * (body.internal_height_mm if body.internal_height_mm is not None
           else vehicle.overall_height_limit_mm - d.deck_height_mm)
        for d in vehicle.cargo_decks
    ) / 1e9
    return Utilisation(
        pallet_spaces=_usage(round(floor, 1), vehicle.pallet_spaces, 1),
        teu=_usage(teu, vehicle.max_teu, 2),
        payload_kg=_usage(payload, vehicle.max_payload_kg, 1),
        volume_m3=_usage(volume, capacity, 2),
    )


def max_load_height_mm(placements: list[Placement], vehicle: VehicleConfig) -> int:
    """Tallest point above the ground: deck height + top of the unit, 0 when nothing is placed."""
    return max((vehicle.deck(p.deck_id).deck_height_mm + p.z_mm + p.height_mm for p in placements), default=0)


class HeuristicPlanner:
    name = "heuristic"

    def plan(self, req: PlanRequest, ref: ReferenceData) -> PlanResult:
        vehicle = ref.vehicles.get(req.vehicle_id)
        if vehicle is None:
            raise ValueError(f"Unknown vehicle '{req.vehicle_id}'.")
        body = checks.resolve_body(vehicle, req.body_type, ref)
        units = expand_units(req.items)
        warnings = list(checks.precheck(req.items, vehicle, body, ref).warnings)

        placements: list[Placement] = []
        unplaced: list[str] = []
        if len({i.kind for i in req.items}) > 1:
            unplaced = [u.unit_id for u in units]  # MIXED_FREIGHT comes from precheck
        else:
            unplaced = [u.unit_id for u in units if not _is_known(u, ref)]  # UNKNOWN_TYPE: precheck
            known = [u for u in units if _is_known(u, ref)]
            pallet_units = [u for u in known if u.item.kind == "pallet"]
            container_units = [u for u in known if u.item.kind == "container"]
            if pallet_units:
                oversize = oversize_unit_ids(pallet_units, vehicle, ref)
                if oversize:
                    warnings.append(oversize_warning(pallet_units, vehicle, ref))
                    unplaced += [u.unit_id for u in pallet_units if u.unit_id in oversize]
                    pallet_units = [u for u in pallet_units if u.unit_id not in oversize]
                placed, missed = place_pallets(pallet_units, vehicle, body, ref)
                placements += placed
                unplaced += missed
                if missed:
                    missed_set = set(missed)
                    missed_units = [u for u in pallet_units if u.unit_id in missed_set]
                    warnings.append(over_capacity_warning(missed_units, placed, vehicle, body, ref))
                cap = stack_height_cap(vehicle, body, ref)
                unstackable = unstackable_floor_warning(pallet_units, cap, ref, short_of_space=bool(missed))
                if unstackable is not None:
                    warnings.append(unstackable)
            if container_units:
                placed, missed, container_warnings = place_containers(container_units, vehicle, ref)
                placements += placed
                unplaced += missed
                warnings += container_warnings
        order = {u.unit_id: i for i, u in enumerate(units)}
        unplaced.sort(key=order.__getitem__)

        total_weight = round(sum(p.weight_kg for p in placements), 1)
        axle_loads = axles.estimate_axle_loads(vehicle, placements, req.mass_scheme)
        # Precheck already reports freight that is too tall on its own: don't repeat it for the stacks.
        seen = {w.code for w in warnings} & {"OVER_HEIGHT_LIMIT"}
        warnings += [w for w in checks.postcheck(placements, vehicle, body, axle_loads, total_weight,
                                                 req.mass_scheme, ref).warnings if w.code not in seen]
        reasons = [w.message for w in warnings if w.severity == "error"]
        return PlanResult(
            fits=not reasons, reasons=reasons, warnings=warnings,
            vehicle_id=vehicle.id, vehicle_name=vehicle.name, body_type=body.id, mass_scheme=req.mass_scheme,
            placements=placements, unplaced=unplaced,
            utilisation=utilisation(placements, vehicle, body, ref),
            axle_loads=axle_loads, total_weight_kg=total_weight,
            max_load_height_mm=max_load_height_mm(placements, vehicle),
            planner=self.name,
        )
