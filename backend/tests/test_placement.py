"""Heuristic placement: pallets, stacks, LIFO, deck spill, balance, containers, utilisation.

The rule modules (checks, axles) are replaced with simple fakes so these tests cover placement only.
"""

import itertools

import pytest

from app.planner import axles, checks, heuristic
from app.planner.heuristic import HeuristicPlanner, expand_units, place_containers, place_pallets
from app.planner.models import Placement, PlanWarning
from app.reference.schemas import ContainerType, ReferenceData, VehicleConfig
from tests.factories import BDOUBLE, RIGID, SEMI, containers, loose, pallets, reference, request


@pytest.fixture(autouse=True)
def fake_rules(monkeypatch):
    """Rules that pass everything, so a plan's warnings come from placement alone."""
    monkeypatch.setattr(checks, "resolve_body", lambda v, body, ref: ref.bodies[body or v.default_body])
    monkeypatch.setattr(checks, "precheck", lambda items, v, body, ref, rule_set="adg": checks.CheckResult())
    monkeypatch.setattr(checks, "postcheck", lambda *args, **kw: checks.CheckResult())
    monkeypatch.setattr(axles, "estimate_axle_loads", lambda v, placements, scheme="GML": [])


@pytest.fixture
def ref() -> ReferenceData:
    return reference()


def plan(ref: ReferenceData, *items, **kw):
    return HeuristicPlanner().plan(request(*items, **kw), ref)


def codes(result) -> list[str]:
    return [w.code for w in result.warnings]


def assert_no_overlap(placements: list[Placement]) -> None:
    """No two units on the same deck share any volume (touching faces are fine)."""
    for a, b in itertools.combinations(placements, 2):
        if a.deck_id != b.deck_id:
            continue
        overlap = (a.x_mm < b.x_mm + b.length_mm and b.x_mm < a.x_mm + a.length_mm
                   and a.y_mm < b.y_mm + b.width_mm and b.y_mm < a.y_mm + a.width_mm
                   and a.z_mm < b.z_mm + b.height_mm and b.z_mm < a.z_mm + a.height_mm)
        assert not overlap, f"{a.unit_id} overlaps {b.unit_id}"


def assert_within_decks(placements: list[Placement], vehicle: VehicleConfig) -> None:
    for p in placements:
        deck = vehicle.deck(p.deck_id)
        assert deck.cargo, p.unit_id
        assert 0 <= p.x_mm and p.x_mm + p.length_mm <= deck.length_mm, p.unit_id
        assert 0 <= p.y_mm and p.y_mm + p.width_mm <= deck.width_mm, p.unit_id
        assert p.z_mm >= 0, p.unit_id


def floor_positions(placements: list[Placement]) -> int:
    return sum(1 for p in placements if p.stack_level == 0)


def row_centre(placements: list[Placement], item_id: str) -> float:
    row = [p for p in placements if p.item_id == item_id]
    assert len({p.x_mm for p in row}) == 1, "expected the item to fill one row"
    return row[0].x_mm + row[0].length_mm / 2


# ---------------------------------------------------------------------------
# Units
# ---------------------------------------------------------------------------

def test_unit_ids_number_each_item_from_one(ref):
    units = expand_units([pallets(3, id="A"), pallets(2, id="B")])
    assert [u.unit_id for u in units] == ["A#1", "A#2", "A#3", "B#1", "B#2"]

    result = plan(ref, pallets(3, id="A"), pallets(2, id="B"))
    assert sorted(p.unit_id for p in result.placements) == ["A#1", "A#2", "A#3", "B#1", "B#2"]
    assert all(p.unit_id.startswith(f"{p.item_id}#") for p in result.placements)


# ---------------------------------------------------------------------------
# Pallets: capacity
# ---------------------------------------------------------------------------

