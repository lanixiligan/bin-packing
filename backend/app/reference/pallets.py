# Pallet types and pallet defaults.
#
# Units: mm and kg. These are TYPICAL INDUSTRY VALUES, not fixed specs: real pallets, tares and
# carrier stack-height rules vary. Every value can be overridden per request or per deployment
# (see `load_reference(overrides)` and `ReferenceOverrides`).

from app.reference.schemas import PalletDefaults, PalletType

PALLETS: dict[str, PalletType] = {
    p.id: p
    for p in [
        PalletType(id="AU_STD", name="Australian Standard", length_mm=1165, width_mm=1165,
                   notes="CHEP / Loscam hire pallet. The unit for 'pallet spaces' on Australian trucks."),
        PalletType(id="EURO", name="Euro (EUR / EPAL)", length_mm=1200, width_mm=800),
        PalletType(id="ISO_UK", name="ISO / UK", length_mm=1200, width_mm=1000),
        PalletType(id="NA", name="North American (GMA)", length_mm=1219, width_mm=1016,
                   notes='48" x 40".'),
        PalletType(id="ASIA", name="Asia", length_mm=1100, width_mm=1100),
        PalletType(id="SQUARE", name="Square 42\"", length_mm=1067, width_mm=1067,
                   notes='42" x 42", common for drums and paint.'),
    ]
}

# Tare 35 kg is a typical timber AU pallet; carriers' stack-height limits are often 1.2-1.8 m.
PALLET_DEFAULTS = PalletDefaults(default_pallet="AU_STD", tare_kg=35, max_stack_height_mm=1800)
