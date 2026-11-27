"""
Load planner request and result models (mm, kg, m³).

The result holds everything the UI draws: it never recalculates placement itself.

Fit rule: `fits` is True exactly when no warning has severity "error". `reasons` repeats the
messages of the error warnings for convenience.
"""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.dg import DgInfo, RuleSet
from app.reference.schemas import MassScheme, ReferenceOverrides

SUGGEST = "suggest"
# Most units (item quantity summed) one request may hold: plenty for any single vehicle, and it keeps
# a public request quick even in "suggest" mode, which plans on every vehicle.
MAX_UNITS = 500

# Warning codes shared by every planner and by the UI (keep in sync with frontend types).
WarningCode = Literal[
    "UNKNOWN_TYPE",              # type_id not in the reference data
    "MIXED_FREIGHT",             # containers with pallets or loose items in one plan (not supported)
    "BODY_INCOMPATIBLE",         # e.g. pallets on a skeletal trailer, containers on a pantech
    "BODY_NOT_ALLOWED",          # body not allowed on this vehicle
    "OUT_OF_SCOPE_BODY",         # tipper, tanker, car carrier, livestock crate
    "REEFER_ON_NON_REEFER",      # temperature-controlled item on a body without refrigeration
    "STACK_TOO_HIGH",            # a single item is taller than the max stack height
    "OVER_INTERNAL_HEIGHT",      # taller than the body's internal height
    "OVER_HEIGHT_LIMIT",         # deck height + load height over the overall limit (4.3 m)
    "UNSTACKABLE_FLOOR_SPACE",   # unstackable items take extra floor space (info/warning)
    "OVER_CAPACITY",             # not every unit could be placed (out of floor space / slots)
    "CONTAINER_COMBO",           # container mix not allowed on this vehicle
    "CONTAINER_OVER_MAX_GROSS",  # container gross weight over its rated max gross
    "PALLET_OVER_MAX_GROSS",     # a pallet heavier than the pallet's rated gross weight
    "OVERSIZE_FOOTPRINT",        # a pallet wider than every deck, in either orientation
    "OVER_PAYLOAD",              # total weight over the vehicle's max payload
    "AXLE_NEAR_LIMIT",           # an axle group at >= 90 % of its limit
    "AXLE_OVER_LIMIT",           # an axle group over its limit
    "ROUTE_RESTRICTED",          # road train etc: needs route approval / permits
    "DG_INCOMPATIBLE",           # two lines' dangerous goods can't share a vehicle (ADG Table 9.1/9.2)
    "DG_CHECK",                  # a pair needs checking against Table 9.2 or the Explosives Code
    "DG_ON_BOARD",               # the load carries dangerous goods: placards, documents, licence
    "DG_CARRIER_REFUSED",        # the carrier's rules (rule_set) refuse or limit these goods
    "DG_CARRIER_NOTE",           # the carrier's approvals and handling notes
]
Severity = Literal["info", "warning", "error"]


class _In(BaseModel):
    model_config = ConfigDict(extra="forbid")


FreightKind = Literal["pallet", "container", "loose"]
LOOSE_TYPE = "LOOSE"  # type_id of a loose item: it has its own length x width x height


class FreightItem(_In):
    """One freight line. Pallets and loose items may share a plan; containers can't mix with either.

    - pallet: on a pallet of `type_id` (its footprint), `height_mm` = total height incl. the pallet.
    - loose: a long or odd item with its own `length_mm` x `width_mm` x `height_mm` (type_id "LOOSE").
    - container: a container of `type_id`; its external size is used.
    """
    id: str = Field(min_length=1, max_length=40)
    label: str = Field(default="", max_length=60)
    kind: FreightKind
    type_id: str = Field(default="", description="PalletType.id or ContainerType.id; 'LOOSE' (or empty) "
                                                 "for a loose item")
    length_mm: int | None = Field(default=None, gt=0, le=20_000, description="Loose items only")
    width_mm: int | None = Field(default=None, gt=0, le=20_000, description="Loose items only")
    quantity: int = Field(default=1, ge=1, le=200)
    gross_weight_kg: float = Field(gt=0, le=60_000, description="Per unit, including pallet tare")
    height_mm: int | None = Field(default=None, gt=0, le=5000,
                                  description="Pallets: total height incl. the pallet. Loose: its "
                                              "height (required). Containers: ignored (the type's "
                                              "external height is used)")
    stackable: bool = False
    temp_controlled: bool = False
    dg: DgInfo | None = Field(default=None, description="Dangerous goods data (ADG class, subsidiary "
                                                        "hazards, food / fire-risk); null = general freight")

    @model_validator(mode="after")
    def _kind_fields(self) -> "FreightItem":
        if self.kind == "loose":
            if self.type_id in ("", LOOSE_TYPE):
                self.type_id = LOOSE_TYPE
            else:
                raise ValueError(f"A loose item has no type (got '{self.type_id}'); give its size instead.")
            if self.length_mm is None or self.width_mm is None or self.height_mm is None:
                raise ValueError("A loose item needs a length, a width and a height.")
        else:
            if not self.type_id:
                raise ValueError(f"Pick a {self.kind} type.")
            if self.length_mm is not None or self.width_mm is not None:
                raise ValueError(f"A {self.kind} takes its length and width from its type.")
        return self


