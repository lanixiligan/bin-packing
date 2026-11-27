# ruff: noqa: E501  (data tables read better on one line)
# Vehicle configurations: rigids, semi-trailer, B-double, super B-double and road train.
#
# Units: mm and kg. These are TYPICAL INDUSTRY VALUES, not fixed specs: real tares, axle spacings,
# deck lengths and payloads depend on the make, model and body builder. Mass limits are the
# usual Australian General Mass Limits (GML) with Higher Mass Limits (HML) where they apply.
# Every value can be overridden per request or per deployment (see `load_reference(overrides)`).
# Results are for planning only: not compliance with the NTC Load Restraint Guide, the HVNL mass
# limits or any permit.
#
# Geometry follows app/reference/schemas.py: x in mm from the front of the cab. Each deck is a
# beam on two supports (an axle group, or a coupling resting on another deck). The prime mover of
# an articulated vehicle is a `cargo=False` chassis deck resting on the steer and drive groups.

from app.reference.schemas import AxleGroup, ContainerCombo, ContainerSlot, Deck, Support, VehicleConfig

# Typical Australian GML / HML per axle group (kg).
STEER_GML, STEER_HML = 6000, 6500
SINGLE_GML = 9000                       # single axle, dual tyres
TANDEM_GML, TANDEM_HML = 16500, 17000
TRI_GML, TRI_HML = 20000, 22500

PALLET_BODIES = ["TAUTLINER", "PANTECH", "REFRIGERATED_PANTECH", "FLAT_TOP"]
CONTAINER_BODIES = ["SKELETAL", "SIDE_LOADER"]

_RIGID_NOTE = "General access at GML: no permit needed on most roads. Check local load limits and bridges."


def _steer(pos: int, tare: float, hml: bool = True) -> AxleGroup:
    return AxleGroup(id="steer", name="Steer", kind="steer", position_mm=pos, gml_kg=STEER_GML,
                     hml_kg=STEER_HML if hml else None, tare_kg=tare)


def _tandem(id: str, name: str, pos: int, tare: float) -> AxleGroup:
    return AxleGroup(id=id, name=name, kind="tandem", position_mm=pos, gml_kg=TANDEM_GML,
                     hml_kg=TANDEM_HML, tare_kg=tare)


def _tri(id: str, name: str, pos: int, tare: float) -> AxleGroup:
    return AxleGroup(id=id, name=name, kind="tri", position_mm=pos, gml_kg=TRI_GML, hml_kg=TRI_HML,
                     tare_kg=tare)


def _slot(deck: str, size: str, x: int) -> ContainerSlot:
    return ContainerSlot(deck_id=deck, size_class=size, x_mm=x)


# Prime mover chassis shared by the articulated vehicles: steer @1,500, drive tandem @5,000,
# fifth wheel @4,700 (the trailer kingpin).
_PM_STEER, _PM_DRIVE, _FIFTH_WHEEL = 1500, 5000, 4700


def _prime_mover() -> Deck:
    return Deck(id="prime_mover", name="Prime mover", x_mm=0, length_mm=0, width_mm=0, deck_height_mm=0,
                cargo=False,
                front_support=Support(position_mm=_PM_STEER, axle_group="steer"),
                rear_support=Support(position_mm=_PM_DRIVE, axle_group="drive"))


def _prime_mover_groups() -> list[AxleGroup]:
    return [_steer(_PM_STEER, 4800), _tandem("drive", "Drive tandem", _PM_DRIVE, 6000)]


# ---------------------------------------------------------------------------
# Rigids
# ---------------------------------------------------------------------------

