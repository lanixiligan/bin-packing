"""
Split a load across the fewest trucks of one vehicle type (POST /api/plan/fleet).

The single-truck planner (heuristic.py) checks one vehicle in depth; the sized bin packing solver
(app/solver.py) splits freight across trucks. `plan_fleet` joins them: the solver (or, for big
loads, the heuristic) decides which unit goes in which truck and where, and every truck then gets
the planner's full single-vehicle result (`heuristic.finish_plan`): axle loads, utilisation and
warnings. Pallets and loose items only; every truck is the same vehicle and body.

`plan_fleet(req, ref)`
----------------------
1. Prepare. Resolve the vehicle and body, expand the units (`unit_id = "<item.id>#<n>"`, numbered
   over the whole request, so ids are unique across the fleet) and run `checks.precheck` on the
   whole request.
   - A body problem (not allowed, out of scope, doesn't carry this freight) stops everything: no
     truck of this kind can take the load, so every unit is `unplaced`.
   - A line that no truck can ever take (unknown pallet type, too tall, too heavy, too long, or
     heavy enough to overload an axle group wherever it stands) goes to `unplaced` with its
     reason. The rest are packed.
   - Goods the carrier refuses (DG_CARRIER_REFUSED) are still packed, but the fleet doesn't fit.
2. Exact path, up to EXACT_LIMIT units: CP-SAT (`solver.solve`) with the truck's payload, decks
   (inside height = the planner's stack height cap), floor cap (the vehicle's pallet spaces),
   dangerous goods segregation and axle limits (`axle_coefficients`). Units stack as in the
   heuristic: both stackable, the same pallet type or the same loose length x width, within the
   stack height cap.
3. Heuristic path, more than EXACT_LIMIT units (`_heuristic_trucks`): truck by truck. Each truck
   takes a set of dangerous goods groups that may travel together (greedy colouring of the
   app/dg.py conflict graph, most conflicts first, redone for every truck from what is left; the
   groups that still have a conflict are offered first), the single-truck placement
   (`place_pallets`) loads what fits of them, and while the truck is over
   its payload or an axle limit a unit goes back to the pool: for the payload the lightest unit
   that fixes it (else the heaviest), for an axle group the heaviest unit on the decks that feed
   it. Units that can't be loaded even into an empty truck end up `unplaced`. This runs twice
   and the split with fewer trucks wins: once offering each truck every unit left (so the biggest
   and heaviest go first), once offering it a mix of heavy and light units that fills the payload
   and the floor together (`_offer`).
4. Every truck becomes a PlanResult through `finish_plan`, with the precheck warnings of its own
   items only (e.g. DG_ON_BOARD names just the classes on that truck).
5. Bounds come from `solver.lower_bounds`. `optimal` means CP-SAT proved it, or the number of
   trucks equals the lower bound. The heuristic path's status is "HEURISTIC".

Solver weights are whole kg, rounded up. A unit behind a deck's rear support (or ahead of its
front one) takes load OFF the far axle group, where rounding up would be optimistic, so each
group's capacity is first reduced by the most that rounding could hide (`_solver_truck`; zero for
whole-kg weights).
"""

import math
import time
from collections import Counter

from app import solver
from app.planner import axles, checks
from app.planner.heuristic import (
    AU_AREA_MM2,
    Unit,
    expand_units,
    finish_plan,
    oversize_unit_ids,
    oversize_warning,
    place_pallets,
    stack_height_cap,
    stack_key,
    unit_footprint,
    unit_height,
    unstackable_floor_warning,
)
from app.planner.models import FleetResult, Placement, PlanRequest, PlanResult, PlanWarning
from app.reference.schemas import BodyType, MassScheme, ReferenceData, VehicleConfig

PLANNER = "fleet"
EXACT_LIMIT = 80            # most units the exact solver takes; bigger loads use the heuristic
EXACT_TIME_LIMIT_S = 10.0

# Precheck errors that rule the vehicle or body out for every unit.
_VEHICLE_BLOCKERS = {"BODY_NOT_ALLOWED", "OUT_OF_SCOPE_BODY", "BODY_INCOMPATIBLE"}
# Precheck errors that rule a line out on any truck of this kind (see their item_ids).
_ITEM_BLOCKERS = {"UNKNOWN_TYPE", "PALLET_OVER_MAX_GROSS", "STACK_TOO_HIGH", "OVER_INTERNAL_HEIGHT",
                  "OVER_HEIGHT_LIMIT", "OVERSIZE_FOOTPRINT", "OVER_PAYLOAD"}

_PROBE_KG = 1000.0
_PROBE_MM = 10_000


