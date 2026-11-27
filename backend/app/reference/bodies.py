# Truck body types.
#
# Units: mm. These are TYPICAL INDUSTRY VALUES, not fixed specs: internal heights in particular
# depend on the builder and the deck height. Every value can be overridden per request or per
# deployment (see `load_reference(overrides)`).
#
# `in_scope=False` bodies are listed for reference only; the demo refuses them.

from app.reference.schemas import BodyType

BODIES: dict[str, BodyType] = {
    b.id: b
    for b in [
        # --- Pallet bodies ------------------------------------------------------------------
        BodyType(id="TAUTLINER", name="Tautliner (curtainsider)", carries_pallets=True,
                 carries_containers=False, access=["side", "rear"], internal_height_mm=2700,
                 notes="Curtain sides open for forklift loading from either side."),
        BodyType(id="PANTECH", name="Pantech (van)", carries_pallets=True, carries_containers=False,
                 access=["rear"], internal_height_mm=2600,
                 notes="Rigid walls and roof. Loaded from the rear only, so load in reverse stop order."),
        BodyType(id="REFRIGERATED_PANTECH", name="Refrigerated pantech (reefer)", carries_pallets=True,
                 carries_containers=False, access=["rear"], temp_controlled=True,
                 internal_height_mm=2500,
                 notes="Insulated pantech with a fridge unit. Lower internal height than a dry pantech."),
        BodyType(id="FLAT_TOP", name="Flat top (flat bed)", carries_pallets=True, carries_containers=True,
                 container_optional=True, access=["side", "rear"],
                 notes="Open deck. Takes containers only when fitted with twist locks."),
        BodyType(id="DROP_DECK", name="Drop deck", carries_pallets=True, carries_containers=False,
                 access=["side", "rear"],
                 notes="Stepped deck: lower rear section for taller freight. Open unless fitted with "
                       "curtains."),
        # --- Container bodies ---------------------------------------------------------------
        BodyType(id="SKELETAL", name="Skeletal", carries_pallets=False, carries_containers=True,
                 access=["top"],
                 notes="Chassis frame with twist locks. Containers are lifted on and off by crane or "
                       "forklift."),
        BodyType(id="SIDE_LOADER", name="Side loader (side lifter)", carries_pallets=False,
                 carries_containers=True, access=["side"],
                 notes="Lifts containers on and off itself, no crane needed."),
        # --- Reference only in this tool ----------------------------------------------------
        BodyType(id="LOW_LOADER", name="Low loader (float)", carries_pallets=False,
                 carries_containers=False, access=["rear"],
                 notes="Heavy machinery and over-dimension loads. In scope, but this tool plans neither "
                       "pallets nor containers on it (reference only)."),
        BodyType(id="TIPPER", name="Tipper", carries_pallets=False, carries_containers=False,
                 in_scope=False, notes="Bulk loose material. Not planned by this tool."),
        BodyType(id="TANKER", name="Tanker", carries_pallets=False, carries_containers=False,
                 in_scope=False, notes="Bulk liquids or powders. Not planned by this tool."),
        BodyType(id="CAR_CARRIER", name="Car carrier", carries_pallets=False, carries_containers=False,
                 in_scope=False, notes="Vehicles on ramps. Not planned by this tool."),
        BodyType(id="LIVESTOCK_CRATE", name="Livestock crate", carries_pallets=False,
                 carries_containers=False, in_scope=False,
                 notes="Livestock. Not planned by this tool."),
    ]
}