class PlanRequest(_In):
    items: list[FreightItem] = Field(min_length=1, max_length=100)
    vehicle_id: str = Field(default="SEMI_TRAILER", description="VehicleConfig.id, or 'suggest'")
    body_type: str | None = Field(default=None, description="BodyType.id; None = the vehicle's default")
    mass_scheme: MassScheme = "GML"
    rule_set: RuleSet = Field(default="northline",
                              description="Dangerous goods rules: 'northline' (default: ADG Code plus "
                                          "Northline's acceptance rules) or 'adg' (ADG Code only)")
    overrides: ReferenceOverrides | None = None

    @model_validator(mode="after")
    def _ids_unique_and_size_capped(self) -> "PlanRequest":
        seen: set[str] = set()
        dupes = sorted({i.id for i in self.items if i.id in seen or seen.add(i.id)})
        if dupes:
            raise ValueError(f"Each freight line needs its own id; repeated: {', '.join(dupes)}.")
        units = sum(i.quantity for i in self.items)
        if units > MAX_UNITS:
            raise ValueError(f"That's {units} units; one plan takes at most {MAX_UNITS}. "
                             "Split the freight into smaller plans.")
        return self


class PlanWarning(BaseModel):
    code: WarningCode
    severity: Severity
    message: str = Field(description="Plain language: what is wrong")
    suggestion: str = Field(default="", description="What to try next")
    item_ids: list[str] = Field(default_factory=list)


class Placement(BaseModel):
    unit_id: str = Field(description='"<item_id>#<n>", n from 1')
    item_id: str
    label: str
    kind: FreightKind
    type_id: str
    deck_id: str
    x_mm: int = Field(description="From the front of the deck to the unit's front edge")
    y_mm: int = Field(description="From the driver's (left) side of the deck")
    z_mm: int = Field(description="Bottom of the unit above the deck floor (0 = on the floor)")
    length_mm: int = Field(description="Along the deck, after rotation")
    width_mm: int = Field(description="Across the deck, after rotation")
    height_mm: int
    rotated: bool = False
    stack_id: int = Field(description="Units sharing a floor position share a stack_id")
    stack_level: int = Field(description="0 = on the floor")
    weight_kg: float
    stackable: bool = False
    temp_controlled: bool = False


class Usage(BaseModel):
    used: float
    available: float
    pct: float = Field(description="used / available * 100, 0 when nothing is available")


class Utilisation(BaseModel):
    pallet_spaces: Usage  # AU-equivalent floor positions (exact count for AU_STD)
    teu: Usage
    payload_kg: Usage
    volume_m3: Usage      # unit boxes vs deck length x width x usable height


class AxleLoad(BaseModel):
    group_id: str
    name: str
    load_kg: float = Field(description="Estimated, tare included")
    limit_kg: float
    ratio: float
    status: Literal["ok", "near", "over"]


class VehicleTried(BaseModel):
    vehicle_id: str
    fits: bool
    reason: str = ""


class PlanResult(BaseModel):
    fits: bool
    reasons: list[str]
    warnings: list[PlanWarning]
    vehicle_id: str
    vehicle_name: str
    body_type: str
    mass_scheme: MassScheme
    placements: list[Placement]
    unplaced: list[str] = Field(default_factory=list, description="unit_ids that did not fit")
    utilisation: Utilisation
    axle_loads: list[AxleLoad]
    total_weight_kg: float
    max_load_height_mm: int = Field(description="Tallest point above the ground (deck height + load)")
    planner: str
    # Set when the request asked for vehicle_id="suggest": every vehicle tried, smallest first.
    tried: list[VehicleTried] | None = None


FleetMethod = Literal["exact", "heuristic"]


class FleetResult(BaseModel):
    """POST /api/plan/fleet: the freight split across the fewest trucks of one vehicle type.

    Every truck is a full single-vehicle PlanResult (placements, axle loads, utilisation, warnings),
    so the UI shows each one exactly like a single-truck plan. Pallets and loose items only.
    """
    vehicle_id: str
    vehicle_name: str
    body_type: str
    mass_scheme: MassScheme
    fits: bool = Field(description="True when every unit is in a truck and every truck fits")
    reasons: list[str] = Field(default_factory=list,
                               description="Why not, in plain language (e.g. units no truck can take)")
    num_trucks: int
    trucks: list[PlanResult] = Field(description="Truck 1 first; each one's vehicle_id is the fleet's")
    unplaced: list[str] = Field(default_factory=list,
                                description="unit_ids no truck of this type can ever take (see reasons)")
    lower_bound: int = Field(description="No split can use fewer trucks: max of lower_bounds")
    lower_bounds: dict[str, int] = Field(
        description="weight: ceil(kg / payload); floor: ceil(non-stackable floor area / deck area); "
                    "volume: ceil(m3 / load volume)")
    optimal: bool = Field(description="Proven fewest trucks (or equal to the lower bound)")
    method: FleetMethod = Field(description="'exact': CP-SAT (small loads); 'heuristic': the planner's "
                                            "placement truck by truck (big loads, never proven)")
    status: str = Field(description="CP-SAT status (OPTIMAL, FEASIBLE, UNKNOWN) or HEURISTIC")
    solve_time_ms: float
    planner: str
