import pytest

from app.planner.axles import estimate_axle_loads
from app.planner.checks import postcheck, precheck, resolve_body
from app.planner.models import FreightItem, PlanWarning
from app.reference.schemas import VehicleConfig
from tests.factories import BODIES, RIGID, SEMI, containers, pallets, reference
from tests.test_axles import place, rows

REF = reference()


def pre(*items: FreightItem, vehicle: VehicleConfig = SEMI, body: str | None = None,
        ref=REF) -> list[PlanWarning]:
    return precheck(list(items), vehicle, resolve_body(vehicle, body, ref), ref).warnings


def codes(warnings: list[PlanWarning]) -> list[str]:
    return [w.code for w in warnings]


def one(warnings: list[PlanWarning], code: str) -> PlanWarning:
    found = [w for w in warnings if w.code == code]
    assert len(found) == 1, codes(warnings)
    return found[0]


# --- resolve_body ------------------------------------------------------------

def test_resolve_body_defaults_and_rejects_unknown():
    assert resolve_body(SEMI, None, REF).id == "TAUTLINER"
    assert resolve_body(SEMI, "SKELETAL", REF).id == "SKELETAL"
    with pytest.raises(ValueError):
        resolve_body(SEMI, "SPACESHIP", REF)


# --- precheck ----------------------------------------------------------------

def test_clean_pallet_load_has_no_warnings():
    assert pre(pallets(10)) == []


def test_pallets_on_skeletal_are_incompatible():
    w = one(pre(pallets(4), body="SKELETAL"), "BODY_INCOMPATIBLE")
    assert w.severity == "error"
    assert "skeletal" in w.message
    assert "tautliner" in w.suggestion
    assert w.item_ids == ["P"]


def test_containers_on_pantech_are_incompatible():
    w = one(pre(containers("GP40"), body="PANTECH"), "BODY_INCOMPATIBLE")
    assert w.item_ids == ["GP40"]
    assert "skeletal" in w.suggestion or "flat top" in w.suggestion


def test_containers_on_flat_top_are_fine():
    assert "BODY_INCOMPATIBLE" not in codes(pre(containers("GP40"), body="FLAT_TOP"))


def test_reefer_pallets_need_a_refrigerated_body():
    w = one(pre(pallets(4, temp=True)), "REEFER_ON_NON_REEFER")
    assert w.severity == "warning"
    assert "refrigerated pantech" in w.suggestion
    assert "REEFER_ON_NON_REEFER" not in codes(pre(pallets(4, temp=True), body="REFRIGERATED_PANTECH"))


def test_reefer_container_item_needs_a_reefer_container():
    item = containers("GP20").model_copy(update={"temp_controlled": True})
    assert one(pre(item, body="SKELETAL"), "REEFER_ON_NON_REEFER").item_ids == ["GP20"]
    reefer = containers("RF20").model_copy(update={"temp_controlled": True})
    assert "REEFER_ON_NON_REEFER" not in codes(pre(reefer, body="SKELETAL"))


def test_tall_pallet_is_over_the_max_stack_height():
    w = one(pre(pallets(2, height=2100)), "STACK_TOO_HIGH")
    assert w.severity == "error"
    assert "2.1 m" in w.message and "1.8 m" in w.message
    assert w.suggestion


def test_missing_height_uses_the_max_stack_height():
    item = pallets(2).model_copy(update={"height_mm": None})
    assert pre(item) == []


def test_pallet_over_internal_and_overall_height():
    ref = reference().model_copy(update={"pallet_defaults": REF.pallet_defaults.model_copy(
        update={"max_stack_height_mm": 4000})})
    warnings = pre(pallets(1, height=3100), ref=ref)
    assert one(warnings, "OVER_INTERNAL_HEIGHT").item_ids == ["P"]
    assert "4.4 m" in one(warnings, "OVER_HEIGHT_LIMIT").message  # 1.3 m deck + 3.1 m
    assert "STACK_TOO_HIGH" not in codes(warnings)


def test_tipper_is_out_of_scope():
    vehicle = RIGID.model_copy(update={"allowed_bodies": [*RIGID.allowed_bodies, "TIPPER"]})
    w = one(pre(pallets(2), vehicle=vehicle, body="TIPPER"), "OUT_OF_SCOPE_BODY")
    assert w.severity == "error"


def test_body_not_allowed_suggests_an_allowed_one():
    w = one(pre(pallets(2), vehicle=RIGID, body="SKELETAL"), "BODY_NOT_ALLOWED")
    assert "tautliner" in w.suggestion


