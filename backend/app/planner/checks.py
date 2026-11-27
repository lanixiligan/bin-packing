"""
Rule checks shared by every planner. Pure functions.

`precheck` runs before placement on the requested freight. `postcheck` runs on the finished
placement. Both return warnings, and severity "error" means the load does not fit.

Messages are plain language for the person loading the truck: what is wrong (in metres and
tonnes) and, in `suggestion`, what to try next. The data itself stays in mm and kg.
"""

from collections import defaultdict
from dataclasses import dataclass, field

from app.planner.models import AxleLoad, FreightItem, Placement, PlanWarning
from app.reference.schemas import BodyType, MassScheme, ReferenceData, VehicleConfig


@dataclass
class CheckResult:
    warnings: list[PlanWarning] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Formatting helpers
# ---------------------------------------------------------------------------

def _num(value: float) -> str:
    """1-2 decimal places: 2.1, 1.8, 2.59, 24.0."""
    text = f"{value:.2f}"
    return text[:-1] if text.endswith("0") else text


def _m(mm: float) -> str:
    return f"{_num(mm / 1000)} m"


def _t(kg: float) -> str:
    return f"{_num(kg / 1000)} t"


def _name(item: FreightItem) -> str:
    return f'"{item.label}"' if item.label else f'"{item.id}"'


def _join(names: list[str]) -> str:
    if len(names) <= 1:
        return "".join(names)
    return ", ".join(names[:-1]) + " or " + names[-1]


def _allowed_bodies(vehicle: VehicleConfig, ref: ReferenceData, *, pallets: bool = False,
                    containers: bool = False, temp: bool = False) -> list[BodyType]:
    """In-scope bodies allowed on the vehicle that meet the wishes, default body first."""
    ids = sorted(vehicle.allowed_bodies, key=lambda b: b != vehicle.default_body)
    out = []
    for body_id in ids:
        body = ref.bodies.get(body_id)
        if body is None or not body.in_scope:
            continue
        if pallets and not body.carries_pallets:
            continue
        if containers and not (body.carries_containers or body.container_optional):
            continue
        if temp and not body.temp_controlled:
            continue
        out.append(body)
    return out


def _body_names(bodies: list[BodyType]) -> str:
    return _join([f"a {b.name.lower()}" for b in bodies])


def _max_deck_height(vehicle: VehicleConfig) -> int:
    return max((d.deck_height_mm for d in vehicle.cargo_decks), default=0)


# ---------------------------------------------------------------------------
# Checks
# ---------------------------------------------------------------------------

def resolve_body(vehicle: VehicleConfig, body_type: str | None, ref: ReferenceData) -> BodyType:
    """The requested body (or the vehicle's default). Raises ValueError for an unknown id."""
    body_id = body_type or vehicle.default_body
    body = ref.bodies.get(body_id)
    if body is None:
        raise ValueError(f"Unknown body type '{body_id}'.")
    return body