# ---------------------------------------------------------------------------
# Axle coefficients
# ---------------------------------------------------------------------------

def axle_coefficients(vehicle: VehicleConfig, scheme: MassScheme = "GML") -> tuple[solver.AxleLimit, ...]:
    """Each axle group's limit as the solver wants it, in `vehicle.axle_groups` order.

    A load of w kg whose centre is x mm from the front of cargo deck d adds w * (alpha + beta * x)
    to the group, with (alpha, beta) = coef[d] in `vehicle.cargo_decks` order, and may add up to
    `cap_kg` = the group's limit minus its tare. The coefficients are read off
    `axles.estimate_axle_loads` with a probe load at two positions per deck: exact, because that
    model is linear in every load's weight and position."""
    def shares(deck_id: str, x_mm: int) -> list[float]:
        probe = Placement(unit_id="probe", item_id="probe", label="", kind="loose", type_id="LOOSE",
                          deck_id=deck_id, x_mm=x_mm, y_mm=0, z_mm=0, length_mm=0, width_mm=0, height_mm=0,
                          stack_id=0, stack_level=0, weight_kg=_PROBE_KG)
        loads = axles.estimate_axle_loads(vehicle, [probe], scheme)
        return [(a.load_kg - g.tare_kg) / _PROBE_KG for a, g in zip(loads, vehicle.axle_groups, strict=True)]

    per_deck = [(shares(d.id, 0), shares(d.id, _PROBE_MM)) for d in vehicle.cargo_decks]
    return tuple(
        solver.AxleLimit(name=g.name, cap_kg=g.limit(scheme) - g.tare_kg,
                         coef=tuple((at0[k], (at1[k] - at0[k]) / _PROBE_MM) for at0, at1 in per_deck))
        for k, g in enumerate(vehicle.axle_groups))


# ---------------------------------------------------------------------------
# Units as solver items
# ---------------------------------------------------------------------------

def _solver_item(index: int, unit: Unit, cap_mm: int, ref: ReferenceData) -> solver.Item:
    """A unit as the solver sees it: whole kg (rounded up) and the heuristic's stacking rule."""
    length, width = unit_footprint(unit, ref)
    height = unit_height(unit, ref)
    return solver.Item(id=index, name=unit.item.label or unit.item.id, weight=math.ceil(unit.weight_kg),
                       length=length, width=width, height=height,
                       stackable=unit.item.stackable and height <= cap_mm, footprint=stack_key(unit),
                       dg=unit.item.dg)


def _solver_truck(vehicle: VehicleConfig, body: BodyType, scheme: MassScheme, ref: ReferenceData,
                  rounding_kg: float = 0.0) -> solver.Truck:
    """The vehicle as the solver sees it. `rounding_kg` is the weight added by rounding every unit
    up to whole kg: each axle group's capacity drops by the most load that could hide (see the
    module docstring)."""
    cap = stack_height_cap(vehicle, body, ref)
    decks = tuple(solver.DeckSpec(id=d.id, name=d.name, length=d.length_mm, width=d.width_mm, height=cap)
                  for d in vehicle.cargo_decks)
    limits = []
    for lim in axle_coefficients(vehicle, scheme):
        relief = max(0.0, *(-lim.share(k, x) for k, d in enumerate(decks) for x in (0, d.length)))
        limits.append(solver.AxleLimit(lim.name, lim.cap_kg - rounding_kg * relief, lim.coef))
    return solver.Truck(payload_kg=int(vehicle.max_payload_kg), decks=decks, name=vehicle.name,
                        axle_limits=tuple(limits), max_floor_mm2=int(vehicle.pallet_spaces * AU_AREA_MM2))


# ---------------------------------------------------------------------------
# Exact path
# ---------------------------------------------------------------------------

def _placement(unit: Unit, *, deck_id: str, x: int, y: int, z: int, length: int, width: int, height: int,
               rotated: bool, stack_id: int, level: int) -> Placement:
    item = unit.item
    return Placement(
        unit_id=unit.unit_id, item_id=item.id, label=item.label or item.id, kind=item.kind,
        type_id=item.type_id, deck_id=deck_id, x_mm=x, y_mm=y, z_mm=z, length_mm=length, width_mm=width,
        height_mm=height, rotated=rotated, stack_id=stack_id, stack_level=level,
        weight_kg=item.gross_weight_kg, stackable=item.stackable, temp_controlled=item.temp_controlled)


