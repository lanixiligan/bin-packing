"""Integrity of the default reference data, overrides, and GET /api/reference."""

import pytest
from pydantic import ValidationError

from app.reference import ReferenceOverrides, apply_overrides, load_reference
from app.reference.schemas import VehicleConfig

AU = 1165
NOMINAL_LENGTH = {"20": 6058, "40": 12192, "45": 13716, "48": 14630}

REF = load_reference()
VEHICLE_IDS = list(REF.vehicles)


# ---------------------------------------------------------------------------
# Ids and dimensions
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("section", ["pallets", "containers", "bodies", "vehicles"])
def test_ids_match_keys_and_are_unique(section):
    entries = getattr(REF, section)
    assert entries
    ids = [e.id for e in entries.values()]
    assert ids == list(entries)
    assert len(set(ids)) == len(ids)


def test_expected_entries_exist():
    assert set(REF.pallets) == {"AU_STD", "EURO", "ISO_UK", "NA", "ASIA", "SQUARE"}
    assert {"GP20", "GP40", "HC40", "HC45", "RF20", "RH40", "OT20", "OT40", "FR20", "FR40", "TK20",
            "PL20", "PL40", "DOM40", "DOM48"} == set(REF.containers)
    assert {"TAUTLINER", "PANTECH", "REFRIGERATED_PANTECH", "FLAT_TOP", "DROP_DECK", "SKELETAL",
            "SIDE_LOADER", "TIPPER", "TANKER", "LOW_LOADER", "CAR_CARRIER",
            "LIVESTOCK_CRATE"} == set(REF.bodies)
    assert {"RIGID_SMALL", "RIGID_MEDIUM", "RIGID_LARGE", "SEMI_TRAILER", "B_DOUBLE", "SUPER_B_DOUBLE",
            "ROAD_TRAIN"} == set(REF.vehicles)
    assert REF.pallet_defaults.default_pallet in REF.pallets


def test_all_dimensions_positive():
    for p in REF.pallets.values():
        assert p.length_mm > 0 and p.width_mm > 0
    for c in REF.containers.values():
        dims = [c.ext_length_mm, c.ext_width_mm, c.ext_height_mm, c.int_length_mm, c.int_width_mm,
                c.int_height_mm, c.volume_m3, c.tare_kg, c.max_gross_kg, c.au_pallets]
        assert all(d > 0 for d in dims if d is not None), c.id
        if not c.specialist:
            assert None not in dims, f"{c.id}: standard containers need every dimension"
        if c.int_length_mm is not None:
            assert c.int_length_mm < c.ext_length_mm and c.int_width_mm < c.ext_width_mm
    for b in REF.bodies.values():
        assert b.internal_height_mm is None or b.internal_height_mm > 0
    for v in REF.vehicles.values():
        assert v.tare_kg > 0 and v.max_payload_kg > 0 and v.overall_length_mm > 0
        assert v.tare_kg == pytest.approx(sum(g.tare_kg for g in v.axle_groups)), v.id
        for d in v.cargo_decks:
            assert d.length_mm > 0 and d.width_mm > 0 and d.deck_height_mm > 0, (v.id, d.id)
        for g in v.axle_groups:
            assert g.gml_kg > 0 and (g.hml_kg is None or g.hml_kg >= g.gml_kg), (v.id, g.id)


