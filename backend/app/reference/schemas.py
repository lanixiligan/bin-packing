"""
Reference data models: pallets, containers, truck bodies and vehicle configurations.

Units are millimetres, kilograms and cubic metres everywhere. Convert only for display.

Every capacity, weight and limit held in these models is a TYPICAL INDUSTRY VALUE, not a fixed
spec. Each one can be overridden per request (see `ReferenceOverrides`) or per deployment.
Results are for planning only and are not legal compliance with the NTC Load Restraint Guide
or with mass limits.

Vehicle coordinates
-------------------
`x` is measured in mm from the front of the vehicle (front of the cab) towards the rear.
A deck is a cargo area. Its `x_mm` is the vehicle x of its front edge, and positions on a deck
(`Placement.x_mm`) are measured from that edge. `y` runs across the deck from the driver's
(left) side.

Axle model
----------
Each deck (and the prime mover's chassis, a deck with `cargo=False`) is a simple beam resting
on two supports. A support is either an axle group, or a coupling (kingpin on a fifth wheel)
resting on another deck/chassis at a vehicle x. Loads go down the chain: a trailer's kingpin
reaction is a point load on the beam beneath it. Unladen axle loads come from
`AxleGroup.tare_kg`.
"""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

SizeClass = Literal["20", "40", "45", "48"]
MassScheme = Literal["GML", "HML"]
AxleKind = Literal["steer", "single", "tandem", "tri", "quad"]
Access = Literal["side", "rear", "top"]