def precheck(items: list[FreightItem], vehicle: VehicleConfig, body: BodyType,
             ref: ReferenceData) -> CheckResult:
    """Unknown types, mixed freight, body/vehicle compatibility, out-of-scope bodies, reefer items,
    per-item height (max stack, internal, overall limit), container gross vs max gross,
    route-restricted vehicles."""
    out: list[PlanWarning] = []

    def warn(code, severity, message, suggestion="", item_ids=None):
        out.append(PlanWarning(code=code, severity=severity, message=message, suggestion=suggestion,
                               item_ids=item_ids or []))

    # Unknown types: skip the item in every later per-item check.
    known: list[FreightItem] = []
    for it in items:
        table = ref.pallets if it.kind == "pallet" else ref.containers
        if it.type_id in table:
            known.append(it)
            continue
        options = ", ".join(sorted(table))
        warn("UNKNOWN_TYPE", "error",
             f"Item {_name(it)} uses an unknown {it.kind} type '{it.type_id}'.",
             f"Pick one of: {options}.", [it.id])

    pallet_items = [it for it in items if it.kind == "pallet"]
    container_items = [it for it in items if it.kind == "container"]

    if pallet_items and container_items:
        warn("MIXED_FREIGHT", "error",
             "This load mixes pallets and containers; a plan can hold only one kind.",
             "Plan the pallets and the containers as separate loads.", [it.id for it in items])

    # Body vs vehicle.
    if body.id not in vehicle.allowed_bodies:
        wanted = _allowed_bodies(vehicle, ref, pallets=bool(pallet_items), containers=bool(container_items))
        wanted = wanted or _allowed_bodies(vehicle, ref)
        suggestion = (f"Choose {_body_names(wanted[:3])}, which the {vehicle.name} can take."
                      if wanted else "Choose a different vehicle.")
        warn("BODY_NOT_ALLOWED", "error",
             f"A {body.name.lower()} body isn't available on the {vehicle.name}.", suggestion)

    if not body.in_scope:
        warn("OUT_OF_SCOPE_BODY", "error",
             f"The planner doesn't plan loads for a {body.name.lower()} body.",
             "Choose a pallet or container body such as a tautliner, pantech, flat top or skeletal.")
    else:
        if pallet_items and not body.carries_pallets:
            alt = _allowed_bodies(vehicle, ref, pallets=True)
            warn("BODY_INCOMPATIBLE", "error",
                 f"Pallets can't go on a {body.name.lower()} body.",
                 f"Use {_body_names(alt[:3])} instead." if alt
                 else "Choose a vehicle that takes pallet bodies.",
                 [it.id for it in pallet_items])
        if container_items and not (body.carries_containers or body.container_optional):
            alt = _allowed_bodies(vehicle, ref, containers=True)
            warn("BODY_INCOMPATIBLE", "error",
                 f"Containers can't go on a {body.name.lower()} body.",
                 f"Use {_body_names(alt[:3])} instead." if alt
                 else "Choose a vehicle that takes a skeletal or flat-top body.",
                 [it.id for it in container_items])

    # Temperature control.
    temp_pallets = [it for it in pallet_items if it.temp_controlled]
    if temp_pallets and not body.temp_controlled:
        alt = _allowed_bodies(vehicle, ref, pallets=True, temp=True)
        warn("REEFER_ON_NON_REEFER", "warning",
             f"Temperature-controlled freight is going on a {body.name.lower()}, which has no refrigeration.",
             f"Use {_body_names(alt[:1])} to keep it cold." if alt
             else "Choose a vehicle with a refrigerated body to keep it cold.",
             [it.id for it in temp_pallets])
    temp_containers = [it for it in container_items if it.temp_controlled and it.type_id in ref.containers
                       and not ref.containers[it.type_id].temp_controlled]
    if temp_containers:
        reefers = [c.name for c in ref.containers.values() if c.temp_controlled]
        warn("REEFER_ON_NON_REEFER", "warning",
             "Temperature-controlled freight is in a container type without refrigeration.",
             f"Use a reefer container (e.g. {reefers[0]})." if reefers else "Use a reefer container.",
             [it.id for it in temp_containers])

    # Per-item heights and weights.
    max_stack = ref.pallet_defaults.max_stack_height_mm
    deck_h = _max_deck_height(vehicle)
    limit = vehicle.overall_height_limit_mm
    for it in known:
        if it.kind == "pallet":
            h = it.height_mm if it.height_mm is not None else max_stack
            max_gross = ref.pallet_defaults.max_gross_for(ref.pallets[it.type_id])
            if it.gross_weight_kg > max_gross:
                warn("PALLET_OVER_MAX_GROSS", "error",
                     f"Pallet {_name(it)} weighs {_t(it.gross_weight_kg)}; one pallet is limited to "
                     f"{_t(max_gross)}.",
                     "Split the freight across more pallets, or check the carrier's per-pallet limit.",
                     [it.id])
            if h > max_stack:
                warn("STACK_TOO_HIGH", "error",
                     f"Pallet {_name(it)} is {_m(h)} tall; the max stack height is {_m(max_stack)}.",
                     "Split it into two pallets or check the carrier's limit.", [it.id])
            if body.internal_height_mm is not None and h > body.internal_height_mm:
                warn("OVER_INTERNAL_HEIGHT", "error",
                     f"Pallet {_name(it)} is {_m(h)} tall; the {body.name.lower()} has "
                     f"{_m(body.internal_height_mm)} inside.",
                     "Lower the pallet or choose a body with more internal height (or an open flat top).",
                     [it.id])
            if deck_h + h > limit:
                warn("OVER_HEIGHT_LIMIT", "error",
                     f"Pallet {_name(it)} would reach {_m(deck_h + h)} above the road on the "
                     f"{_m(deck_h)} deck; the height limit is {_m(limit)}.",
                     "Lower the pallet or choose a vehicle with a lower deck.", [it.id])
        else:
            ct = ref.containers[it.type_id]
            if ct.ext_height_mm is not None and deck_h + ct.ext_height_mm > limit:
                warn("OVER_HEIGHT_LIMIT", "error",
                     f"A {ct.name} on the {_m(deck_h)} deck would reach {_m(deck_h + ct.ext_height_mm)}; "
                     f"the height limit is {_m(limit)}.",
                     "Use a lower deck (e.g. a drop-deck skeletal) or a standard-height container, "
                     "or get a high-vehicle permit.", [it.id])
            if ct.max_gross_kg is not None and it.gross_weight_kg > ct.max_gross_kg:
                warn("CONTAINER_OVER_MAX_GROSS", "error",
                     f"Container {_name(it)} weighs {_t(it.gross_weight_kg)}; a {ct.name} is rated to "
                     f"{_t(ct.max_gross_kg)} gross.",
                     "Check the declared weight or move some cargo into another container.", [it.id])

    if vehicle.route_restricted:
        note = f" {vehicle.permit_note}" if vehicle.permit_note else ""
        warn("ROUTE_RESTRICTED", "info",
             f"The {vehicle.name} can only run on approved routes.{note}",
             "Check the route and permits before you book it.")

    return CheckResult(out)


