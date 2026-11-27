# ruff: noqa: E501  (data tables read better on one line)
"""
Small, self-contained reference data for planner unit tests, so they don't depend on the real
defaults in app/reference (those have their own tests). Geometry is realistic enough for the axle
estimate to be meaningful:

SEMI: prime mover (steer @1500, drive tandem @5000, fifth wheel @4700); trailer deck 13,600 x 2,480
      from x=3,700, kingpin @4,700, tri-axle @15,100. 22 AU pallets = 11 rows x 2 across, flush.
      22 x 1,000 kg uniformly loaded never goes over GML (the drive tandem is near its limit).
BDOUBLE: lead deck 7,400 (12 AU) on the prime mover + lead tri; rear deck 13,600 (22 AU) on the lead
      trailer's fifth wheel + rear tri. Containers: 1 x 20' (lead) + 1 x 40' (rear) only.
RIGID: 8 AU pallets, 4 rows on a 4,800 deck, steer + single rear.
"""

from app.planner.models import FreightItem, PlanRequest
from app.reference.schemas import (
    AxleGroup,
    BodyType,
    ContainerCombo,
    ContainerSlot,
    ContainerType,
    Deck,
    PalletDefaults,
    PalletType,
    ReferenceData,
    Support,
    VehicleConfig,
)

PALLETS = {
    "AU_STD": PalletType(id="AU_STD", name="Australian Standard", length_mm=1165, width_mm=1165),
    "EURO": PalletType(id="EURO", name="Euro", length_mm=1200, width_mm=800),
    "ISO_UK": PalletType(id="ISO_UK", name="ISO / UK", length_mm=1200, width_mm=1000),
}

CONTAINERS = {
    "GP20": ContainerType(id="GP20", name="20' GP", size_class="20", ext_length_mm=6058, ext_width_mm=2438,
                          ext_height_mm=2591, int_length_mm=5898, int_width_mm=2352, int_height_mm=2393,
                          volume_m3=33, tare_kg=2250, max_gross_kg=30480, au_pallets=10, teu=1),
    "GP40": ContainerType(id="GP40", name="40' GP", size_class="40", ext_length_mm=12192, ext_width_mm=2438,
                          ext_height_mm=2591, int_length_mm=12032, int_width_mm=2352, int_height_mm=2393,
                          volume_m3=67, tare_kg=3750, max_gross_kg=30480, au_pallets=20, teu=2),
    "HC40": ContainerType(id="HC40", name="40' HC", size_class="40", ext_length_mm=12192, ext_width_mm=2438,
                          ext_height_mm=2896, int_length_mm=12032, int_width_mm=2352, int_height_mm=2698,
                          volume_m3=76, tare_kg=3950, max_gross_kg=30480, au_pallets=20, teu=2),
    "RF20": ContainerType(id="RF20", name="20' Reefer", size_class="20", ext_length_mm=6058, ext_width_mm=2438,
                          ext_height_mm=2591, int_length_mm=5440, int_width_mm=2290, int_height_mm=2270,
                          volume_m3=28, tare_kg=3000, max_gross_kg=30480, au_pallets=8, teu=1,
                          temp_controlled=True),
}

BODIES = {
    "TAUTLINER": BodyType(id="TAUTLINER", name="Tautliner", carries_pallets=True, carries_containers=False,
                          access=["side", "rear"], internal_height_mm=2700),
    "PANTECH": BodyType(id="PANTECH", name="Pantech", carries_pallets=True, carries_containers=False,
                        access=["rear"], internal_height_mm=2600),
    "REFRIGERATED_PANTECH": BodyType(id="REFRIGERATED_PANTECH", name="Refrigerated pantech",
                                     carries_pallets=True, carries_containers=False, access=["rear"],
                                     temp_controlled=True, internal_height_mm=2500),
    "FLAT_TOP": BodyType(id="FLAT_TOP", name="Flat top", carries_pallets=True, carries_containers=True,
                         container_optional=True, access=["side", "rear"]),
    "SKELETAL": BodyType(id="SKELETAL", name="Skeletal", carries_pallets=False, carries_containers=True),
    "TIPPER": BodyType(id="TIPPER", name="Tipper", carries_pallets=False, carries_containers=False,
                       in_scope=False),
}

_PALLET_BODIES = ["TAUTLINER", "PANTECH", "REFRIGERATED_PANTECH", "FLAT_TOP"]

PRIME_MOVER = Deck(id="prime_mover", name="Prime mover", x_mm=0, length_mm=0, width_mm=0, deck_height_mm=0,
                   cargo=False,
                   front_support=Support(position_mm=1500, axle_group="steer"),
                   rear_support=Support(position_mm=5000, axle_group="drive"))

