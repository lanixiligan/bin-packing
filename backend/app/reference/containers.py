# ruff: noqa: E501  (data tables read better on one line)
# ISO and Australian domestic container types.
#
# Units: mm, kg and m³. These are TYPICAL INDUSTRY VALUES, not fixed specs: internal dimensions,
# tares and max gross masses differ by manufacturer and owner (check the CSC plate). Every value
# can be overridden per request or per deployment (see `load_reference(overrides)`).
#
# Specialist types (open top, flat rack, tank, platform, domestic) are flagged `specialist=True`
# and leave dimensions empty where there is no common standard.

from app.reference.schemas import ContainerType

_W = 2438          # ISO external width
_H = 2591          # ISO standard external height (8'6")
_HC = 2896         # ISO high cube external height (9'6")
_L20, _L40, _L45 = 6058, 12192, 13716

CONTAINERS: dict[str, ContainerType] = {
    c.id: c
    for c in [
        # --- General purpose / high cube ------------------------------------------------------
        ContainerType(id="GP20", name="20' General purpose", size_class="20",
                      ext_length_mm=_L20, ext_width_mm=_W, ext_height_mm=_H,
                      int_length_mm=5898, int_width_mm=2352, int_height_mm=2393,
                      volume_m3=33, tare_kg=2250, max_gross_kg=30480, au_pallets=10, teu=1),
        ContainerType(id="GP40", name="40' General purpose", size_class="40",
                      ext_length_mm=_L40, ext_width_mm=_W, ext_height_mm=_H,
                      int_length_mm=12032, int_width_mm=2352, int_height_mm=2393,
                      volume_m3=67, tare_kg=3750, max_gross_kg=30480, au_pallets=20, teu=2),
        ContainerType(id="HC40", name="40' High cube", size_class="40",
                      ext_length_mm=_L40, ext_width_mm=_W, ext_height_mm=_HC,
                      int_length_mm=12032, int_width_mm=2352, int_height_mm=2698,
                      volume_m3=76, tare_kg=3950, max_gross_kg=30480, au_pallets=20, teu=2),
        ContainerType(id="HC45", name="45' High cube", size_class="45",
                      ext_length_mm=_L45, ext_width_mm=_W, ext_height_mm=_HC,
                      int_length_mm=13556, int_width_mm=2352, int_height_mm=2698,
                      volume_m3=86, tare_kg=4800, max_gross_kg=32500, au_pallets=22, teu=2.25),
        # --- Refrigerated ---------------------------------------------------------------------
        ContainerType(id="RF20", name="20' Reefer", size_class="20",
                      ext_length_mm=_L20, ext_width_mm=_W, ext_height_mm=_H,
                      int_length_mm=5440, int_width_mm=2290, int_height_mm=2270,
                      volume_m3=28, tare_kg=3000, max_gross_kg=30480, au_pallets=8, teu=1,
                      temp_controlled=True),
        ContainerType(id="RH40", name="40' High cube reefer", size_class="40",
                      ext_length_mm=_L40, ext_width_mm=_W, ext_height_mm=_HC,
                      int_length_mm=11580, int_width_mm=2290, int_height_mm=2500,
                      volume_m3=67, tare_kg=4500, max_gross_kg=34000, au_pallets=18, teu=2,
                      temp_controlled=True),
        # --- Specialist -----------------------------------------------------------------------
        ContainerType(id="OT20", name="20' Open top", size_class="20", specialist=True,
                      ext_length_mm=_L20, ext_width_mm=_W, ext_height_mm=_H,
                      tare_kg=2350, max_gross_kg=30480, teu=1,
                      notes="Removable tarpaulin roof for top loading of tall or crane-lifted cargo."),
        ContainerType(id="OT40", name="40' Open top", size_class="40", specialist=True,
                      ext_length_mm=_L40, ext_width_mm=_W, ext_height_mm=_H,
                      tare_kg=3850, max_gross_kg=30480, teu=2,
                      notes="Removable tarpaulin roof for top loading of tall or crane-lifted cargo."),
        ContainerType(id="FR20", name="20' Flat rack", size_class="20", specialist=True,
                      ext_length_mm=_L20, ext_width_mm=_W, ext_height_mm=_H,
                      tare_kg=2750, max_gross_kg=34000, teu=1,
                      notes="End walls only (often collapsible). For out-of-gauge cargo."),
        ContainerType(id="FR40", name="40' Flat rack", size_class="40", specialist=True,
                      ext_length_mm=_L40, ext_width_mm=_W, ext_height_mm=_H,
                      tare_kg=5000, max_gross_kg=45000, teu=2,
                      notes="End walls only (often collapsible). For out-of-gauge cargo."),
        ContainerType(id="TK20", name="20' ISO tank", size_class="20", specialist=True,
                      ext_length_mm=_L20, ext_width_mm=_W, ext_height_mm=_H,
                      tare_kg=3700, max_gross_kg=36000, teu=1,
                      notes="Bulk liquids in a frame. Capacity typically 21,000-26,000 L."),
        ContainerType(id="PL20", name="20' Platform", size_class="20", specialist=True,
                      ext_length_mm=_L20, ext_width_mm=_W,
                      tare_kg=2500, max_gross_kg=34000, teu=1,
                      notes="Flat bed with no walls. Height depends on the platform."),
        ContainerType(id="PL40", name="40' Platform", size_class="40", specialist=True,
                      ext_length_mm=_L40, ext_width_mm=_W,
                      tare_kg=5500, max_gross_kg=45000, teu=2,
                      notes="Flat bed with no walls. Height depends on the platform."),
        ContainerType(id="DOM40", name="40' Australian domestic", size_class="40", specialist=True,
                      ext_length_mm=_L40, teu=2,
                      notes="Domestic rail/road box, often wider (about 2.5 m) to take 2 AU pallets "
                            "across. Dimensions vary by operator."),
        ContainerType(id="DOM48", name="48' Australian domestic", size_class="48", specialist=True,
                      ext_length_mm=14630, teu=2.4,
                      notes="Domestic rail/road box, often wider (about 2.5 m) to take 2 AU pallets "
                            "across. Dimensions vary by operator."),
    ]
}