def _exact_trucks(units: list[Unit], items: list[solver.Item], truck: solver.Truck,
                  time_limit_s: float) -> tuple[list[list[Placement]], solver.Solution]:
    """CP-SAT's packing as planner placements per truck: floor units first (by deck, x, y), stacks
    numbered from 1 in that order."""
    solution = solver.solve(items, truck, time_limit_s)
    trucks = []
    for placed in solution.trucks:
        stack_ids: dict[int, int] = {}
        for p in placed:
            if p.level == 0:
                stack_ids[p.id] = len(stack_ids) + 1
        trucks.append([
            _placement(units[p.id], deck_id=truck.decks[p.deck].id, x=p.x, y=p.y, z=p.z, length=p.length,
                       width=p.width, height=p.height, rotated=p.rotated, stack_id=stack_ids[p.base],
                       level=p.level)
            for p in placed])
    return trucks, solution


# ---------------------------------------------------------------------------
# Heuristic path
# ---------------------------------------------------------------------------

def _compatible_groups(pool: list[int], items: list[solver.Item], group: list[int],
                       conflicts: set[tuple[int, int]]) -> tuple[set[int], set[int]]:
    """One colour of a greedy colouring of the dangerous goods groups still in `pool`: the group
    with the most conflicts first (then the heaviest), then every group that may travel with all
    the groups chosen so far. Returns (the groups, those of them with a conflict left in the pool)."""
    weight: Counter[int] = Counter()
    for i in pool:
        weight[group[i]] += items[i].weight
    left = set(weight)
    degree = {g: sum(1 for h in left if (min(g, h), max(g, h)) in conflicts) for g in left}
    chosen: set[int] = set()
    for g in sorted(left, key=lambda g: (-degree[g], -weight[g], g)):
        if not any((min(g, h), max(g, h)) in conflicts for h in chosen):
            chosen.add(g)
    return chosen, {g for g in chosen if degree[g]}


def _offer(first: list[Unit], rest: list[Unit], vehicle: VehicleConfig, cap_mm: int, ref: ReferenceData,
           balanced: bool) -> list[Unit]:
    """About one truck's worth of units, by weight and floor area (a stackable unit counts for its
    share of a full-height stack): the `first` units, heaviest first, then from `rest`.

    `balanced` mixes heavy and light units so that the payload and the floor fill up together: the
    heaviest unit left while the floor is the fuller of the two, else the lightest. Otherwise the
    heaviest is always next."""
    payload = vehicle.max_payload_kg
    floor = min(vehicle.pallet_spaces * AU_AREA_MM2,
                sum(d.length_mm * d.width_mm for d in vehicle.cargo_decks))
    picked: list[Unit] = []
    weight = area = 0.0

    def take(unit: Unit) -> None:
        nonlocal weight, area
        length, width = unit_footprint(unit, ref)
        height = unit_height(unit, ref)
        share = length * width * (height / cap_mm if unit.item.stackable and height <= cap_mm else 1.0)
        if area + share <= floor:
            picked.append(unit)
            weight += unit.weight_kg
            area += share

    for unit in sorted(first, key=lambda u: -u.weight_kg):
        if weight + unit.weight_kg <= payload + 1e-6:
            take(unit)
    queue = sorted(rest, key=lambda u: -u.weight_kg)
    front, back = 0, len(queue) - 1
    while front <= back:
        heavy = not balanced or weight * floor <= area * payload
        unit = queue[front if heavy else back]
        if heavy:
            front += 1
        else:
            back -= 1
        if weight + unit.weight_kg <= payload + 1e-6:
            take(unit)
        elif not heavy:
            break   # not even the lightest unit left fits the payload
    return picked


def _load_one_truck(candidates: list[Unit], vehicle: VehicleConfig, body: BodyType, scheme: MassScheme,
                    ref: ReferenceData) -> list[Placement]:
    """Load one truck from `candidates` with the single-truck placement, then send units back until
    it is within its payload and every axle limit. May return nothing."""
    keep = candidates
    while keep:
        placements, _ = place_pallets(keep, vehicle, body, ref)
        if not placements:
            return []
        victim: str | None = None
        over = sum(p.weight_kg for p in placements) - vehicle.max_payload_kg
        if over > 1e-6:
            enough = [p for p in placements if p.weight_kg >= over]
            victim = (min(enough, key=lambda p: p.weight_kg) if enough
                      else max(placements, key=lambda p: p.weight_kg)).unit_id
        else:
            loads = axles.estimate_axle_loads(vehicle, placements, scheme)
            worst = max((a for a in loads if a.status == "over"), key=lambda a: a.load_kg - a.limit_kg,
                        default=None)
            if worst is not None:
                decks = checks.feeding_decks(vehicle, worst.group_id)
                on_decks = [p for p in placements if p.deck_id in decks] or placements
                victim = max(on_decks, key=lambda p: p.weight_kg).unit_id
        if victim is None:
            return placements
        placed = {p.unit_id for p in placements}
        keep = [u for u in keep if u.unit_id in placed and u.unit_id != victim]
    return []