def test_semi_takes_exactly_22_au(ref):
    result = plan(ref, pallets(22))
    assert result.fits and result.reasons == [] and result.unplaced == []
    assert result.planner == "heuristic"
    assert len(result.placements) == 22
    assert len({p.x_mm for p in result.placements}) == 11  # 11 rows
    assert {p.y_mm for p in result.placements} == {0, 1165}  # 2 across, flush
    assert_no_overlap(result.placements)
    assert_within_decks(result.placements, SEMI)


def test_23rd_au_is_over_capacity(ref):
    result = plan(ref, pallets(23))
    assert not result.fits
    assert result.unplaced == ["P#23"]
    assert len(result.placements) == 22
    [warning] = [w for w in result.warnings if w.code == "OVER_CAPACITY"]
    assert warning.severity == "error"
    assert "Over by 1" in warning.message
    assert "B-double" in warning.suggestion
    assert warning.item_ids == ["P"]
    assert result.reasons == [warning.message]


def test_mixed_pallet_types_dont_overlap_and_stay_on_the_deck(ref):
    result = plan(ref, pallets(6, id="AU"), pallets(9, id="EU", type_id="EURO"),
                  pallets(4, id="UK", type_id="ISO_UK"))
    assert result.fits and len(result.placements) == 19
    assert_no_overlap(result.placements)
    assert_within_decks(result.placements, SEMI)
    euro = [p for p in result.placements if p.type_id == "EURO"]
    assert all(p.width_mm == 800 and p.length_mm == 1200 for p in euro)
    assert max(sum(1 for p in euro if p.x_mm == x) for x in {p.x_mm for p in euro}) == 3  # 3 across


def test_three_euro_fit_across_the_deck(ref):
    placements, unplaced = place_pallets(expand_units([pallets(3, type_id="EURO")]), SEMI,
                                         ref.bodies["TAUTLINER"], ref)
    assert unplaced == []
    assert len({p.x_mm for p in placements}) == 1  # one row
    assert sorted(p.y_mm for p in placements) == [0, 800, 1600]


# ---------------------------------------------------------------------------
# Pallets: stacking
# ---------------------------------------------------------------------------

def test_stackable_pallets_double_up(ref):
    result = plan(ref, pallets(44, height=900, stackable=True))
    assert result.fits and len(result.placements) == 44
    assert floor_positions(result.placements) == 22
    assert {p.stack_level for p in result.placements} == {0, 1}
    assert "UNSTACKABLE_FLOOR_SPACE" not in codes(result)
    assert_no_overlap(result.placements)
    for stack_id in {p.stack_id for p in result.placements}:
        stack = sorted((p for p in result.placements if p.stack_id == stack_id), key=lambda p: p.stack_level)
        assert stack[-1].z_mm + stack[-1].height_mm <= 1800


def test_heavier_pallet_goes_at_the_bottom(ref):
    result = plan(ref, pallets(1, 300, id="LIGHT", height=900, stackable=True),
                  pallets(1, 900, id="HEAVY", height=900, stackable=True))
    by_item = {p.item_id: p for p in result.placements}
    assert by_item["HEAVY"].stack_id == by_item["LIGHT"].stack_id
    assert by_item["HEAVY"].stack_level == 0 and by_item["LIGHT"].z_mm == 900


def test_unstackable_pallets_dont_stack_and_get_a_note(ref):
    result = plan(ref, pallets(22, height=900))
    assert result.fits
    assert floor_positions(result.placements) == 22
    [warning] = [w for w in result.warnings if w.code == "UNSTACKABLE_FLOOR_SPACE"]
    assert warning.severity == "info"  # it all fits, so it's only a note
    assert warning.item_ids == ["P"]
    assert "11" in warning.message


def test_unstackable_warns_when_short_of_space(ref):
    result = plan(ref, pallets(30, height=900))
    [warning] = [w for w in result.warnings if w.code == "UNSTACKABLE_FLOOR_SPACE"]
    assert warning.severity == "warning"


def test_stacks_never_mix_pallet_types(ref):
    result = plan(ref, pallets(3, id="A", height=900, stackable=True),
                  pallets(3, id="E", type_id="EURO", height=900, stackable=True))
    for stack_id in {p.stack_id for p in result.placements}:
        assert len({p.type_id for p in result.placements if p.stack_id == stack_id}) == 1


