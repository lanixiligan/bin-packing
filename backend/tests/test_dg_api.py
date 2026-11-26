"""Dangerous goods through the API: item DG data, order warnings, plan segregation,
the Northline rule set and HSEQ approvals."""

import uuid

from sqlmodel import select

from app.models import Job, OrderLine
from tests.factories import make_item
from tests.test_ops_setup import accepted_orders, create_plan, finish_job, make_world, save_draft

ITEMS = "/api/portal/items"
THINNERS = {"dg_class": "3", "packing_group": "II", "un_number": "1263", "t92": []}
CHLORINE = {"dg_class": "5.1", "packing_group": "II", "un_number": "2880",
            "t92": ["calcium_hypochlorite", "hypochlorite"]}


# ---- Portal: items and orders ---------------------------------------------------------------

async def test_item_dg_round_trip_and_clear(client, customer):
    r = await client.post(ITEMS, headers=customer.headers, json={
        "sku": "THIN", "name": "Thinners", "weight_kg": 18, "dg": {**THINNERS, "subsidiary": ["6.1"]}})
    assert r.status_code == 201, r.text
    item = r.json()
    assert item["dg"]["dg_class"] == "3" and item["dg"]["subsidiary"] == ["6.1"]
    assert item["dg"]["container"] == "package" and item["dg"]["food"] is False

    r = await client.patch(f"{ITEMS}/{item['id']}", headers=customer.headers, json={"name": "Thinners 20 L"})
    assert r.json()["dg"]["dg_class"] == "3"  # untouched
    r = await client.patch(f"{ITEMS}/{item['id']}", headers=customer.headers, json={"dg": None})
    assert r.status_code == 200 and r.json()["dg"] is None
    # A DgInfo with nothing set is stored as general freight too.
    r = await client.patch(f"{ITEMS}/{item['id']}", headers=customer.headers, json={"dg": {}})
    assert r.json()["dg"] is None
    r = await client.patch(f"{ITEMS}/{item['id']}", headers=customer.headers, json={"dg": {"food": True}})
    assert r.json()["dg"]["food"] is True


async def test_item_dg_validation(client, customer):
    for dg in ({"dg_class": "1"}, {"dg_class": "3", "food": True}, {"dg_class": "8", "t92": ["bogus"]},
               {"dg_class": "2.1", "packing_group": "II"}, {"dg_class": "3", "unknown": 1}):
        r = await client.post(ITEMS, headers=customer.headers,
                              json={"sku": "X", "name": "X", "weight_kg": 1, "dg": dg})
        assert r.status_code == 422, dg


async def test_order_lines_snapshot_dg_and_warn(client, session, customer):
    world = await make_world(session, customer)
    thin = await make_item(session, customer.company, sku="THIN", weight_kg=18, dg=THINNERS)
    chlor = await make_item(session, customer.company, sku="CHLOR", weight_kg=10, dg=CHLORINE)
    r = await client.post("/api/portal/orders", headers=customer.headers, json={
        "pickup_address_id": world.pickup.id, "delivery_address_id": world.delivery.id,
        "delivery_date": world.day.isoformat(),
        "lines": [{"item_id": thin.id, "quantity": 2}, {"item_id": chlor.id, "quantity": 1},
                  {"item_id": world.box.id, "quantity": 1}],
    })
    assert r.status_code == 201, r.text
    order = r.json()
    assert [ln["dg"] and ln["dg"]["dg_class"] for ln in order["lines"]] == ["3", "5.1", None]
    (conflict,) = order["dg_conflicts"]
    assert conflict["status"] == "incompatible"
    assert conflict["items"] == ["Item THIN (Class 3)", "Item CHLOR (Class 5.1)"]
    assert "can't travel on the same vehicle" in conflict["message"]

    # Later catalogue edits don't change the snapshot.
    await client.patch(f"{ITEMS}/{chlor.id}", headers=customer.headers, json={"dg": None})
    order = (await client.get(f"/api/portal/orders/{order['id']}", headers=customer.headers)).json()
    assert order["lines"][1]["dg"]["dg_class"] == "5.1" and len(order["dg_conflicts"]) == 1