def _heuristic_trucks(units: list[Unit], items: list[solver.Item], vehicle: VehicleConfig, body: BodyType,
                      scheme: MassScheme, ref: ReferenceData,
                      balanced: bool) -> tuple[list[list[Placement]], list[Unit]]:
    """(placements per truck, units that couldn't be loaded even into an empty truck).

    Each truck is offered the units of dangerous goods groups that still have a conflict in the
    pool first, so they are not left for a truck of their own. `balanced` then offers a mix of
    heavy and light units (`_offer`); otherwise every unit left is offered and the placement takes
    the biggest and heaviest."""
    group, conflicts = solver.dg_groups(items)
    cap = stack_height_cap(vehicle, body, ref)
    pool = list(range(len(units)))
    trucks: list[list[Placement]] = []
    stuck: list[Unit] = []
    while pool:
        chosen, restricted = _compatible_groups(pool, items, group, conflicts)
        candidates = [units[i] for i in pool if group[i] in chosen]
        offer = candidates
        if balanced or restricted:
            first = [units[i] for i in pool if group[i] in restricted]
            rest = [units[i] for i in pool if group[i] in chosen - restricted]
            offer = _offer(first, rest, vehicle, cap, ref, balanced)
        placements = _load_one_truck(offer, vehicle, body, scheme, ref)
        if not placements and len(offer) < len(candidates):
            placements = _load_one_truck(candidates, vehicle, body, scheme, ref)
        if placements:
            trucks.append(placements)
            gone = {p.unit_id for p in placements}
        else:   # no progress with these units: an empty truck won't take any of them
            stuck += candidates
            gone = {u.unit_id for u in candidates}
        pool = [i for i in pool if units[i].unit_id not in gone]
    return trucks, stuck


# ---------------------------------------------------------------------------
# The fleet
# ---------------------------------------------------------------------------

def _truck_result(placements: list[Placement], units_by_id: dict[str, Unit], req: PlanRequest,
                  vehicle: VehicleConfig, body: BodyType, ref: ReferenceData, planner: str) -> PlanResult:
    """One truck's full single-vehicle result, with the precheck warnings of its own items."""
    counts = Counter(p.item_id for p in placements)
    own_items = [it.model_copy(update={"quantity": counts[it.id]}) for it in req.items if counts[it.id]]
    warnings = list(checks.precheck(own_items, vehicle, body, ref, req.rule_set).warnings)
    unstackable = unstackable_floor_warning([units_by_id[p.unit_id] for p in placements],
                                            stack_height_cap(vehicle, body, ref), ref, short_of_space=False)
    if unstackable is not None:
        warnings.append(unstackable)
    return finish_plan(vehicle=vehicle, body=body, mass_scheme=req.mass_scheme, ref=ref,
                       placements=placements, unplaced=[], warnings=warnings, planner=planner)


def _never_fit(req: PlanRequest, units: list[Unit], vehicle: VehicleConfig, body: BodyType,
               scheme: MassScheme, ref: ReferenceData,
               precheck: list[PlanWarning]) -> tuple[set[str], list[str]]:
    """(ids of the lines no truck of this kind can ever take, why)."""
    bad: set[str] = set()
    reasons: list[str] = []
    for w in precheck:
        if w.severity == "error" and w.code in _ITEM_BLOCKERS and w.item_ids:
            bad |= set(w.item_ids)
            reasons.append(w.message)
    rest = [u for u in units if u.item.id not in bad]
    oversize = oversize_unit_ids(rest, vehicle, ref)
    if oversize:
        warning = oversize_warning(rest, vehicle, ref)   # pallets; precheck reported loose items
        if warning is not None:
            reasons.append(warning.message)
        bad |= {u.item.id for u in rest if u.unit_id in oversize}
    truck = _solver_truck(vehicle, body, scheme, ref)
    cap = stack_height_cap(vehicle, body, ref)
    for item in req.items:
        if item.id not in bad:
            why = solver.never_fit_reasons(_solver_item(0, Unit(f"{item.id}#1", item), cap, ref), truck)
            if why:
                bad.add(item.id)
                reasons += [f"{r}." for r in why]
    return bad, reasons