def test_pallet_without_height_takes_a_full_stack(ref):
    result = plan(ref, pallets(2, height=None, stackable=True))
    assert floor_positions(result.placements) == 2
    assert {p.height_mm for p in result.placements} == {1800}


# ---------------------------------------------------------------------------
# Pallets: decks, balance
# ---------------------------------------------------------------------------

def test_bdouble_spills_from_lead_to_rear_deck(ref):
    result = plan(ref, pallets(30), vehicle="BDOUBLE")
    assert result.fits and len(result.placements) == 30
    assert sum(1 for p in result.placements if p.deck_id == "lead") == 12
    assert sum(1 for p in result.placements if p.deck_id == "rear") == 18
    assert_no_overlap(result.placements)
    assert_within_decks(result.placements, BDOUBLE)


def test_balance_puts_the_heaviest_row_near_the_supports_midpoint(ref):
    result = plan(ref, pallets(2, 300, id="LIGHT"), pallets(2, 2000, id="HEAVY"), pallets(18, 1000, id="MID"))
    deck = SEMI.deck("trailer")
    target = heuristic.balance_target_mm(deck)
    assert target == 6200  # (4700 + 15100) / 2 - 3700
    heavy, light = row_centre(result.placements, "HEAVY"), row_centre(result.placements, "LIGHT")
    assert abs(heavy - target) < abs(light - target)
    assert heavy < deck.rear_support.position_mm - deck.x_mm  # not in the rear overhang
    assert_no_overlap(result.placements)
    assert_within_decks(result.placements, SEMI)


# ---------------------------------------------------------------------------
# Containers
# ---------------------------------------------------------------------------

