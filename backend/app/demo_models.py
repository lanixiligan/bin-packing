"""
Request and response models for the bin packing demo, POST /api/solve.

Shipments have real sizes and the trucks are a vehicle from the planner's
reference data (app/reference), so the solver packs footprints on each deck
instead of counting pallet spaces.

Units: mm and kg everywhere. Deck coordinates: x along the deck from its front
edge (the cab end) towards the rear, y across it from the driver's (left) side,
z up from the deck floor.

A shipment is either:
  - "pallet": it sits on a pallet of `pallet_type` (an id from GET /api/reference,
    default the reference default, AU_STD). Its footprint is the pallet's
    length x width; `height_mm` is the total height, pallet included.
  - "loose": a long or odd item with its own `length_mm` x `width_mm` x `height_mm`.

Stacking: a `stackable` shipment may stand on another stackable shipment with the
same footprint (same pallet type, or the same loose length x width in either
order) when the column still fits under the truck's inside height. Columns can be
more than two high. Non-stackable shipments stand on the floor with nothing on top.

Every footprint may be turned 90 degrees on the deck. Footprints on one deck never
overlap, and each stays within the deck. Weight per truck stays within the
vehicle's payload, and incompatible dangerous goods never share a truck.
"""

from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

from app import dg as dgrules

DemoDg = Literal["1", "2.1", "2.2", "2.3", "3", "4.1", "4.2", "4.3", "5.1", "5.2", "6.1", "6.2",
                 "7", "8", "9", "food", "fire_risk"]
ShipmentKind = Literal["pallet", "loose"]

MAX_SHIPMENTS = 40          # keeps the 10 s solve realistic with 2D placement and stacking
MAX_DIMENSION_MM = 20_000   # longer than any deck; anything bigger is a typo
DEFAULT_VEHICLE = "RIGID_MEDIUM"


# ---- Request ----------------------------------------------------------------

class Shipment(BaseModel):
    name: str = Field(min_length=1, max_length=50)
    weight: int = Field(gt=0, le=100_000, description="Gross weight in kg (whole number), pallet included")
    kind: ShipmentKind = "pallet"
    pallet_type: str | None = Field(default=None, description="Pallet id (pallets only); null = the default")
    length_mm: int | None = Field(default=None, gt=0, le=MAX_DIMENSION_MM, description="Loose only")
    width_mm: int | None = Field(default=None, gt=0, le=MAX_DIMENSION_MM, description="Loose only")
    height_mm: int = Field(gt=0, le=MAX_DIMENSION_MM, description="Total height, pallet included")
    stackable: bool = False
    dg_class: DemoDg | None = Field(default=None, description="DG class, 'food', 'fire_risk', or null")
    subsidiary: list[dgrules.Subsidiary] = Field(
        default_factory=list, max_length=4,
        description="Subsidiary hazards (only with a DG class, never the class itself)")

    @field_validator("subsidiary")
    @classmethod
    def _sorted_unique(cls, v: list[str]) -> list[str]:
        return sorted(set(v))

    @model_validator(mode="after")
    def _consistent(self) -> "Shipment":
        if self.subsidiary:
            if self.dg_class in (None, "food", "fire_risk"):
                raise ValueError("Subsidiary hazards need a DG class.")
            if self.dg_class in self.subsidiary:
                raise ValueError(f"A subsidiary hazard can't be the same as the class ({self.dg_class}).")
        if self.kind == "loose":
            if self.length_mm is None or self.width_mm is None:
                raise ValueError("A loose shipment needs a length and a width.")
            if self.pallet_type is not None:
                raise ValueError("A loose shipment has no pallet type.")
        elif self.length_mm is not None or self.width_mm is not None:
            raise ValueError("A pallet shipment takes its length and width from the pallet type.")
        return self


class SolveRequest(BaseModel):
    vehicle_id: str = Field(default=DEFAULT_VEHICLE, description="A vehicle id from GET /api/reference")
    body_type: str | None = Field(default=None, description="A body id, or null for the vehicle's default")
    shipments: list[Shipment] = Field(max_length=MAX_SHIPMENTS)
    rule_set: dgrules.RuleSet = "adg"


# ---- Response ---------------------------------------------------------------

class DeckOut(BaseModel):
    """One cargo deck of the vehicle (a B-double has two)."""
    id: str
    name: str
    length_mm: int
    width_mm: int
    height_mm: int = Field(description="Inside height available for the load")


class TruckCapacity(BaseModel):
    """What one truck of the chosen vehicle holds."""
    weight_kg: int
    decks: list[DeckOut]
    floor_m2: float = Field(description="Total cargo floor area")
    volume_m3: float = Field(description="Total cargo volume (floor x inside height)")


class Placement(BaseModel):
    deck_id: str
    x_mm: int = Field(description="From the deck front to the item's front edge")
    y_mm: int = Field(description="From the driver's side to the item's left edge")
    z_mm: int = Field(description="Bottom of the item above the deck floor")
    length_mm: int = Field(description="Extent along the deck (x), after any rotation")
    width_mm: int = Field(description="Extent across the deck (y), after any rotation")
    height_mm: int
    rotated: bool = Field(description="True when turned 90 degrees from its given length x width")
    stack_base: int = Field(description="Id of the floor item of its column (its own id on the floor)")
    level: int = Field(description="0 on the floor, 1 on top of one item, ...")


class ShipmentOut(BaseModel):
    id: int = Field(description="The shipment's position in the request")
    name: str
    weight: int
    kind: ShipmentKind
    pallet_type: str | None
    length_mm: int = Field(description="Footprint length as given (the pallet's for pallets)")
    width_mm: int
    height_mm: int
    stackable: bool
    dg_class: DemoDg | None
    subsidiary: list[str]
    placement: Placement


class TruckOut(BaseModel):
    truck: int = Field(description="1-based")
    shipments: list[ShipmentOut] = Field(description="Floor items first, then upper levels")
    load: int = Field(description="kg")
    empty: int = Field(description="kg of payload left")
    fill_percent: float = Field(description="Weight used, % of payload")
    floor_used_m2: float = Field(description="Floor taken by footprints (stacked items count once)")
    floor_percent: float
    max_height_mm: int = Field(description="Tallest column above the deck floor")


class SolveResponse(BaseModel):
    vehicle_id: str
    vehicle_name: str
    body_type: str
    capacity: TruckCapacity
    total_weight: int
    total_volume_m3: float
    lower_bound: int = Field(description="Max of lower_bounds: no packing can use fewer trucks")
    lower_bounds: dict[str, int] = Field(
        description="weight: ceil(total kg / payload); volume: ceil(total m3 / truck m3); "
                    "floor: ceil(floor area of non-stackable items / truck floor area)")
    segregated: bool = Field(description="Some dangerous goods must travel apart (the bounds ignore it)")
    num_trucks: int
    trucks: list[TruckOut]
    solve_time_ms: float
    optimal: bool = Field(description="Proven optimal, or equal to the lower bound")
    status: str = Field(description="CP-SAT status: OPTIMAL, FEASIBLE, or UNKNOWN (starting packing)")
    time_limit_s: float
    drop_order: list[int] = Field(
        description="Shipment ids, truck by truck, floor items before what sits on them")