RIGID_SMALL = VehicleConfig(
    id="RIGID_SMALL", name="Small rigid (4-6 t)", category="rigid",
    description="Light rigid truck, about 8.5 t GVM, 4-6 t payload, 6 AU pallet spaces. Metro deliveries.",
    pallet_spaces=6,
    decks=[Deck(id="body", name="Body", x_mm=2000, length_mm=4200, width_mm=2350, deck_height_mm=1000,
                pallet_spaces=6,
                front_support=Support(position_mm=1100, axle_group="steer"),
                rear_support=Support(position_mm=4300, axle_group="rear"))],
    axle_groups=[
        _steer(1100, 2000, hml=False),
        AxleGroup(id="rear", name="Rear single", kind="single", position_mm=4300, gml_kg=SINGLE_GML, tare_kg=1500),
    ],
    tare_kg=3500, max_payload_kg=5000, gcm_kg=8500,
    allowed_bodies=PALLET_BODIES, default_body="TAUTLINER",
    overall_length_mm=6500, permit_note=_RIGID_NOTE,
)

RIGID_MEDIUM = VehicleConfig(
    id="RIGID_MEDIUM", name="Medium rigid (8 t)", category="rigid",
    description="Medium rigid truck, about 13.5 t GVM, 8 t payload, 8 AU pallet spaces.",
    pallet_spaces=8,
    decks=[Deck(id="body", name="Body", x_mm=2300, length_mm=4800, width_mm=2400, deck_height_mm=1100,
                pallet_spaces=8,
                front_support=Support(position_mm=1300, axle_group="steer"),
                rear_support=Support(position_mm=5800, axle_group="rear"))],
    axle_groups=[
        _steer(1300, 3200, hml=False),
        AxleGroup(id="rear", name="Rear single", kind="single", position_mm=5800, gml_kg=SINGLE_GML, tare_kg=2300),
    ],
    tare_kg=5500, max_payload_kg=8000, gcm_kg=13500,
    allowed_bodies=PALLET_BODIES, default_body="TAUTLINER",
    overall_length_mm=7400, permit_note=_RIGID_NOTE,
)

RIGID_LARGE = VehicleConfig(
    id="RIGID_LARGE", name="Large rigid (12-14 t)", category="rigid",
    description="Heavy rigid with a tandem drive, about 22 t GVM, 13 t payload, 12 AU pallet spaces. "
                "Can carry one 20' container on a skeletal, side loader or flat top.",
    pallet_spaces=12,
    decks=[Deck(id="body", name="Body", x_mm=2300, length_mm=7200, width_mm=2450, deck_height_mm=1200,
                pallet_spaces=12,
                front_support=Support(position_mm=1400, axle_group="steer"),
                rear_support=Support(position_mm=6600, axle_group="rear"))],
    axle_groups=[
        _steer(1400, 4000, hml=False),
        _tandem("rear", "Rear tandem", 6600, 5000),
    ],
    tare_kg=9000, max_payload_kg=13000, gcm_kg=22000,
    allowed_bodies=[*PALLET_BODIES, *CONTAINER_BODIES], default_body="TAUTLINER",
    container_combos=[ContainerCombo(name="1 x 20'", slots=[_slot("body", "20", 500)])],
    overall_length_mm=9800, permit_note=_RIGID_NOTE,
)

# ---------------------------------------------------------------------------
# Articulated and combinations
# ---------------------------------------------------------------------------

# 13.7 m class trailer (deck 13,900): 11 rows x 2 AU, and long enough for a 45' container.
SEMI_TRAILER = VehicleConfig(
    id="SEMI_TRAILER", name="Semi-trailer (13.7 m class)", category="articulated",
    description="Prime mover and a tri-axle semi-trailer, 22 AU pallet spaces, about 24 t payload. "
                "Takes 1 x 40', 1 x 45' or 2 x 20' containers.",
    pallet_spaces=22,
    decks=[_prime_mover(),
           Deck(id="trailer", name="Trailer", x_mm=3700, length_mm=13900, width_mm=2480, deck_height_mm=1300,
                pallet_spaces=22,
                front_support=Support(position_mm=_FIFTH_WHEEL, on_deck="prime_mover"),
                rear_support=Support(position_mm=15100, axle_group="trailer_tri"))],
    axle_groups=[*_prime_mover_groups(), _tri("trailer_tri", "Trailer tri-axle", 15100, 4800)],
    tare_kg=15600, max_payload_kg=24000, gcm_kg=42500,
    allowed_bodies=[*PALLET_BODIES, "DROP_DECK", *CONTAINER_BODIES], default_body="TAUTLINER",
    container_combos=[
        ContainerCombo(name="1 x 40'", slots=[_slot("trailer", "40", 700)]),
        ContainerCombo(name="1 x 45'", slots=[_slot("trailer", "45", 100)]),
        ContainerCombo(name="2 x 20'", slots=[_slot("trailer", "20", 700), _slot("trailer", "20", 6800)]),
    ],
    overall_length_mm=17600,
    permit_note="General access at GML (19 m maximum length). Running at HML needs HML route access "
                "under an NHVR or state notice, usually with IAP / telematics enrolment.",
)