def test_two_20s_on_a_semi(ref):
    result = plan(ref, containers("GP20", 2), body="SKELETAL")
    assert result.fits
    assert sorted(p.x_mm for p in result.placements) == [700, 6800]
    assert {p.y_mm for p in result.placements} == {(2480 - 2438) // 2}
    assert {p.z_mm for p in result.placements} == {0}
    assert_no_overlap(result.placements)
    assert_within_decks(result.placements, SEMI)


def test_one_40_on_a_semi(ref):
    result = plan(ref, containers("GP40"), body="SKELETAL")
    assert result.fits
    [p] = result.placements
    assert (p.deck_id, p.x_mm, p.length_mm, p.width_mm, p.height_mm) == ("trailer", 700, 12192, 2438, 2591)


def test_two_40s_on_a_bdouble_is_a_combo_error(ref):
    result = plan(ref, containers("GP40", 2), vehicle="BDOUBLE", body="SKELETAL")
    assert not result.fits
    assert result.placements == [] and result.unplaced == ["GP40#1", "GP40#2"]
    [warning] = [w for w in result.warnings if w.code == "CONTAINER_COMBO"]
    assert warning.severity == "error"
    assert warning.message == "A B-double takes 1 × 20' + 1 × 40', not 2 × 40'."


def test_20_and_40_on_a_bdouble_puts_the_20_on_the_lead(ref):
    result = plan(ref, containers("GP40"), containers("GP20"), vehicle="BDOUBLE", body="SKELETAL")
    assert result.fits
    deck_of = {p.type_id: p.deck_id for p in result.placements}
    assert deck_of == {"GP20": "lead", "GP40": "rear"}
    assert_within_decks(result.placements, BDOUBLE)


def test_containers_on_a_rigid_are_a_combo_error(ref):
    result = plan(ref, containers("GP20"), vehicle="RIGID")
    assert not result.fits
    assert "CONTAINER_COMBO" in codes(result)
    assert result.unplaced == ["GP20#1"]


def test_heaviest_container_takes_the_slot_nearest_the_balance_target(ref):
    result = plan(ref, containers("GP20", weight=5000, id="LIGHT"),
                  containers("GP20", weight=20000, id="HEAVY"), body="SKELETAL")
    x_of = {p.item_id: p.x_mm for p in result.placements}
    # The tri-axle has more spare capacity than the kingpin, so the target is about 6,877 mm along
    # the deck: slot centres 3,729 and 9,829, and the rear slot is nearer.
    assert x_of == {"HEAVY": 6800, "LIGHT": 700}


def test_a_part_load_is_centred_over_the_axles(ref):
    result = plan(ref, pallets(6, 1200), vehicle="RIGID")
    deck = RIGID.deck("body")
    xs = [p.x_mm for p in result.placements]
    assert min(xs) > 0  # not packed against the front of the body
    centre = (min(xs) + max(p.x_mm + p.length_mm for p in result.placements)) / 2
    assert abs(centre - heuristic.balance_target_mm(deck, RIGID)) < 600


def test_container_without_dimensions_uses_nominal_size(ref):
    flat_rack = ContainerType(id="FR40", name="40' flat rack", size_class="40", teu=2, specialist=True)
    ref = ref.model_copy(update={"containers": {**ref.containers, "FR40": flat_rack}})
    placements, unplaced, warnings = place_containers(expand_units([containers("FR40")]), SEMI, ref)
    assert unplaced == [] and warnings == []
    [p] = placements
    assert (p.length_mm, p.width_mm, p.height_mm) == (12192, 2438, 2591)


# ---------------------------------------------------------------------------
# Plan orchestration and utilisation
# ---------------------------------------------------------------------------

def test_utilisation_for_ten_au_pallets(ref):
    result = plan(ref, pallets(10, 500, height=1200))
    u = result.utilisation
    assert (u.pallet_spaces.used, u.pallet_spaces.available, u.pallet_spaces.pct) == (10, 22, 45.5)
    assert (u.payload_kg.used, u.payload_kg.available, u.payload_kg.pct) == (5000, 24000, 20.8)
    assert (u.teu.used, u.teu.available, u.teu.pct) == (0, 2, 0)
    # 10 x 1.165 x 1.165 x 1.2 m vs 13.6 x 2.48 x 2.7 m (tautliner internal height)
    assert (u.volume_m3.used, u.volume_m3.available, u.volume_m3.pct) == (16.29, 91.07, 17.9)
    assert result.total_weight_kg == 5000
    assert result.max_load_height_mm == 1300 + 1200


def test_utilisation_counts_other_pallets_by_area(ref):
    result = plan(ref, pallets(3, type_id="EURO"))
    assert result.utilisation.pallet_spaces.used == 2.1  # 3 x 1200 x 800 / 1165²


def test_utilisation_for_containers(ref):
    result = plan(ref, containers("GP20"), containers("GP40"), vehicle="BDOUBLE", body="SKELETAL")
    assert (result.utilisation.teu.used, result.utilisation.teu.available) == (3, 3)
    assert result.utilisation.pallet_spaces.used == 0


# --- Loose items ---------------------------------------------------------------

def test_loose_items_are_placed_with_their_own_footprint(ref):
    result = plan(ref, loose(2, 6000, 400, id="pipe"), vehicle="SEMI")
    assert result.fits and result.unplaced == []
    assert [(p.kind, p.type_id, p.length_mm, p.width_mm, p.rotated) for p in result.placements] \
        == [("loose", "LOOSE", 6000, 400, False)] * 2
    assert len({p.x_mm for p in result.placements}) == 1          # side by side: one long row
    assert sorted(p.y_mm for p in result.placements) == [0, 400]
    assert_within_decks(result.placements, SEMI)
    assert result.utilisation.pallet_spaces.used == 3.5           # 2 x 6000 x 400 / 1165²


def test_a_loose_item_turns_to_fit_the_deck_width(ref):
    (p,) = plan(ref, loose(1, 2000, 3000), vehicle="RIGID").placements   # the deck is 2,400 wide
    assert (p.length_mm, p.width_mm, p.rotated) == (3000, 2000, True)


def test_loose_items_stack_only_on_the_same_footprint(ref):
    result = plan(ref, loose(2, 3000, 1000, id="A", stackable=True),
                  loose(2, 3000, 900, id="B", stackable=True), loose(1, 3000, 1000, id="C", stackable=True),
                  loose(1, 3000, 1000, id="D"), vehicle="SEMI")
    stacks: dict[int, list[str]] = {}
    for p in result.placements:
        stacks.setdefault(p.stack_id, []).append(p.item_id)
    assert sorted(sorted(s) for s in stacks.values()) == [["A", "A", "C"], ["B", "B"], ["D"]]
    for stack_id in stacks:
        members = [p for p in result.placements if p.stack_id == stack_id]
        assert len({(p.x_mm, p.y_mm, p.length_mm, p.width_mm) for p in members}) == 1
    assert_no_overlap(result.placements)


def test_pallets_and_loose_items_share_a_plan(ref):
    result = plan(ref, pallets(6), loose(2, 5000, 600, id="timber"), vehicle="SEMI")
    assert result.fits and result.unplaced == []
    assert sorted({p.kind for p in result.placements}) == ["loose", "pallet"]
    assert_no_overlap(result.placements)
    assert_within_decks(result.placements, SEMI)
    assert result.total_weight_kg == 6 * 500 + 2 * 300


def test_a_loose_item_longer_than_the_deck_is_unplaced_not_over_capacity(ref):
    result = plan(ref, loose(1, 6000, 400, id="pipe"), pallets(2), vehicle="RIGID")   # 4,800 deck
    assert result.unplaced == ["pipe#1"]
    assert [p.item_id for p in result.placements] == ["P", "P"]
    assert "OVER_CAPACITY" not in codes(result)   # precheck reports it (OVERSIZE_FOOTPRINT)


def test_loose_items_that_run_out_of_floor_are_over_capacity(ref):
    result = plan(ref, loose(4, 4000, 2000, id="crate"), vehicle="SEMI")   # 3 fit along 13,600
    assert len(result.placements) == 3 and result.unplaced == ["crate#4"]
    (warning,) = [w for w in result.warnings if w.code == "OVER_CAPACITY"]
    assert "Over by 1 floor position" in warning.message


def test_loose_items_and_containers_place_nothing(ref):
    result = plan(ref, loose(1, 2000, 1000), containers("GP20"))
    assert result.placements == [] and result.unplaced == ["L#1", "GP20#1"]


def test_mixed_freight_places_nothing(ref, monkeypatch):
    mixed = PlanWarning(code="MIXED_FREIGHT", severity="error", message="Pallets and containers can't mix.")
    monkeypatch.setattr(checks, "precheck", lambda *a: checks.CheckResult(warnings=[mixed]))
    result = plan(ref, pallets(2), containers("GP20"))
    assert result.placements == []
    assert result.unplaced == ["P#1", "P#2", "GP20#1"]
    assert not result.fits and result.reasons == ["Pallets and containers can't mix."]
    assert result.max_load_height_mm == 0 and result.total_weight_kg == 0


def test_plan_passes_placements_to_the_rules(ref, monkeypatch):
    seen = {}

    def postcheck(placements, vehicle, body, axle_loads, total, scheme, ref):
        seen.update(n=len(placements), total=total, scheme=scheme, body=body.id)
        heavy = PlanWarning(code="OVER_PAYLOAD", severity="error", message="Heavy.")
        return checks.CheckResult(warnings=[heavy])

    monkeypatch.setattr(checks, "postcheck", postcheck)
    result = plan(ref, pallets(4, 1000), mass_scheme="HML", body="PANTECH")
    assert seen == {"n": 4, "total": 4000, "scheme": "HML", "body": "PANTECH"}
    assert not result.fits and result.reasons == ["Heavy."]
    assert result.body_type == "PANTECH" and result.mass_scheme == "HML"


def test_unknown_vehicle_raises(ref):
    with pytest.raises(ValueError):
        plan(ref, pallets(1), vehicle="NOPE")