class _Model(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


# ---------------------------------------------------------------------------
# Pallets
# ---------------------------------------------------------------------------

class PalletType(_Model):
    id: str
    name: str
    length_mm: int = Field(gt=0)
    width_mm: int = Field(gt=0)
    # Rated gross weight of one loaded pallet; None = use PalletDefaults.max_gross_kg.
    max_gross_kg: float | None = Field(default=None, gt=0)
    notes: str = ""


class PalletDefaults(_Model):
    """Typical defaults; carriers differ (max stack height is often 1.2-1.8 m, and many carriers
    cap a pallet at 1-1.5 t)."""
    default_pallet: str = "AU_STD"
    tare_kg: float = Field(default=35, ge=0)
    max_stack_height_mm: int = Field(default=1800, gt=0)
    max_gross_kg: float = Field(default=1500, gt=0)

    def max_gross_for(self, pallet: "PalletType") -> float:
        return pallet.max_gross_kg if pallet.max_gross_kg is not None else self.max_gross_kg


# ---------------------------------------------------------------------------
# Containers
# ---------------------------------------------------------------------------

class ContainerType(_Model):
    """ISO / domestic container. Dimensions are nullable for specialist types (open top, flat rack...)."""
    id: str
    name: str
    size_class: SizeClass
    ext_length_mm: int | None = None
    ext_width_mm: int | None = None
    ext_height_mm: int | None = None
    int_length_mm: int | None = None
    int_width_mm: int | None = None
    int_height_mm: int | None = None
    volume_m3: float | None = None
    tare_kg: float | None = None
    max_gross_kg: float | None = None
    au_pallets: int | None = None
    teu: float = Field(gt=0)
    temp_controlled: bool = False
    specialist: bool = False
    notes: str = ""


# ---------------------------------------------------------------------------
# Truck bodies
# ---------------------------------------------------------------------------

class BodyType(_Model):
    id: str
    name: str
    carries_pallets: bool
    carries_containers: bool
    # True when containers are possible but not the body's main use (e.g. FLAT_TOP with twist locks).
    container_optional: bool = False
    access: list[Access] = Field(default_factory=list)
    temp_controlled: bool = False
    # Usable height inside the body above the deck; None = open (no roof).
    internal_height_mm: int | None = None
    # False = reference only, the optimizer refuses it (tipper, tanker, car carrier, livestock).
    in_scope: bool = True
    notes: str = ""


# ---------------------------------------------------------------------------
# Vehicles
# ---------------------------------------------------------------------------

class AxleGroup(_Model):
    id: str
    name: str
    kind: AxleKind
    position_mm: int = Field(description="Vehicle x of the group's centre")
    gml_kg: float = Field(gt=0, description="General Mass Limit (typical)")
    hml_kg: float | None = Field(default=None, gt=0, description="Higher Mass Limit, None = same as GML")
    tare_kg: float = Field(default=0, ge=0, description="Unladen load on this group (typical)")

    def limit(self, scheme: MassScheme) -> float:
        return self.hml_kg if scheme == "HML" and self.hml_kg is not None else self.gml_kg


class Support(_Model):
    """Where a deck rests: directly on an axle group, or on a coupling resting on another deck."""
    position_mm: int = Field(description="Vehicle x of the support point")
    axle_group: str | None = None
    on_deck: str | None = None

    @model_validator(mode="after")
    def _exactly_one(self) -> "Support":
        if (self.axle_group is None) == (self.on_deck is None):
            raise ValueError("A support needs exactly one of axle_group or on_deck.")
        return self


class Deck(_Model):
    id: str
    name: str
    x_mm: int = Field(description="Vehicle x of the deck's front edge")
    length_mm: int = Field(ge=0)
    width_mm: int = Field(ge=0)
    deck_height_mm: int = Field(ge=0, description="Ground to deck floor")
    front_support: Support
    rear_support: Support
    pallet_spaces: int = Field(default=0, ge=0, description="AU standard pallet spaces on this deck")
    # False for a chassis that carries no freight (the prime mover).
    cargo: bool = True


class ContainerSlot(_Model):
    deck_id: str
    size_class: SizeClass
    x_mm: int = Field(ge=0, description="Front of the container from the front of the deck")


class ContainerCombo(_Model):
    """One allowed container arrangement, e.g. 2 x 20' on a semi. Freight fits a combo when each
    container can be given its own slot of the same size class (unused slots are fine)."""
    name: str
    slots: list[ContainerSlot]


class VehicleConfig(_Model):
    id: str
    name: str
    category: Literal["rigid", "articulated", "combination"]
    description: str = ""
    pallet_spaces: int = Field(ge=0, description="AU standard pallet spaces (sum of the decks)")
    decks: list[Deck]
    axle_groups: list[AxleGroup]
    tare_kg: float = Field(ge=0)
    max_payload_kg: float = Field(gt=0)
    gcm_kg: float | None = None
    allowed_bodies: list[str]
    default_body: str
    container_combos: list[ContainerCombo] = Field(default_factory=list)
    overall_height_limit_mm: int = 4300
    overall_length_mm: int | None = None
    # True when the user is expected to set spaces / combos (super B-double, road train).
    configurable: bool = False
    route_restricted: bool = False
    permit_note: str = ""

    def deck(self, deck_id: str) -> Deck:
        return next(d for d in self.decks if d.id == deck_id)

    def axle_group(self, group_id: str) -> AxleGroup:
        return next(g for g in self.axle_groups if g.id == group_id)

    @property
    def cargo_decks(self) -> list[Deck]:
        return [d for d in self.decks if d.cargo]

    @property
    def max_teu(self) -> float:
        teu = {"20": 1.0, "40": 2.0, "45": 2.25, "48": 2.4}
        return max((sum(teu[s.size_class] for s in c.slots) for c in self.container_combos), default=0.0)


# ---------------------------------------------------------------------------
# Aggregate and overrides
# ---------------------------------------------------------------------------

class ReferenceData(_Model):
    pallets: dict[str, PalletType]
    pallet_defaults: PalletDefaults
    containers: dict[str, ContainerType]
    bodies: dict[str, BodyType]
    vehicles: dict[str, VehicleConfig]


class ReferenceOverrides(BaseModel):
    """Partial overrides, deep-merged onto the defaults and re-validated.

    Example: {"vehicles": {"SEMI_TRAILER": {"max_payload_kg": 22000}},
              "pallet_defaults": {"max_stack_height_mm": 1500}}
    """
    model_config = ConfigDict(extra="forbid")
    pallet_defaults: dict | None = None
    pallets: dict[str, dict] | None = None
    containers: dict[str, dict] | None = None
    bodies: dict[str, dict] | None = None
    vehicles: dict[str, dict] | None = None