SEMI = VehicleConfig(
    id="SEMI", name="Semi-trailer", category="articulated", pallet_spaces=22,
    decks=[PRIME_MOVER, Deck(id="trailer", name="Trailer", x_mm=3700, length_mm=13600, width_mm=2480,
                             deck_height_mm=1300, pallet_spaces=22,
                             front_support=Support(position_mm=4700, on_deck="prime_mover"),
                             rear_support=Support(position_mm=15100, axle_group="trailer_tri"))],
    axle_groups=[
        AxleGroup(id="steer", name="Steer", kind="steer", position_mm=1500, gml_kg=6000, hml_kg=6500, tare_kg=4800),
        AxleGroup(id="drive", name="Drive tandem", kind="tandem", position_mm=5000, gml_kg=16500, hml_kg=17000,
                  tare_kg=6000),
        AxleGroup(id="trailer_tri", name="Trailer tri-axle", kind="tri", position_mm=15100, gml_kg=20000,
                  hml_kg=22500, tare_kg=4800),
    ],
    tare_kg=15600, max_payload_kg=24000, gcm_kg=42500,
    allowed_bodies=[*_PALLET_BODIES, "SKELETAL"], default_body="TAUTLINER",
    container_combos=[
        ContainerCombo(name="1 x 40'", slots=[ContainerSlot(deck_id="trailer", size_class="40", x_mm=700)]),
        ContainerCombo(name="2 x 20'", slots=[ContainerSlot(deck_id="trailer", size_class="20", x_mm=700),
                                              ContainerSlot(deck_id="trailer", size_class="20", x_mm=6800)]),
    ],
)

BDOUBLE = VehicleConfig(
    id="BDOUBLE", name="B-double", category="combination", pallet_spaces=34,
    decks=[PRIME_MOVER,
           Deck(id="lead", name="Lead trailer", x_mm=3700, length_mm=7400, width_mm=2480, deck_height_mm=1300,
                pallet_spaces=12,
                front_support=Support(position_mm=4700, on_deck="prime_mover"),
                rear_support=Support(position_mm=10200, axle_group="lead_tri")),
           Deck(id="rear", name="Rear trailer", x_mm=11200, length_mm=13600, width_mm=2480, deck_height_mm=1300,
                pallet_spaces=22,
                front_support=Support(position_mm=11600, on_deck="lead"),
                rear_support=Support(position_mm=23000, axle_group="rear_tri"))],
    axle_groups=[
        AxleGroup(id="steer", name="Steer", kind="steer", position_mm=1500, gml_kg=6000, hml_kg=6500, tare_kg=4800),
        AxleGroup(id="drive", name="Drive tandem", kind="tandem", position_mm=5000, gml_kg=16500, hml_kg=17000,
                  tare_kg=6000),
        AxleGroup(id="lead_tri", name="Lead tri-axle", kind="tri", position_mm=10200, gml_kg=20000,
                  hml_kg=22500, tare_kg=4500),
        AxleGroup(id="rear_tri", name="Rear tri-axle", kind="tri", position_mm=23000, gml_kg=20000,
                  hml_kg=22500, tare_kg=4700),
    ],
    tare_kg=20000, max_payload_kg=42500, gcm_kg=62500,
    allowed_bodies=[*_PALLET_BODIES, "SKELETAL"], default_body="TAUTLINER",
    container_combos=[
        ContainerCombo(name="1 x 20' + 1 x 40'", slots=[ContainerSlot(deck_id="lead", size_class="20", x_mm=600),
                                                       ContainerSlot(deck_id="rear", size_class="40", x_mm=700)]),
    ],
)

RIGID = VehicleConfig(
    id="RIGID", name="Rigid 8 t", category="rigid", pallet_spaces=8,
    decks=[Deck(id="body", name="Body", x_mm=2300, length_mm=4800, width_mm=2400, deck_height_mm=1100,
                pallet_spaces=8,
                front_support=Support(position_mm=1300, axle_group="steer"),
                rear_support=Support(position_mm=5800, axle_group="rear"))],
    axle_groups=[
        AxleGroup(id="steer", name="Steer", kind="steer", position_mm=1300, gml_kg=6000, tare_kg=3200),
        AxleGroup(id="rear", name="Rear single", kind="single", position_mm=5800, gml_kg=9000, tare_kg=2300),
    ],
    tare_kg=5500, max_payload_kg=8000, allowed_bodies=_PALLET_BODIES, default_body="TAUTLINER",
)


def reference(**vehicles: VehicleConfig) -> ReferenceData:
    """Test reference data: SEMI, BDOUBLE and RIGID, plus any extra/replacement vehicles."""
    v = {"SEMI": SEMI, "BDOUBLE": BDOUBLE, "RIGID": RIGID, **vehicles}
    return ReferenceData(pallets=PALLETS, pallet_defaults=PalletDefaults(), containers=CONTAINERS,
                         bodies=BODIES, vehicles=v)


def pallets(qty: int, weight: float = 500, *, id: str = "P", type_id: str = "AU_STD", height: int = 1200,
            stackable: bool = False, temp: bool = False) -> FreightItem:
    return FreightItem(id=id, kind="pallet", type_id=type_id, quantity=qty, gross_weight_kg=weight,
                       height_mm=height, stackable=stackable, temp_controlled=temp)


def loose(qty: int, length: int, width: int, weight: float = 300, *, id: str = "L", height: int = 400,
          stackable: bool = False) -> FreightItem:
    return FreightItem(id=id, kind="loose", quantity=qty, length_mm=length, width_mm=width,
                       gross_weight_kg=weight, height_mm=height, stackable=stackable)


def containers(type_id: str, qty: int = 1, weight: float = 15000, *, id: str | None = None) -> FreightItem:
    return FreightItem(id=id or type_id, kind="container", type_id=type_id, quantity=qty, gross_weight_kg=weight)


def request(*items: FreightItem, vehicle: str = "SEMI", body: str | None = None, **kw) -> PlanRequest:
    return PlanRequest(items=list(items), vehicle_id=vehicle, body_type=body, **kw)