def test_mixed_freight_is_an_error():
    w = one(pre(pallets(2), containers("GP20"), body="FLAT_TOP"), "MIXED_FREIGHT")
    assert w.severity == "error"
    assert set(w.item_ids) == {"P", "GP20"}


def test_unknown_types():
    w = one(pre(pallets(2, type_id="CHEP_XL"), pallets(1, id="Q")), "UNKNOWN_TYPE")
    assert w.item_ids == ["P"] and "CHEP_XL" in w.message
    assert one(pre(containers("GP99"), body="SKELETAL"), "UNKNOWN_TYPE").item_ids == ["GP99"]


def test_container_over_max_gross():
    w = one(pre(containers("GP20", weight=32000), body="SKELETAL"), "CONTAINER_OVER_MAX_GROSS")
    assert "32.0 t" in w.message and "30.48 t" in w.message


def test_high_cube_on_a_high_flat_top_deck_is_over_the_height_limit():
    trailer = SEMI.deck("trailer").model_copy(update={"deck_height_mm": 1500})
    high = SEMI.model_copy(update={"decks": [SEMI.deck("prime_mover"), trailer]})
    w = one(pre(containers("HC40"), vehicle=high, body="FLAT_TOP"), "OVER_HEIGHT_LIMIT")
    assert "4.4 m" in w.message and "4.3 m" in w.message
    assert "OVER_HEIGHT_LIMIT" not in codes(pre(containers("GP40"), vehicle=high, body="FLAT_TOP"))
    assert "OVER_HEIGHT_LIMIT" not in codes(pre(containers("HC40"), body="FLAT_TOP"))  # 1.3 m deck


def test_route_restricted_vehicle_gets_an_info():
    train = SEMI.model_copy(update={"id": "TRAIN", "name": "Road train", "route_restricted": True,
                                    "permit_note": "Needs a NHVR permit."})
    w = one(pre(pallets(2), vehicle=train), "ROUTE_RESTRICTED")
    assert w.severity == "info"
    assert "NHVR permit" in w.message


# --- postcheck ---------------------------------------------------------------

def post(placements, vehicle=SEMI, scheme="GML", ref=REF, total=None):
    loads = estimate_axle_loads(vehicle, placements, scheme)
    total = sum(p.weight_kg for p in placements) if total is None else total
    return postcheck(placements, vehicle, BODIES["TAUTLINER"], loads, total, scheme, ref).warnings


def test_uniform_22_tonnes_on_semi_has_no_errors():
    warnings = post(rows("trailer", 13600, 11, 1000))
    assert not [w for w in warnings if w.severity == "error"]


def test_overweight_but_in_space_is_over_payload():
    placements = rows("body", 4800, 4, 1200)  # 8 pallets fit, 9.6 t on a rigid 8 t
    w = one(post(placements, vehicle=RIGID), "OVER_PAYLOAD")
    assert w.severity == "error"
    assert w.message.startswith("Over by 1.6 t")
    assert "Semi-trailer" in w.suggestion and "split" in w.suggestion


def test_over_payload_with_no_bigger_vehicle_suggests_splitting():
    w = one(post([], vehicle=RIGID, total=99_000), "OVER_PAYLOAD")
    assert w.suggestion == "Split the load across two vehicles."


def test_heavy_rear_puts_the_tri_over_its_limit():
    placements = rows("trailer", 13600, 11, 1800, only_rows=range(5, 11))
    w = one(post(placements), "AXLE_OVER_LIMIT")
    assert w.severity == "error"
    assert "Trailer tri-axle" in w.message
    assert "forward" in w.suggestion
    assert "HML" not in w.suggestion  # 23.3 t is over the HML limit as well


def test_axle_over_gml_mentions_hml_when_it_would_cover_it():
    placements = [place("trailer", 15100 - 3700, 16000)]  # tri 20.8 t
    w = one(post(placements), "AXLE_OVER_LIMIT")
    assert "HML" in w.suggestion and "22.5 t" in w.suggestion
    warnings = post(placements, scheme="HML")
    assert "AXLE_OVER_LIMIT" not in codes(warnings)
    assert one(warnings, "AXLE_NEAR_LIMIT").severity == "warning"


def test_placed_stack_over_the_height_limit():
    low = place("trailer", 2000, 500, n=1)
    top = place("trailer", 2000, 500, n=2).model_copy(update={"z_mm": 1200, "height_mm": 1900, "stack_id": 1,
                                                              "stack_level": 1})
    w = one(post([low, top]), "OVER_HEIGHT_LIMIT")
    assert "4.4 m" in w.message  # 1.3 + 1.2 + 1.9
    assert "OVER_HEIGHT_LIMIT" not in codes(post([low]))
