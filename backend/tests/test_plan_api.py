"""End-to-end: POST /api/plan with the real reference data (app/reference), through the heuristic,
the rule checks and the axle estimate. The unit tests use tests/factories.py instead."""

import pytest


def pallet(qty, weight=500, *, id="P", type_id="AU_STD", height=1200, **kw):
    return {"id": id, "kind": "pallet", "type_id": type_id, "quantity": qty, "gross_weight_kg": weight,
            "height_mm": height, **kw}


def container(type_id, qty=1, weight=15000, *, id=None):
    return {"id": id or type_id, "kind": "container", "type_id": type_id, "quantity": qty,
            "gross_weight_kg": weight}


async def plan(client, *items, vehicle="SEMI_TRAILER", **kw):
    res = await client.post("/api/plan", json={"items": list(items), "vehicle_id": vehicle, **kw})
    assert res.status_code == 200, res.text
    return res.json()


def codes(result, severity=None):
    return [w["code"] for w in result["warnings"] if severity is None or w["severity"] == severity]


def assert_no_overlap(placements):
    def box(p):
        return (p["deck_id"], p["x_mm"], p["x_mm"] + p["length_mm"], p["y_mm"], p["y_mm"] + p["width_mm"],
                p["z_mm"], p["z_mm"] + p["height_mm"])
    boxes = [box(p) for p in placements]
    for i, a in enumerate(boxes):
        for b in boxes[i + 1:]:
            if a[0] == b[0]:
                assert not (a[1] < b[2] and b[1] < a[2] and a[3] < b[4] and b[3] < a[4]
                            and a[5] < b[6] and b[5] < a[6]), (a, b)


# ---- The required cases -----------------------------------------------------

async def test_exact_fit_22_au_pallets_on_a_semi(client):
    r = await plan(client, pallet(22, 1000))
    assert r["fits"] and not r["unplaced"] and len(r["placements"]) == 22
    assert r["utilisation"]["pallet_spaces"] == {"used": 22.0, "available": 22.0, "pct": 100.0}
    assert "error" not in [w["severity"] for w in r["warnings"]]
    assert all(a["status"] != "over" for a in r["axle_loads"])
    assert_no_overlap(r["placements"])


async def test_one_pallet_over_capacity(client):
    r = await plan(client, pallet(23))
    assert not r["fits"]
    assert codes(r, "error") == ["OVER_CAPACITY"]
    assert r["unplaced"] == ["P#23"]
    over = next(w for w in r["warnings"] if w["code"] == "OVER_CAPACITY")
    assert over["message"].startswith("Over by 1 pallet")
    assert "B-double" in over["suggestion"]


async def test_overweight_but_within_space(client):
    r = await plan(client, pallet(20, 1300))
    assert not r["fits"] and not r["unplaced"]
    assert "OVER_PAYLOAD" in codes(r, "error")
    assert r["utilisation"]["payload_kg"]["used"] == 26000


async def test_two_40ft_containers_on_a_b_double_fail(client):
    r = await plan(client, container("GP40", 2), vehicle="B_DOUBLE", body_type="SKELETAL")
    assert not r["fits"] and codes(r, "error") == ["CONTAINER_COMBO"]
    assert "1 × 20' + 1 × 40'" in r["reasons"][0]


async def test_a_20_and_a_40_on_a_b_double_fit_with_the_20_on_the_lead(client):
    r = await plan(client, container("GP20", weight=12000), container("GP40", weight=20000),
                   vehicle="B_DOUBLE", body_type="SKELETAL")
    assert r["fits"]
    deck = {p["type_id"]: p["deck_id"] for p in r["placements"]}
    assert deck == {"GP20": "lead", "GP40": "rear"}
    assert r["utilisation"]["teu"]["used"] == 3


async def test_mixed_pallet_types(client):
    r = await plan(client, pallet(6, 600), pallet(6, 500, id="E", type_id="EURO"),
                   pallet(4, 700, id="I", type_id="ISO_UK"))
    assert r["fits"] and len(r["placements"]) == 16
    assert {p["type_id"] for p in r["placements"]} == {"AU_STD", "EURO", "ISO_UK"}
    assert_no_overlap(r["placements"])
    for p in r["placements"]:
        assert 0 <= p["y_mm"] and p["y_mm"] + p["width_mm"] <= 2480


