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
    # The planner fills a B-double's lead trailer first: 22 pallets of 1.3 t put its tri-axle over 20 t.
    r = await plan(client, pallet(22, 1300), vehicle="B_DOUBLE")
    assert not r["fits"] and codes(r, "error") == ["AXLE_OVER_LIMIT"]
    tri = next(a for a in r["axle_loads"] if a["group_id"] == "lead_tri")
    assert tri["status"] == "over" and tri["load_kg"] > tri["limit_kg"]
    # Higher Mass Limits cover it.
    hml = await plan(client, pallet(22, 1300), vehicle="B_DOUBLE", mass_scheme="HML")
    assert "AXLE_OVER_LIMIT" not in codes(hml)


async def test_a_part_load_on_a_rigid_is_centred_so_the_steer_axle_copes(client):
    r = await plan(client, pallet(6, 1200), vehicle="RIGID_MEDIUM")
    assert r["fits"], r["reasons"]
    assert min(p["x_mm"] for p in r["placements"]) > 0


# ---- More rules -------------------------------------------------------------

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


# ---- Review fixes ----------------------------------------------------------

async def test_a_pallet_over_its_rated_weight_does_not_fit(client):
    r = await plan(client, pallet(2, 1800))
    assert not r["fits"] and "PALLET_OVER_MAX_GROSS" in codes(r, "error")
    assert "1.5 t" in next(w["message"] for w in r["warnings"] if w["code"] == "PALLET_OVER_MAX_GROSS")


async def test_duplicate_item_ids_are_rejected(client):
    res = await client.post("/api/plan", json={"items": [pallet(2), pallet(3)]})
    assert res.status_code == 422 and "repeated: P" in res.text


async def test_too_many_units_are_rejected(client):
    items = [pallet(200, id=f"P{i}") for i in range(3)]
    res = await client.post("/api/plan", json={"items": items})
    assert res.status_code == 422 and "at most 500" in res.text


async def test_the_largest_request_is_quick(client):
    import time
    items = [pallet(100, 100, id=f"P{i}", height=1700, stackable=True) for i in range(5)]
    started = time.perf_counter()
    await plan(client, *items, vehicle="suggest")
    assert time.perf_counter() - started < 5


async def test_a_lower_pallet_space_override_caps_the_load(client):
    r = await plan(client, pallet(20), overrides={"vehicles": {"SEMI_TRAILER": {"pallet_spaces": 18}}})
    assert not r["fits"] and len(r["placements"]) == 18
    assert r["utilisation"]["pallet_spaces"] == {"used": 18.0, "available": 18.0, "pct": 100.0}


async def test_more_pallet_spaces_than_the_deck_holds_is_rejected(client):
    res = await client.post("/api/plan", json={
        "items": [pallet(1)], "overrides": {"vehicles": {"SEMI_TRAILER": {"pallet_spaces": 30}}}})
    assert res.status_code == 400 and "won't fit on its decks" in res.text


async def test_suggest_keeps_the_requested_body(client):
    r = await plan(client, pallet(7), vehicle="suggest", body_type="DROP_DECK")
    assert r["vehicle_id"] == "SEMI_TRAILER" and r["body_type"] == "DROP_DECK"
    assert not r["tried"][0]["fits"] and "drop deck" in r["tried"][0]["reason"].lower()


async def test_a_pallet_wider_than_the_deck_is_oversize_not_over_capacity(client):
    r = await plan(client, pallet(1, type_id="WIDE"),
                   overrides={"pallets": {"WIDE": {"name": "Wide skid", "length_mm": 2600,
                                                   "width_mm": 2600}}})
    assert codes(r, "error") == ["OVERSIZE_FOOTPRINT"] and r["unplaced"] == ["P#1"]


# ---- Dangerous goods ----------------------------------------------------------

def dg(cls=None, subsidiary=(), **kw):
    return {"dg_class": cls, "subsidiary": list(subsidiary), "t92": [] if cls else None, **kw}


async def test_incompatible_dangerous_goods_cant_share_the_vehicle(client):
    r = await plan(client, pallet(2, id="paint", label="Paint", dg=dg("3")),
                   pallet(2, id="chlorine", label="Pool chlorine", dg=dg("5.1")))
    assert not r["fits"]
    [w] = [w for w in r["warnings"] if w["code"] == "DG_INCOMPATIBLE"]
    assert w["item_ids"] == ["paint", "chlorine"]
    assert '"Paint" (Class 3)' in w["message"] and "Table 9.1" in w["message"]
    assert "separate loads" in w["suggestion"]


async def test_compatible_dangerous_goods_fit_with_a_note(client):
    r = await plan(client, pallet(2, id="paint", dg=dg("3")), pallet(2, id="acid", dg=dg("8")))
    assert r["fits"] and "DG_INCOMPATIBLE" not in codes(r)
    [note] = [w for w in r["warnings"] if w["code"] == "DG_ON_BOARD"]
    assert note["severity"] == "info" and "Class 3, 8" in note["message"]


async def test_food_with_toxic_goods_is_incompatible(client):
    r = await plan(client, pallet(2, id="rice", dg=dg(food=True)), pallet(1, id="pest", dg=dg("6.1")))
    assert "DG_INCOMPATIBLE" in codes(r, "error")


async def test_the_same_product_on_two_lines_never_conflicts(client):
    r = await plan(client, pallet(2, id="a", dg=dg("3")), pallet(2, id="b", dg=dg("3")))
    assert "DG_INCOMPATIBLE" not in codes(r)


async def test_northline_refuses_goods_the_adg_allows(client):
    wet = pallet(1, id="wet", dg=dg("4.3", packing_group="II"))
    assert "DG_CARRIER_REFUSED" not in codes(await plan(client, wet))
    r = await plan(client, wet, rule_set="northline")
    assert not r["fits"] and "DG_CARRIER_REFUSED" in codes(r, "error")


async def test_invalid_dg_data_is_rejected(client):
    res = await client.post("/api/plan", json={"items": [pallet(1, dg=dg("3", subsidiary=["3"]))]})
    assert res.status_code == 422 and "same as the class" in res.text