# Lead trailer: 7,400 deck (12 AU); its tri-axle sits under the rear fifth wheel, just behind the
# deck. Rear trailer: 13,600 deck (22 AU) on the lead trailer's fifth wheel and its own tri-axle.
B_DOUBLE = VehicleConfig(
    id="B_DOUBLE", name="B-double", category="combination",
    description="Prime mover with a lead trailer (12 AU) and rear trailer (22 AU), 34 AU pallet spaces, "
                "about 42.5 t payload. Containers: 1 x 20' on the lead and 1 x 40' on the rear only.",
    pallet_spaces=34,
    decks=[_prime_mover(),
           Deck(id="lead", name="Lead trailer", x_mm=3700, length_mm=7400, width_mm=2480, deck_height_mm=1300,
                pallet_spaces=12,
                front_support=Support(position_mm=_FIFTH_WHEEL, on_deck="prime_mover"),
                rear_support=Support(position_mm=11200, axle_group="lead_tri")),
           Deck(id="rear", name="Rear trailer", x_mm=11200, length_mm=13600, width_mm=2480, deck_height_mm=1300,
                pallet_spaces=22,
                front_support=Support(position_mm=11600, on_deck="lead"),
                rear_support=Support(position_mm=22600, axle_group="rear_tri"))],
    axle_groups=[*_prime_mover_groups(),
                 _tri("lead_tri", "Lead tri-axle", 11200, 4500),
                 _tri("rear_tri", "Rear tri-axle", 22600, 4700)],
    tare_kg=20000, max_payload_kg=42500, gcm_kg=62500,
    allowed_bodies=[*PALLET_BODIES, *CONTAINER_BODIES], default_body="TAUTLINER",
    container_combos=[
        ContainerCombo(name="1 x 20' + 1 x 40'", slots=[_slot("lead", "20", 600), _slot("rear", "40", 700)]),
    ],
    overall_length_mm=24800,
    permit_note="Restricted access vehicle: only on the B-double route network approved by the NHVR or "
                "the state road authority (gazetted notice or permit). HML needs HML route access too.",
)