def plan_fleet(req: PlanRequest, ref: ReferenceData, time_limit_s: float = EXACT_TIME_LIMIT_S) -> FleetResult:
    """Split `req.items` across the fewest trucks of vehicle `req.vehicle_id` (see the module
    docstring). Raises ValueError for an unknown vehicle or body, or for containers."""
    start = time.perf_counter()
    vehicle = ref.vehicles.get(req.vehicle_id)
    if vehicle is None:
        raise ValueError(f"Unknown vehicle '{req.vehicle_id}'.")
    body = checks.resolve_body(vehicle, req.body_type, ref)
    if any(i.kind == "container" for i in req.items):
        raise ValueError("Split mode takes pallets and loose freight, not containers.")
    scheme = req.mass_scheme
    units = expand_units(req.items)
    units_by_id = {u.unit_id: u for u in units}
    precheck = checks.precheck(req.items, vehicle, body, ref, req.rule_set).warnings

    def result(*, trucks: list[PlanResult], unplaced: list[Unit], reasons: list[str], bounds: dict[str, int],
               method: str, status: str, proven: bool) -> FleetResult:
        reasons = list(dict.fromkeys(reasons))
        for number, t in enumerate(trucks, start=1):
            reasons += [f"Truck {number}: {r}" for r in t.reasons if r not in reasons]
        lower_bound = max(bounds.values(), default=0)
        return FleetResult(
            vehicle_id=vehicle.id, vehicle_name=vehicle.name, body_type=body.id, mass_scheme=scheme,
            fits=not reasons and not unplaced, reasons=reasons, num_trucks=len(trucks), trucks=trucks,
            unplaced=[u.unit_id for u in unplaced], lower_bound=lower_bound, lower_bounds=bounds,
            optimal=bool(trucks) and (proven or len(trucks) == lower_bound), method=method, status=status,
            solve_time_ms=round((time.perf_counter() - start) * 1000, 1), planner=PLANNER)

    no_bounds = {"weight": 0, "floor": 0, "volume": 0}
    blockers = [w.message for w in precheck if w.severity == "error" and w.code in _VEHICLE_BLOCKERS]
    if not vehicle.cargo_decks:
        blockers.append(f"The {vehicle.name} has no cargo deck.")
    if blockers:
        return result(trucks=[], unplaced=units, reasons=blockers, bounds=no_bounds, method="exact",
                      status="NOT_PACKED", proven=False)

    bad, reasons = _never_fit(req, units, vehicle, body, scheme, ref, precheck)
    reasons += [w.message for w in precheck if w.severity == "error" and w.code == "DG_CARRIER_REFUSED"]
    unplaced = [u for u in units if u.item.id in bad]
    packable = [u for u in units if u.item.id not in bad]
    if not packable:
        return result(trucks=[], unplaced=unplaced, reasons=reasons, bounds=no_bounds, method="exact",
                      status="NOT_PACKED", proven=False)

    cap = stack_height_cap(vehicle, body, ref)
    items = [_solver_item(k, u, cap, ref) for k, u in enumerate(packable)]
    rounding = sum(it.weight - u.weight_kg for it, u in zip(items, packable, strict=True))
    truck = _solver_truck(vehicle, body, scheme, ref, rounding)
    bounds = solver.lower_bounds(items, truck)
    bounds = {k: max(1, bounds[k]) if k == "weight" else bounds[k] for k in ("weight", "floor", "volume")}

    if len(packable) <= EXACT_LIMIT:
        loads, solution = _exact_trucks(packable, items, truck, time_limit_s)
        method, status, proven = "exact", solution.status, solution.status == "OPTIMAL"
    else:
        # Two passes, the better one wins: every truck offered all the units left (the biggest and
        # heaviest load first), or a mix of heavy and light ones.
        loads, stuck = min((_heuristic_trucks(packable, items, vehicle, body, scheme, ref, balanced)
                            for balanced in (True, False)), key=lambda r: (len(r[1]), len(r[0])))
        method, status, proven = "heuristic", "HEURISTIC", False
        if stuck:
            unplaced += stuck
            names = ", ".join(dict.fromkeys(f'"{u.item.label or u.item.id}"' for u in stuck))
            reasons.append(f"{len(stuck)} unit(s) of {names} couldn't be loaded on a {vehicle.name}, even on "
                           "their own.")
    order = {u.unit_id: k for k, u in enumerate(units)}
    unplaced.sort(key=lambda u: order[u.unit_id])
    trucks = [_truck_result(p, units_by_id, req, vehicle, body, ref, PLANNER) for p in loads]
    return result(trucks=trucks, unplaced=unplaced, reasons=reasons, bounds=bounds, method=method,
                  status=status, proven=proven)