# ---- Ops: plans -----------------------------------------------------------------------------

async def _dg_world(session, customer):
    world = await make_world(session, customer)
    thin = await make_item(session, customer.company, sku="THIN", weight_kg=18, dg=THINNERS)
    chlor = await make_item(session, customer.company, sku="CHLOR", weight_kg=10, dg=CHLORINE)
    return world, thin, chlor


async def test_lock_is_blocked_by_incompatible_goods_on_a_load(client, session, dispatcher, customer):
    world, thin, chlor = await _dg_world(session, customer)
    await accepted_orders(session, customer, world, [[(thin, 1)], [(chlor, 1)]])
    plan = await create_plan(client, dispatcher, world)
    assert plan["rule_set"] == "adg"
    await finish_job(session, plan["job_id"])  # handcrafted: everything on one load
    plan = await save_draft(client, dispatcher, plan["id"])
    (load,) = plan["loads"]
    assert len(load["dg_conflicts"]) == 1 and load["dg_conflicts"][0]["status"] == "incompatible"
    assert {ln["dg"]["dg_class"] for ln in load["lines"]} == {"3", "5.1"}

    r = await client.post(f"/api/ops/plans/{plan['id']}/lock", headers=dispatcher.headers)
    assert r.status_code == 409 and "can't travel together" in r.json()["detail"]

    # Move the chlorine to a new load: now it locks.
    chlor_line = next(ln for ln in load["lines"] if ln["item_sku"] == "CHLOR")
    r = await client.post(f"/api/ops/plans/{plan['id']}/moves", headers=dispatcher.headers,
                          json={"order_line_id": chlor_line["order_line_id"], "from_load_id": load["id"]})
    assert r.status_code == 200, r.text
    assert all(not ld["dg_conflicts"] for ld in r.json()["loads"])
    r = await client.post(f"/api/ops/plans/{plan['id']}/lock", headers=dispatcher.headers)
    assert r.status_code == 200, r.text


async def test_move_onto_incompatible_load_is_refused(client, session, dispatcher, customer):
    world, thin, chlor = await _dg_world(session, customer)
    await accepted_orders(session, customer, world, [[(thin, 1)], [(chlor, 1)]])
    plan = await create_plan(client, dispatcher, world)
    await finish_job(session, plan["job_id"], [[0], [1]])
    plan = await save_draft(client, dispatcher, plan["id"])
    first, second = plan["loads"]
    line = first["lines"][0]
    r = await client.post(f"/api/ops/plans/{plan['id']}/moves", headers=dispatcher.headers,
                          json={"order_line_id": line["order_line_id"], "from_load_id": first["id"],
                                "to_load_id": second["id"]})
    assert r.status_code == 422
    detail = r.json()["detail"]
    assert detail.startswith("Load 2 can't take these units") and "Class 5.1" in detail
    assert "Class 3" in detail


async def test_solver_job_keeps_dg_apart(client, session, dispatcher, customer):
    """The real worker path: units carry the line's DG data into the solver."""
    from app.workers import run_solve
    world, thin, chlor = await _dg_world(session, customer)
    await accepted_orders(session, customer, world, [[(thin, 2), (chlor, 2)]])
    plan = await create_plan(client, dispatcher, world)
    await run_solve({}, plan["job_id"])
    job = await session.get(Job, uuid.UUID(plan["job_id"]), populate_existing=True)
    assert job.status == "succeeded", job.error
    assert job.result["ortools"]["num_loads"] == 2 and job.result["lower_bound"] == 1
    plan = await save_draft(client, dispatcher, plan["id"])
    assert all(not ld["dg_conflicts"] for ld in plan["loads"])