async def test_unstackable_items_take_floor_space(client):
    stacked = await plan(client, pallet(30, 300, height=900, stackable=True))
    assert stacked["fits"] and stacked["utilisation"]["pallet_spaces"]["used"] == 15
    loose = await plan(client, pallet(30, 300, height=900))
    assert not loose["fits"] and len(loose["unplaced"]) == 8
    assert "UNSTACKABLE_FLOOR_SPACE" in codes(loose, "warning")


async def test_axle_overload(client):
    # Stop 1 drops first, so it rides at the rear: 12 heavy pallets over the trailer tri-axle.
    r = await plan(client, pallet(12, 1800, id="H", stop=1), pallet(10, 50, id="L", stop=2))
    assert not r["fits"] and codes(r, "error") == ["AXLE_OVER_LIMIT"]
    tri = next(a for a in r["axle_loads"] if a["group_id"] == "trailer_tri")
    assert tri["status"] == "over" and tri["load_kg"] > tri["limit_kg"]
    # Higher Mass Limits cover it.
    hml = await plan(client, pallet(12, 1800, id="H", stop=1), pallet(10, 50, id="L", stop=2),
                     mass_scheme="HML")
    assert "AXLE_OVER_LIMIT" not in codes(hml)


# ---- More rules -------------------------------------------------------------

async def test_multi_drop_loads_the_last_stop_at_the_front(client):
    r = await plan(client, pallet(4, id="A", stop=1), pallet(4, id="B", stop=2), pallet(4, id="C", stop=3))
    front = {item: min(p["x_mm"] for p in r["placements"] if p["item_id"] == item) for item in "ABC"}
    assert front["C"] < front["B"] < front["A"]


async def test_pallets_on_a_skeletal_are_rejected(client):
    r = await plan(client, pallet(4), body_type="SKELETAL")
    assert not r["fits"] and "BODY_INCOMPATIBLE" in codes(r, "error")


async def test_reefer_items_on_a_tautliner_warn(client):
    r = await plan(client, pallet(4, temp_controlled=True))
    assert r["fits"] and "REEFER_ON_NON_REEFER" in codes(r, "warning")
    cold = await plan(client, pallet(4, temp_controlled=True), body_type="REFRIGERATED_PANTECH")
    assert "REEFER_ON_NON_REEFER" not in codes(cold)


async def test_too_tall_is_reported_once(client):
    r = await plan(client, pallet(2, height=3200), body_type="FLAT_TOP")
    assert not r["fits"]
    assert codes(r).count("OVER_HEIGHT_LIMIT") == 1
    assert "STACK_TOO_HIGH" in codes(r)


async def test_mixed_freight_and_unknown_types_do_not_fit(client):
    mixed = await plan(client, pallet(2), container("GP20"))
    assert not mixed["fits"] and "MIXED_FREIGHT" in codes(mixed, "error") and not mixed["placements"]
    unknown = await plan(client, pallet(2, type_id="NOPE"))
    assert not unknown["fits"] and "UNKNOWN_TYPE" in codes(unknown, "error")


async def test_suggest_picks_the_smallest_vehicle_that_fits(client):
    r = await plan(client, pallet(7), vehicle="suggest")
    assert r["fits"] and r["vehicle_id"] == "RIGID_MEDIUM"
    assert [t["vehicle_id"] for t in r["tried"]] == ["RIGID_SMALL", "RIGID_MEDIUM"]


async def test_overrides_change_the_limits(client):
    r = await plan(client, pallet(20, 1000),
                   overrides={"vehicles": {"SEMI_TRAILER": {"max_payload_kg": 18000}}})
    assert "OVER_PAYLOAD" in codes(r, "error")


@pytest.mark.parametrize("body, status", [
    ({"items": [pallet(1)], "vehicle_id": "NOPE"}, 400),
    ({"items": [pallet(1)], "body_type": "NOPE"}, 400),
    ({"items": [pallet(1)], "overrides": {"vehicles": {"SEMI_TRAILER": {"max_payload_kg": -1}}}}, 400),
    ({"items": []}, 422),
])
async def test_bad_requests(client, body, status):
    res = await client.post("/api/plan", json=body)
    assert res.status_code == status