# ---------------------------------------------------------------------------
# Decks, supports and pallet spaces
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("vid", VEHICLE_IDS)
def test_deck_pallet_spaces_sum_and_fit(vid):
    v = REF.vehicles[vid]
    assert sum(d.pallet_spaces for d in v.decks) == v.pallet_spaces
    for d in v.decks:
        if not d.cargo:
            assert d.pallet_spaces == 0
            continue
        assert d.width_mm >= 2 * AU, (vid, d.id)
        assert (d.length_mm // AU) * 2 >= d.pallet_spaces, (vid, d.id)


@pytest.mark.parametrize("vid", VEHICLE_IDS)
def test_supports_reference_existing_groups_and_decks_without_cycles(vid):
    v = REF.vehicles[vid]
    decks = {d.id: d for d in v.decks}
    groups = {g.id for g in v.axle_groups}
    assert len(decks) == len(v.decks) and len(groups) == len(v.axle_groups)
    used = set()
    for d in v.decks:
        assert d.front_support.position_mm < d.rear_support.position_mm, (vid, d.id)
        for s in (d.front_support, d.rear_support):
            if s.axle_group is not None:
                assert s.axle_group in groups
                assert s.position_mm == v.axle_group(s.axle_group).position_mm
                used.add(s.axle_group)
            else:
                assert s.on_deck in decks and s.on_deck != d.id
    assert used == groups, f"{vid}: every axle group carries a deck"

    def walk(deck_id, path):
        assert deck_id not in path, f"{vid}: support loop {path}"
        for s in (decks[deck_id].front_support, decks[deck_id].rear_support):
            if s.on_deck is not None:
                walk(s.on_deck, (*path, deck_id))

    for d in v.decks:
        walk(d.id, ())


def test_articulated_vehicles_have_a_prime_mover_chassis():
    for v in REF.vehicles.values():
        chassis = [d for d in v.decks if not d.cargo]
        if v.category == "rigid":
            assert not chassis
        else:
            assert [d.id for d in chassis] == ["prime_mover"], v.id


# ---------------------------------------------------------------------------
# Container combos
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("vid", VEHICLE_IDS)
def test_combo_slots_fit_on_their_decks_without_overlap(vid):
    v = REF.vehicles[vid]
    decks = {d.id: d for d in v.cargo_decks}
    for combo in v.container_combos:
        by_deck: dict[str, list[tuple[int, int]]] = {}
        for slot in combo.slots:
            assert slot.deck_id in decks, (vid, combo.name)
            end = slot.x_mm + NOMINAL_LENGTH[slot.size_class]
            assert end <= decks[slot.deck_id].length_mm, (vid, combo.name, slot)
            by_deck.setdefault(slot.deck_id, []).append((slot.x_mm, end))
        for spans in by_deck.values():
            spans.sort()
            for (_, end), (start, _) in zip(spans, spans[1:], strict=False):
                assert end <= start, (vid, combo.name, spans)


def test_expected_container_combos():
    def sizes(v: VehicleConfig) -> set[tuple[str, ...]]:
        return {tuple(sorted(s.size_class for s in c.slots)) for c in v.container_combos}

    assert sizes(REF.vehicles["SEMI_TRAILER"]) == {("40",), ("45",), ("20", "20")}
    assert sizes(REF.vehicles["RIGID_LARGE"]) == {("20",)}
    assert ("40", "40") in sizes(REF.vehicles["SUPER_B_DOUBLE"])
    assert {("40", "40"), ("20", "20", "20", "20")} <= sizes(REF.vehicles["ROAD_TRAIN"])


def test_b_double_takes_one_20_on_lead_and_one_40_on_rear_only():
    bd = REF.vehicles["B_DOUBLE"]
    assert len(bd.container_combos) == 1
    (combo,) = bd.container_combos
    assert sorted((s.deck_id, s.size_class) for s in combo.slots) == [("lead", "20"), ("rear", "40")]
    for c in bd.container_combos:
        assert sum(s.size_class == "40" for s in c.slots) < 2
    assert bd.deck("lead").length_mm < NOMINAL_LENGTH["40"], "a 40' must not fit on the lead trailer"


# ---------------------------------------------------------------------------
# Bodies
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("vid", VEHICLE_IDS)
def test_allowed_and_default_bodies(vid):
    v = REF.vehicles[vid]
    assert set(v.allowed_bodies) <= set(REF.bodies)
    assert v.default_body in v.allowed_bodies
    assert all(REF.bodies[b].in_scope for b in v.allowed_bodies)
    if v.pallet_spaces:
        assert v.default_body == "TAUTLINER"
    if v.container_combos:
        assert {"SKELETAL", "SIDE_LOADER"} <= set(v.allowed_bodies)
    else:
        assert not {"SKELETAL", "SIDE_LOADER"} & set(v.allowed_bodies)


def test_body_flags():
    b = REF.bodies
    assert {k for k, x in b.items() if x.carries_pallets} == {
        "TAUTLINER", "PANTECH", "REFRIGERATED_PANTECH", "FLAT_TOP", "DROP_DECK"}
    assert {k for k, x in b.items() if x.carries_containers} == {"SKELETAL", "SIDE_LOADER", "FLAT_TOP"}
    assert b["FLAT_TOP"].container_optional
    assert set(b["TAUTLINER"].access) == set(b["FLAT_TOP"].access) == {"side", "rear"}
    assert b["PANTECH"].access == ["rear"]
    assert {k for k, x in b.items() if x.temp_controlled} == {"REFRIGERATED_PANTECH"}
    out_of_scope = {k for k, x in b.items() if not x.in_scope}
    assert out_of_scope == {"TIPPER", "TANKER", "CAR_CARRIER", "LIVESTOCK_CRATE"}
    low = b["LOW_LOADER"]
    assert low.in_scope and not low.carries_pallets and not low.carries_containers
    assert b["TAUTLINER"].internal_height_mm > b["PANTECH"].internal_height_mm > \
        b["REFRIGERATED_PANTECH"].internal_height_mm
    assert b["FLAT_TOP"].internal_height_mm is None


def test_reefer_containers_flagged():
    assert {k for k, c in REF.containers.items() if c.temp_controlled} == {"RF20", "RH40"}


def test_restricted_vehicles_have_permit_notes():
    for v in REF.vehicles.values():
        assert v.permit_note, v.id
        if v.configurable or v.route_restricted:
            assert "permit" in v.permit_note.lower() or "notice" in v.permit_note.lower()
    assert REF.vehicles["ROAD_TRAIN"].route_restricted and REF.vehicles["ROAD_TRAIN"].configurable
    assert REF.vehicles["SUPER_B_DOUBLE"].configurable


# ---------------------------------------------------------------------------
# Static beam sanity check (inline)
# ---------------------------------------------------------------------------

def _axle_loads(v: VehicleConfig, kg_per_space: float) -> dict[str, float]:
    """Each cargo deck carries kg_per_space x its spaces, spread evenly over its length (a point load
    at mid-deck for the reactions). Decks are solved top-down: a coupling reaction becomes a point
    load on the deck beneath."""
    loads = {d.id: [(d.x_mm + d.length_mm / 2, kg_per_space * d.pallet_spaces)] for d in v.cargo_decks}
    for d in v.decks:
        loads.setdefault(d.id, [])
    groups = {g.id: g.tare_kg for g in v.axle_groups}
    pending = {d.id: d for d in v.decks}
    while pending:
        carriers = {s.on_deck for d in pending.values() for s in (d.front_support, d.rear_support)}
        ready = [d for d in pending.values() if d.id not in carriers]
        assert ready, "support loop"
        for d in ready:
            a, b = d.front_support, d.rear_support
            total = sum(w for _, w in loads[d.id])
            rb = sum(w * (x - a.position_mm) for x, w in loads[d.id]) / (b.position_mm - a.position_mm)
            for s, r in ((a, total - rb), (b, rb)):
                if s.axle_group is not None:
                    groups[s.axle_group] += r
                else:
                    loads[s.on_deck].append((s.position_mm, r))
            del pending[d.id]
    return groups


@pytest.mark.parametrize("vid", ["SEMI_TRAILER", "B_DOUBLE"])
def test_full_deck_at_1000kg_per_space_is_within_gml(vid):
    v = REF.vehicles[vid]
    loads = _axle_loads(v, 1000)
    assert sum(loads.values()) == pytest.approx(v.tare_kg + 1000 * v.pallet_spaces)
    for gid, kg in loads.items():
        assert 0 < kg <= v.axle_group(gid).gml_kg, (vid, gid, round(kg))


def test_semi_takes_a_45ft_container_and_22_pallets():
    semi = REF.vehicles["SEMI_TRAILER"]
    assert semi.pallet_spaces == 22
    assert semi.deck("trailer").length_mm >= NOMINAL_LENGTH["45"]


# ---------------------------------------------------------------------------
# Overrides
# ---------------------------------------------------------------------------

def test_defaults_are_cached():
    assert load_reference() is load_reference()
    assert load_reference(ReferenceOverrides()) is load_reference()


def test_override_changes_a_value_and_leaves_defaults_alone():
    before = load_reference().model_dump()
    ref = load_reference(ReferenceOverrides(vehicles={"SEMI_TRAILER": {"max_payload_kg": 22000}},
                                            pallet_defaults={"max_stack_height_mm": 1500}))
    assert ref.vehicles["SEMI_TRAILER"].max_payload_kg == 22000
    assert ref.pallet_defaults.max_stack_height_mm == 1500
    assert ref.pallet_defaults.tare_kg == 35  # untouched sibling kept
    assert ref.vehicles["SEMI_TRAILER"].decks == REF.vehicles["SEMI_TRAILER"].decks
    assert load_reference().vehicles["SEMI_TRAILER"].max_payload_kg == 24000
    assert load_reference().model_dump() == before


def test_override_lists_replace_and_dicts_merge():
    ref = load_reference({"vehicles": {"SEMI_TRAILER": {"allowed_bodies": ["TAUTLINER"]}},
                          "containers": {"GP20": {"notes": "Our boxes"}}})
    assert ref.vehicles["SEMI_TRAILER"].allowed_bodies == ["TAUTLINER"]
    assert ref.containers["GP20"].notes == "Our boxes"
    assert ref.containers["GP20"].ext_length_mm == 6058


def test_override_adds_a_new_entry_only_when_complete():
    ref = load_reference({"pallets": {"HALF": {"name": "Half pallet", "length_mm": 800, "width_mm": 600}}})
    assert ref.pallets["HALF"].id == "HALF"
    assert "HALF" not in load_reference().pallets
    with pytest.raises(ValidationError):
        load_reference({"pallets": {"HALF": {"name": "Half pallet"}}})


def test_apply_overrides_on_any_reference():
    ref = apply_overrides(REF, {"bodies": {"TAUTLINER": {"internal_height_mm": 2600}}})
    assert ref.bodies["TAUTLINER"].internal_height_mm == 2600
    assert REF.bodies["TAUTLINER"].internal_height_mm == 2700


@pytest.mark.parametrize("bad", [
    {"vehicles": {"SEMI_TRAILER": {"max_payload_kg": -1}}},
    {"vehicles": {"SEMI_TRAILER": {"default_body": "NOPE"}}},
    {"vehicles": {"SEMI_TRAILER": {"allowed_bodies": ["PANTECH"]}}},  # default TAUTLINER not allowed
    {"vehicles": {"SEMI_TRAILER": {"unknown_field": 1}}},
    {"pallets": {"AU_STD": {"id": "OTHER"}}},
    {"pallet_defaults": {"default_pallet": "NOPE"}},
    {"not_a_section": {}},
])
def test_bad_overrides_raise(bad):
    with pytest.raises(ValueError):
        load_reference(bad)
    assert load_reference().vehicles["SEMI_TRAILER"].max_payload_kg == 24000


def test_override_with_a_support_loop_raises():
    semi = REF.vehicles["SEMI_TRAILER"].model_dump()
    pm, trailer = semi["decks"]
    pm["front_support"] = {"position_mm": 1500, "on_deck": "trailer"}
    with pytest.raises(ValueError, match="loop"):
        load_reference({"vehicles": {"SEMI_TRAILER": {"decks": [pm, trailer]}}})


# ---------------------------------------------------------------------------
# API
# ---------------------------------------------------------------------------

async def test_get_reference(client):
    r = await client.get("/api/reference")
    assert r.status_code == 200
    body = r.json()
    assert set(body) == {"pallets", "pallet_defaults", "containers", "bodies", "vehicles"}
    assert set(body["vehicles"]) == set(REF.vehicles)
    assert body["vehicles"]["SEMI_TRAILER"]["pallet_spaces"] == 22
    assert body["pallets"]["AU_STD"]["length_mm"] == 1165