async def test_northline_rejects_prohibited_goods(client, session, dispatcher, customer):
    world = await make_world(session, customer)
    wet = await make_item(session, customer.company, sku="NA", name="Sodium", weight_kg=5,
                          dg={"dg_class": "4.3", "packing_group": "II"})
    solid = await make_item(session, customer.company, sku="MATCH", name="Matches", weight_kg=30,
                            dg={"dg_class": "4.1", "packing_group": "III"})
    await accepted_orders(session, customer, world, [[(wet, 1), (world.box, 1)], [(solid, 2)]])
    body = {"delivery_date": world.day.isoformat(), "zone": world.zone, "vehicle_id": world.vehicle.id,
            "rule_set": "northline"}
    r = await client.post("/api/ops/plans", headers=dispatcher.headers, json=body)
    assert r.status_code == 422, r.text
    detail = r.json()["detail"]
    assert detail["misfits"] == [] and "Northline won't accept 2" in detail["message"]
    kinds = sorted((i["kind"], i["item_name"]) for i in detail["dg_issues"])
    assert kinds == [("limit", None), ("prohibited", "Sodium")]

    # The ADG rule set plans the same orders.
    r = await client.post("/api/ops/plans", headers=dispatcher.headers, json={**body, "rule_set": "adg"})
    assert r.status_code == 202, r.text


async def test_northline_approval_blocks_lock_until_recorded(client, session, dispatcher, customer):
    world = await make_world(session, customer)
    gas = await make_item(session, customer.company, sku="NH3", name="Ammonia", weight_kg=40,
                          dg={"dg_class": "2.3", "container": "cylinder"})
    await accepted_orders(session, customer, world, [[(gas, 1)]])
    r = await client.post("/api/ops/plans", headers=dispatcher.headers, json={
        "delivery_date": world.day.isoformat(), "zone": world.zone, "vehicle_id": world.vehicle.id,
        "rule_set": "northline"})
    assert r.status_code == 202, r.text
    plan = r.json()
    assert plan["rule_set"] == "northline"
    await finish_job(session, plan["job_id"])
    plan = await save_draft(client, dispatcher, plan["id"])
    (load,) = plan["loads"]
    (line,) = load["lines"]
    assert line["dg_approval_required"] is True and line["dg_approval_ref"] is None
    assert load["approvals_missing"] == 1
    assert any("steel cage" in w for w in load["dg_warnings"])

    r = await client.post(f"/api/ops/plans/{plan['id']}/lock", headers=dispatcher.headers)
    assert r.status_code == 409 and "HSEQ approval" in r.json()["detail"]

    url = f"/api/ops/order-lines/{line['order_line_id']}"
    r = await client.patch(url, headers=dispatcher.headers, json={"dg_approval_ref": "  HSEQ-2026-114 "})
    assert r.status_code == 200 and r.json()["dg_approval_ref"] == "HSEQ-2026-114"
    r = await client.post(f"/api/ops/plans/{plan['id']}/lock", headers=dispatcher.headers)
    assert r.status_code == 200, r.text
    assert r.json()["loads"][0]["approvals_missing"] == 0
    row = (await session.exec(select(OrderLine).where(OrderLine.id == line["order_line_id"])
                              .execution_options(populate_existing=True))).one()
    assert row.dg_approval_ref == "HSEQ-2026-114"


async def test_approval_endpoint_checks(client, session, dispatcher, customer):
    world = await make_world(session, customer)
    (order,) = await accepted_orders(session, customer, world, [[(world.box, 1)]],
                                     status="delivered")
    line_id = order.lines[0].id
    r = await client.patch(f"/api/ops/order-lines/{line_id}", headers=dispatcher.headers,
                           json={"dg_approval_ref": "X"})
    assert r.status_code == 409
    r = await client.patch("/api/ops/order-lines/999999", headers=dispatcher.headers,
                           json={"dg_approval_ref": "X"})
    assert r.status_code == 404
    r = await client.patch(f"/api/ops/order-lines/{line_id}", headers=customer.headers,
                           json={"dg_approval_ref": "X"})
    assert r.status_code == 403