def _smallest_vehicle_for(weight_kg: float, current: VehicleConfig,
                          ref: ReferenceData) -> VehicleConfig | None:
    """The smallest other vehicle that can carry the weight; general-access, fixed vehicles first."""
    fits = [v for v in ref.vehicles.values() if v.id != current.id and v.max_payload_kg >= weight_kg]
    return min(fits, key=lambda v: (v.route_restricted or v.configurable, v.pallet_spaces, v.max_payload_kg),
               default=None)


def _feeding_decks(vehicle: VehicleConfig, group_id: str) -> set[str]:
    """Decks whose load reaches the axle group (directly, or through decks resting on them)."""
    decks = {d.id for d in vehicle.decks
             if group_id in (d.front_support.axle_group, d.rear_support.axle_group)}
    changed = True
    while changed:
        changed = False
        for d in vehicle.decks:
            if d.id not in decks and ({d.front_support.on_deck, d.rear_support.on_deck} & decks):
                decks.add(d.id)
                changed = True
    return decks


def _axle_direction(vehicle: VehicleConfig, group_id: str) -> str:
    positions = sorted(g.position_mm for g in vehicle.axle_groups)
    pos = vehicle.axle_group(group_id).position_mm
    if pos >= positions[-1]:
        return "forward"
    if pos <= positions[0]:
        return "towards the rear"
    return "away from it (forward or rearward)"


def postcheck(placements: list[Placement], vehicle: VehicleConfig, body: BodyType,
              axle_loads: list[AxleLoad], total_weight_kg: float, mass_scheme: MassScheme,
              ref: ReferenceData) -> CheckResult:
    """Payload, overall height of the placed load, axle near/over limit (with suggestions)."""
    out: list[PlanWarning] = []

    if total_weight_kg > vehicle.max_payload_kg + 1e-6:
        over = total_weight_kg - vehicle.max_payload_kg
        bigger = _smallest_vehicle_for(total_weight_kg, vehicle, ref)
        if bigger is None:
            suggestion = "Split the load across two vehicles."
        else:
            permit = " (it needs route approval)" if bigger.route_restricted else ""
            suggestion = (f"Use a {bigger.name} (up to {_t(bigger.max_payload_kg)}){permit}, "
                          "or split the load across two vehicles.")
        out.append(PlanWarning(
            code="OVER_PAYLOAD", severity="error",
            message=(f"Over by {_t(over)}: the load weighs {_t(total_weight_kg)} and the {vehicle.name} "
                     f"can carry {_t(vehicle.max_payload_kg)}."),
            suggestion=suggestion, item_ids=sorted({p.item_id for p in placements})))

    # Overall height of the placed load (per stack, reported once).
    deck_heights = {d.id: d.deck_height_mm for d in vehicle.decks}
    limit = vehicle.overall_height_limit_mm
    stack_top: dict[tuple[str, int], int] = defaultdict(int)
    stack_items: dict[tuple[str, int], set[str]] = defaultdict(set)
    for p in placements:
        key = (p.deck_id, p.stack_id)
        stack_top[key] = max(stack_top[key], deck_heights.get(p.deck_id, 0) + p.z_mm + p.height_mm)
        stack_items[key].add(p.item_id)
    too_high = [k for k, top in stack_top.items() if top > limit]
    if too_high:
        tallest = max(stack_top[k] for k in too_high)
        count = "1 stack reaches" if len(too_high) == 1 else f"{len(too_high)} stacks reach"
        out.append(PlanWarning(
            code="OVER_HEIGHT_LIMIT", severity="error",
            message=f"{count} above the {_m(limit)} height limit (the tallest to {_m(tallest)}).",
            suggestion="Stack lower, or choose a vehicle with a lower deck.",
            item_ids=sorted(set().union(*(stack_items[k] for k in too_high)))))

    # Axle groups.
    for a in axle_loads:
        group = vehicle.axle_group(a.group_id)
        decks = _feeding_decks(vehicle, a.group_id)
        item_ids = sorted({p.item_id for p in placements if p.deck_id in decks})
        if a.status == "over":
            direction = _axle_direction(vehicle, a.group_id)
            tips = [f"Move heavy freight {direction}, towards the other axle groups, or rebalance the load."]
            if mass_scheme == "GML" and group.hml_kg is not None and a.load_kg <= group.hml_kg:
                tips.append(f"If the vehicle is HML accredited, its HML limit of {_t(group.hml_kg)} "
                            "would cover it.")
            out.append(PlanWarning(
                code="AXLE_OVER_LIMIT", severity="error",
                message=(f"The {a.name.lower()} carries about {_t(a.load_kg)}; its {mass_scheme} limit is "
                         f"{_t(a.limit_kg)} (over by {_t(a.load_kg - a.limit_kg)})."),
                suggestion=" ".join(tips), item_ids=item_ids))
        elif a.status == "near":
            out.append(PlanWarning(
                code="AXLE_NEAR_LIMIT", severity="warning",
                message=(f"The {a.name.lower()} is at {a.ratio * 100:.0f} % of its {mass_scheme} limit "
                         f"({_t(a.load_kg)} of {_t(a.limit_kg)})."),
                suggestion=(f"It fits, but this is an estimate: leave margin by moving some weight "
                            f"{_axle_direction(vehicle, a.group_id)}."),
                item_ids=item_ids))

    return CheckResult(out)