# Two 12,500 decks (10 rows x 2 AU each), each long enough for a 40' container. As on the B-double,
# the lead tri-axle sits under the rear fifth wheel, just behind the lead deck.
SUPER_B_DOUBLE = VehicleConfig(
    id="SUPER_B_DOUBLE", name="Super B-double", category="combination",
    description="Longer B-double (about 29 m) with two 40'-capable trailers. Default 40 AU pallet "
                "spaces (20 + 20) and 2 x 40' containers. Configure spaces and limits for your unit.",
    pallet_spaces=40,
    decks=[_prime_mover(),
           Deck(id="lead", name="Lead trailer", x_mm=3700, length_mm=12500, width_mm=2480, deck_height_mm=1300,
                pallet_spaces=20,
                front_support=Support(position_mm=_FIFTH_WHEEL, on_deck="prime_mover"),
                rear_support=Support(position_mm=16600, axle_group="lead_tri")),
           Deck(id="rear", name="Rear trailer", x_mm=16300, length_mm=12500, width_mm=2480, deck_height_mm=1300,
                pallet_spaces=20,
                front_support=Support(position_mm=16700, on_deck="lead"),
                rear_support=Support(position_mm=25100, axle_group="rear_tri"))],
    axle_groups=[*_prime_mover_groups(),
                 _tri("lead_tri", "Lead tri-axle", 16600, 4900),
                 _tri("rear_tri", "Rear tri-axle", 25100, 4800)],
    tare_kg=20500, max_payload_kg=42000, gcm_kg=62500,
    allowed_bodies=[*PALLET_BODIES, *CONTAINER_BODIES], default_body="TAUTLINER",
    container_combos=[
        ContainerCombo(name="2 x 40'", slots=[_slot("lead", "40", 150), _slot("rear", "40", 150)]),
        ContainerCombo(name="4 x 20'", slots=[_slot("lead", "20", 150), _slot("lead", "20", 6250),
                                              _slot("rear", "20", 150), _slot("rear", "20", 6250)]),
    ],
    overall_length_mm=28800, configurable=True, route_restricted=True,
    permit_note="Restricted access vehicle: needs an NHVR permit (normally under Performance Based "
                "Standards) and route approval from the NHVR and state road authorities for every road "
                "on the trip. Mass limits depend on the permit.",
)

# A-double: lead semi-trailer, converter dolly (towed on a drawbar) and rear semi-trailer. The rear
# trailer's kingpin rests directly on the dolly's tandem group; the drawbar's vertical load is
# taken as zero.
ROAD_TRAIN = VehicleConfig(
    id="ROAD_TRAIN", name="Road train (A-double)", category="combination",
    description="Prime mover, two 13.6 m trailers joined by a converter dolly, 44 AU pallet spaces, "
                "about 55 t payload. Takes 2 x 40' or 4 x 20' containers. Configure for your unit.",
    pallet_spaces=44,
    decks=[_prime_mover(),
           Deck(id="lead", name="Lead trailer", x_mm=3700, length_mm=13600, width_mm=2480, deck_height_mm=1300,
                pallet_spaces=22,
                front_support=Support(position_mm=_FIFTH_WHEEL, on_deck="prime_mover"),
                rear_support=Support(position_mm=15100, axle_group="lead_tri")),
           Deck(id="rear", name="Rear trailer", x_mm=19000, length_mm=13600, width_mm=2480, deck_height_mm=1300,
                pallet_spaces=22,
                front_support=Support(position_mm=20000, axle_group="dolly"),
                rear_support=Support(position_mm=30400, axle_group="rear_tri"))],
    axle_groups=[*_prime_mover_groups(),
                 _tri("lead_tri", "Lead tri-axle", 15100, 4800),
                 _tandem("dolly", "Dolly tandem", 20000, 3000),
                 _tri("rear_tri", "Rear tri-axle", 30400, 4800)],
    tare_kg=23400, max_payload_kg=55000, gcm_kg=79000,
    allowed_bodies=[*PALLET_BODIES, *CONTAINER_BODIES], default_body="TAUTLINER",
    container_combos=[
        ContainerCombo(name="2 x 40'", slots=[_slot("lead", "40", 700), _slot("rear", "40", 700)]),
        ContainerCombo(name="4 x 20'", slots=[_slot("lead", "20", 700), _slot("lead", "20", 6900),
                                              _slot("rear", "20", 700), _slot("rear", "20", 6900)]),
    ],
    overall_length_mm=32600, configurable=True, route_restricted=True,
    permit_note="Restricted access vehicle: only on approved road train routes (NHVR or state notices "
                "and permits), mostly in regional and remote areas. Type 1 (double) road trains are "
                "up to 36.5 m. Some depots require decoupling before entering towns.",
)

VEHICLES: dict[str, VehicleConfig] = {
    v.id: v
    for v in [RIGID_SMALL, RIGID_MEDIUM, RIGID_LARGE, SEMI_TRAILER, B_DOUBLE, SUPER_B_DOUBLE, ROAD_TRAIN]
}
