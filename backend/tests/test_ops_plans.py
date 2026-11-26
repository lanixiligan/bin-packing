"""Plans and loads: create (job), save draft, moves, lock, load assignment, discard."""

import dataclasses
import uuid
from datetime import timedelta

import pytest
from sqlalchemy import update
from sqlmodel import func, select

from app import workers
from app.models import Job, Order, OrderEvent, OrderStatus, Plan, UserRole, Vehicle
from tests.factories import make_address, make_vehicle
from tests.test_ops_setup import accepted_orders, create_plan, finish_job, make_world, save_draft


async def two_orders(session, customer, **kw):
    """Order A: 6 boxes (600 kg, units 0-5). Order B: 1 crate + 2 boxes (600 kg, units 6-8)."""
    world = await make_world(session, customer, **kw)
    orders = await accepted_orders(session, customer, world, [
        [(world.box, 6)],
        [(world.crate, 1), (world.box, 2)],
    ])
    return world, orders


async def drafted(client, session, dispatcher, customer):
    """A draft plan with load 1 = order A (600 kg) and load 2 = order B (600 kg)."""
    world, orders = await two_orders(session, customer)
    plan = await create_plan(client, dispatcher, world)
    await finish_job(session, plan["job_id"], [[0, 1, 2, 3, 4, 5], [6, 7, 8]])
    plan = await save_draft(client, dispatcher, plan["id"])
    return world, orders, plan


def line_of(order, item):
    return next(ln for ln in order.lines if ln.item_id == item.id)


def load_lines(load):
    return {ln["order_line_id"]: ln["quantity"] for ln in load["lines"]}


async def move(client, dispatcher, plan_id, **body):
    return await client.post(f"/api/ops/plans/{plan_id}/moves", headers=dispatcher.headers, json=body)


# ---- create ----------------------------------------------------------------------

async def test_create_plan_queues_a_job_and_reserves_the_orders(client, session, dispatcher, customer,
                                                                 enqueued):
    world, orders = await two_orders(session, customer)
    # Not part of the batch: not accepted, another date, an unzoned delivery address.
    await accepted_orders(session, customer, world, [[(world.box, 1)]], status=OrderStatus.submitted)
    later = dataclasses.replace(world, day=world.day + timedelta(days=1))
    await accepted_orders(session, customer, later, [[(world.box, 1)]])
    unzoned = await make_address(session, customer.company, label="Unzoned")
    await accepted_orders(session, customer, world, [[(world.box, 1)]], delivery=unzoned)

    plan = await create_plan(client, dispatcher, world)

    assert plan["status"] == "draft" and plan["zone"] == "NORTH"
    assert plan["job_status"] == "queued" and plan["loads"] == [] and plan["load_count"] == 0
    assert plan["order_ids"] == [o.id for o in orders] and plan["order_count"] == 2
    assert plan["vehicle"]["id"] == world.vehicle.id
    assert enqueued == [uuid.UUID(plan["job_id"])]

    job = await session.get(Job, uuid.UUID(plan["job_id"]))
    assert job.payload == {
        "plan_id": plan["id"], "order_ids": [o.id for o in orders],
        "capacity": {"weight_kg": 1000.0, "volume_m3": None, "pallets": None},
        "time_limit_s": 10.0,
    }
    assert job.created_by_id == dispatcher.user.id
    reserved = (await session.exec(select(Order.id).where(Order.plan_id == plan["id"]))).all()
    assert sorted(reserved) == [o.id for o in orders]


async def test_create_plan_accepts_a_lowercase_zone(client, session, dispatcher, customer):
    world, _ = await two_orders(session, customer)
    r = await client.post("/api/ops/plans", headers=dispatcher.headers, json={
        "delivery_date": world.day.isoformat(), "zone": "north", "vehicle_id": world.vehicle.id})
    assert r.status_code == 202 and r.json()["zone"] == "NORTH"


async def test_unit_bigger_than_the_vehicle_gives_infeasible_detail(client, session, dispatcher, customer,
                                                                    enqueued):
    world, orders = await two_orders(session, customer)
    small = await make_vehicle(session, name="Ute", registration="UTE1", max_weight_kg=300)
    r = await client.post("/api/ops/plans", headers=dispatcher.headers, json={
        "delivery_date": world.day.isoformat(), "zone": world.zone, "vehicle_id": small.id})
    assert r.status_code == 422
    detail = r.json()["detail"]
    assert "Ute" in detail["message"]
    assert len(detail["misfits"]) == 1
    misfit = detail["misfits"][0]
    assert misfit["order_id"] == orders[1].id
    assert misfit["order_line_id"] == line_of(orders[1], world.crate).id
    assert misfit["dimensions"] == ["weight"] and misfit["item_sku"] == "CRATE"
    assert "400 kg > 300 kg" in misfit["message"]
    assert enqueued == []
    assert (await session.exec(select(func.count()).select_from(Plan))).one() == 0
    assert (await session.exec(select(func.count()).select_from(Job))).one() == 0


async def test_no_orders_to_plan(client, session, dispatcher, customer):
    world = await make_world(session, customer)
    r = await client.post("/api/ops/plans", headers=dispatcher.headers, json={
        "delivery_date": world.day.isoformat(), "zone": world.zone, "vehicle_id": world.vehicle.id})
    assert r.status_code == 422
    assert r.json()["detail"] == (f"No accepted orders for {world.day.isoformat()} in NORTH "
                                  "that aren't already in a plan.")


async def test_unknown_zone_and_inactive_vehicle(client, session, dispatcher, customer):
    world, _ = await two_orders(session, customer)
    body = {"delivery_date": world.day.isoformat(), "zone": "MARS", "vehicle_id": world.vehicle.id}
    r = await client.post("/api/ops/plans", headers=dispatcher.headers, json=body)
    assert r.status_code == 422 and "MARS" in r.json()["detail"]

    body["zone"] = world.zone
    body["vehicle_id"] = 999
    assert (await client.post("/api/ops/plans", headers=dispatcher.headers, json=body)).status_code == 422

    await session.exec(update(Vehicle).where(Vehicle.id == world.vehicle.id).values(active=False))
    await session.commit()
    body["vehicle_id"] = world.vehicle.id
    r = await client.post("/api/ops/plans", headers=dispatcher.headers, json=body)
    assert r.status_code == 422 and "inactive" in r.json()["detail"]


async def test_second_plan_cannot_take_the_same_orders(client, session, dispatcher, customer):
    world, orders = await two_orders(session, customer)
    first = await create_plan(client, dispatcher, world)
    r = await client.post("/api/ops/plans", headers=dispatcher.headers, json={
        "delivery_date": world.day.isoformat(), "zone": world.zone, "vehicle_id": world.vehicle.id})
    assert r.status_code == 422

    # An order accepted later goes into a new plan on its own.
    late = (await accepted_orders(session, customer, world, [[(world.box, 1)]]))[0]
    second = await create_plan(client, dispatcher, world)
    assert second["order_ids"] == [late.id]
    assert first["order_ids"] == [o.id for o in orders]


async def test_enqueue_failure_rolls_everything_back(client, session, dispatcher, customer, monkeypatch):
    world, orders = await two_orders(session, customer)

    async def broken(job_id):
        raise ConnectionError("redis is down")

    monkeypatch.setattr(workers, "enqueue_solve", broken)
    r = await client.post("/api/ops/plans", headers=dispatcher.headers, json={
        "delivery_date": world.day.isoformat(), "zone": world.zone, "vehicle_id": world.vehicle.id})
    assert r.status_code == 503
    assert r.json()["detail"] == "The job queue is unavailable. Try again in a moment."
    assert (await session.exec(select(func.count()).select_from(Plan))).one() == 0
    assert (await session.exec(select(func.count()).select_from(Job))).one() == 0
    plan_ids = (await session.exec(select(Order.plan_id).execution_options(populate_existing=True))).all()
    assert plan_ids == [None, None]


async def test_list_and_get_plans(client, session, dispatcher, customer):
    world, _ = await two_orders(session, customer)
    plan = await create_plan(client, dispatcher, world)
    r = await client.get("/api/ops/plans", headers=dispatcher.headers,
                         params={"delivery_date": world.day.isoformat(), "zone": "north"})
    assert [p["id"] for p in r.json()] == [plan["id"]]
    assert r.json()[0]["order_count"] == 2 and r.json()[0]["job_status"] == "queued"
    r = await client.get("/api/ops/plans", headers=dispatcher.headers, params={"status": "locked"})
    assert r.json() == []
    assert (await client.get(f"/api/ops/plans/{plan['id']}", headers=dispatcher.headers)).json() == plan
    assert (await client.get("/api/ops/plans/999", headers=dispatcher.headers)).status_code == 404


# ---- save draft ------------------------------------------------------------------

async def test_save_draft_writes_loads_from_the_result(client, session, dispatcher, customer):
    world, orders, plan = await drafted(client, session, dispatcher, customer)
    assert plan["method"] == "ortools" and plan["job_status"] == "succeeded"
    l1, l2 = plan["loads"]
    assert (l1["number"], l2["number"]) == (1, 2)
    assert load_lines(l1) == {line_of(orders[0], world.box).id: 6}
    assert load_lines(l2) == {line_of(orders[1], world.crate).id: 1, line_of(orders[1], world.box).id: 2}
    assert l1["usage"] == {"weight_kg": 600.0, "volume_m3": 3.0, "pallets": 0.0}
    assert l2["usage"] == {"weight_kg": 600.0, "volume_m3": 2.0, "pallets": 1.0}
    assert l1["capacity"] == {"weight_kg": 1000.0, "volume_m3": None, "pallets": None}
    assert l1["fill_percent"] == {"weight": 60.0, "volume": None, "pallets": None}
    assert l1["over_capacity"] is False and l1["vehicle"] is None and l1["driver"] is None
    crate_line = next(ln for ln in l2["lines"] if ln["item_sku"] == "CRATE")
    assert crate_line["order_reference"] == orders[1].reference
    assert crate_line["company_name"] == "Acme Pty Ltd" and crate_line["line_quantity"] == 1


async def test_save_draft_again_replaces_the_loads(client, session, dispatcher, customer):
    world, orders, plan = await drafted(client, session, dispatcher, customer)
    old_ids = {ld["id"] for ld in plan["loads"]}
    await finish_job(session, plan["job_id"], [[0, 1, 2, 3, 6], [4, 5, 7, 8]])
    again = await save_draft(client, dispatcher, plan["id"], "ffd")
    assert again["method"] == "ffd" and len(again["loads"]) == 2
    assert not old_ids & {ld["id"] for ld in again["loads"]}
    assert load_lines(again["loads"][0]) == {line_of(orders[0], world.box).id: 4,
                                             line_of(orders[1], world.crate).id: 1}


async def test_save_draft_needs_a_finished_job(client, session, dispatcher, customer):
    world, _ = await two_orders(session, customer)
    plan = await create_plan(client, dispatcher, world)
    r = await client.post(f"/api/ops/plans/{plan['id']}/draft", headers=dispatcher.headers, json={})
    assert r.status_code == 409


async def test_save_draft_without_an_ortools_solution(client, session, dispatcher, customer):
    world, _ = await two_orders(session, customer)
    plan = await create_plan(client, dispatcher, world)
    await finish_job(session, plan["job_id"], ortools=False)
    r = await client.post(f"/api/ops/plans/{plan['id']}/draft", headers=dispatcher.headers,
                          json={"method": "ortools"})
    assert r.status_code == 409
    assert (await save_draft(client, dispatcher, plan["id"], "ffd"))["method"] == "ffd"


async def test_save_draft_rejects_a_result_that_does_not_match_the_orders(client, session, dispatcher,
                                                                          customer):
    world, _ = await two_orders(session, customer)
    plan = await create_plan(client, dispatcher, world)
    await finish_job(session, plan["job_id"], [[0, 1, 2], [3, 4]])  # units 5-8 missing
    r = await client.post(f"/api/ops/plans/{plan['id']}/draft", headers=dispatcher.headers, json={})
    assert r.status_code == 409 and "changed" in r.json()["detail"]


# ---- moves ---------------------------------------------------------------------------

async def test_move_within_capacity_merges_into_the_target(client, session, dispatcher, customer):
    world, orders, plan = await drafted(client, session, dispatcher, customer)
    l1, l2 = plan["loads"]
    box_b = line_of(orders[1], world.box).id
    r = await move(client, dispatcher, plan["id"], order_line_id=box_b, from_load_id=l2["id"],
                   to_load_id=l1["id"], quantity=1)
    assert r.status_code == 200, r.text
    n1, n2 = r.json()["loads"]
    assert load_lines(n1) == {line_of(orders[0], world.box).id: 6, box_b: 1}
    assert load_lines(n2)[box_b] == 1
    assert n1["usage"]["weight_kg"] == 700.0 and n2["usage"]["weight_kg"] == 500.0

    # The rest of the same line merges into the existing assignment.
    r = await move(client, dispatcher, plan["id"], order_line_id=box_b, from_load_id=l2["id"],
                   to_load_id=l1["id"])
    n1, n2 = r.json()["loads"]
    assert load_lines(n1)[box_b] == 2 and box_b not in load_lines(n2)
    assert len([ln for ln in n1["lines"] if ln["order_line_id"] == box_b]) == 1


async def test_move_over_capacity_is_rejected(client, session, dispatcher, customer):
    world, orders, plan = await drafted(client, session, dispatcher, customer)
    l1, l2 = plan["loads"]
    r = await move(client, dispatcher, plan["id"], order_line_id=line_of(orders[0], world.box).id,
                   from_load_id=l1["id"], to_load_id=l2["id"])
    assert r.status_code == 422
    assert r.json()["detail"] == "Load 2 would carry 1,200 kg of 1,000 kg."
    unchanged = (await client.get(f"/api/ops/plans/{plan['id']}", headers=dispatcher.headers)).json()
    assert unchanged["loads"] == plan["loads"]


async def test_move_checks_the_assigned_vehicle_of_the_target(client, session, dispatcher, customer):
    world, orders, plan = await drafted(client, session, dispatcher, customer)
    l1, l2 = plan["loads"]
    big = await make_vehicle(session, name="Semi", registration="SEMI1", max_weight_kg=2000)
    r = await client.patch(f"/api/ops/loads/{l2['id']}", headers=dispatcher.headers,
                           json={"vehicle_id": big.id})
    assert r.status_code == 200
    r = await move(client, dispatcher, plan["id"], order_line_id=line_of(orders[0], world.box).id,
                   from_load_id=l1["id"], to_load_id=l2["id"])
    assert r.status_code == 200
    (only,) = r.json()["loads"]
    assert only["number"] == 1 and only["usage"]["weight_kg"] == 1200.0 and not only["over_capacity"]


async def test_move_to_a_new_load(client, session, dispatcher, customer):
    world, orders, plan = await drafted(client, session, dispatcher, customer)
    l1, _ = plan["loads"]
    box_a = line_of(orders[0], world.box).id
    r = await move(client, dispatcher, plan["id"], order_line_id=box_a, from_load_id=l1["id"],
                   to_load_id=None, quantity=2)
    assert r.status_code == 200
    loads = r.json()["loads"]
    assert [ld["number"] for ld in loads] == [1, 2, 3]
    assert load_lines(loads[0]) == {box_a: 4} and load_lines(loads[2]) == {box_a: 2}
    assert loads[2]["capacity"]["weight_kg"] == 1000.0


async def test_emptied_load_is_removed_and_loads_renumbered(client, session, dispatcher, customer):
    world, orders, plan = await drafted(client, session, dispatcher, customer)
    l1, l2 = plan["loads"]
    box_b = line_of(orders[1], world.box).id
    crate = line_of(orders[1], world.crate).id
    r = await move(client, dispatcher, plan["id"], order_line_id=box_b, from_load_id=l2["id"])
    l3 = r.json()["loads"][2]
    r = await move(client, dispatcher, plan["id"], order_line_id=crate, from_load_id=l2["id"],
                   to_load_id=l1["id"])
    assert r.status_code == 200, r.text
    loads = r.json()["loads"]
    assert [(ld["id"], ld["number"]) for ld in loads] == [(l1["id"], 1), (l3["id"], 2)]
    assert loads[0]["usage"]["weight_kg"] == 1000.0 and loads[0]["fill_percent"]["weight"] == 100.0
    assert r.json()["load_count"] == 2


async def test_move_validation(client, session, dispatcher, customer):
    world, orders, plan = await drafted(client, session, dispatcher, customer)
    l1, l2 = plan["loads"]
    box_a = line_of(orders[0], world.box).id
    assert (await move(client, dispatcher, plan["id"], order_line_id=box_a, from_load_id=l1["id"],
                       to_load_id=l2["id"], quantity=7)).status_code == 422
    assert (await move(client, dispatcher, plan["id"], order_line_id=box_a, from_load_id=l2["id"],
                       to_load_id=l1["id"])).status_code == 422
    assert (await move(client, dispatcher, plan["id"], order_line_id=box_a, from_load_id=999,
                       to_load_id=l1["id"])).status_code == 404
    assert (await move(client, dispatcher, plan["id"], order_line_id=box_a, from_load_id=l1["id"],
                       to_load_id=999)).status_code == 404
    assert (await move(client, dispatcher, plan["id"], order_line_id=box_a, from_load_id=l1["id"],
                       to_load_id=l1["id"])).status_code == 422
    assert (await move(client, dispatcher, plan["id"], order_line_id=box_a, from_load_id=l1["id"],
                       quantity=0)).status_code == 422
    assert (await move(client, dispatcher, 999, order_line_id=box_a,
                       from_load_id=l1["id"])).status_code == 404


# ---- lock ----------------------------------------------------------------------------

async def test_lock_moves_orders_to_planned_and_freezes_the_plan(client, session, dispatcher, customer):
    world, orders, plan = await drafted(client, session, dispatcher, customer)
    r = await client.post(f"/api/ops/plans/{plan['id']}/lock", headers=dispatcher.headers)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "locked" and r.json()["locked_at"] is not None

    for order in orders:
        fresh = await session.get(Order, order.id, populate_existing=True)
        assert fresh.status == OrderStatus.planned
        last = fresh.events[-1]
        assert (last.from_status, last.to_status) == (OrderStatus.accepted, OrderStatus.planned)
        assert last.actor_id == dispatcher.user.id

    l1, l2 = plan["loads"]
    r = await move(client, dispatcher, plan["id"], order_line_id=line_of(orders[1], world.box).id,
                   from_load_id=l2["id"], to_load_id=l1["id"])
    assert r.status_code == 409
    assert (await client.post(f"/api/ops/plans/{plan['id']}/draft", headers=dispatcher.headers,
                              json={})).status_code == 409
    assert (await client.post(f"/api/ops/plans/{plan['id']}/lock",
                              headers=dispatcher.headers)).status_code == 409
    assert (await client.delete(f"/api/ops/plans/{plan['id']}",
                                headers=dispatcher.headers)).status_code == 409


async def test_lock_needs_loads(client, session, dispatcher, customer):
    world, _ = await two_orders(session, customer)
    plan = await create_plan(client, dispatcher, world)
    r = await client.post(f"/api/ops/plans/{plan['id']}/lock", headers=dispatcher.headers)
    assert r.status_code == 409


async def test_lock_blocked_when_a_load_is_over_capacity(client, session, dispatcher, customer):
    world, orders = await two_orders(session, customer)
    plan = await create_plan(client, dispatcher, world)
    await finish_job(session, plan["job_id"])  # everything on one 1,200 kg load
    plan = await save_draft(client, dispatcher, plan["id"])
    assert plan["loads"][0]["over_capacity"] is True
    assert plan["loads"][0]["fill_percent"]["weight"] == 120.0
    r = await client.post(f"/api/ops/plans/{plan['id']}/lock", headers=dispatcher.headers)
    assert r.status_code == 409
    assert r.json()["detail"] == "Load 1 is over capacity: it carries 1,200 kg of 1,000 kg."
    fresh = await session.get(Order, orders[0].id, populate_existing=True)
    assert fresh.status == OrderStatus.accepted


async def test_lock_blocked_when_an_order_is_no_longer_accepted(client, session, dispatcher, customer):
    world, orders, plan = await drafted(client, session, dispatcher, customer)
    # Test setup only: force a status that the plan can't lock with.
    await session.exec(update(Order).where(Order.id == orders[1].id).values(status=OrderStatus.rejected))
    await session.commit()
    r = await client.post(f"/api/ops/plans/{plan['id']}/lock", headers=dispatcher.headers)
    assert r.status_code == 409 and orders[1].reference in r.json()["detail"]
    fresh = await session.get(Order, orders[0].id, populate_existing=True)
    assert fresh.status == OrderStatus.accepted
    events = (await session.exec(select(func.count()).select_from(OrderEvent)
                                 .where(OrderEvent.to_status == OrderStatus.planned))).one()
    assert events == 0
    assert (await client.get(f"/api/ops/plans/{plan['id']}",
                             headers=dispatcher.headers)).json()["status"] == "draft"


# ---- loads ----------------------------------------------------------------------------

async def test_load_vehicle_assignment_is_revalidated(client, session, dispatcher, customer):
    _, _, plan = await drafted(client, session, dispatcher, customer)
    l1 = plan["loads"][0]
    small = await make_vehicle(session, name="Ute", registration="UTE1", max_weight_kg=500)
    big = await make_vehicle(session, name="Van", registration="VAN1", max_weight_kg=800, max_volume_m3=10)
    off = await make_vehicle(session, name="Old", registration="OLD1", max_weight_kg=5000)
    off.active = False
    session.add(off)
    await session.commit()
    url = f"/api/ops/loads/{l1['id']}"

    r = await client.patch(url, headers=dispatcher.headers, json={"vehicle_id": small.id})
    assert r.status_code == 422
    assert r.json()["detail"] == "Load 1 doesn't fit Ute: it carries 600 kg of 500 kg."
    assert (await client.patch(url, headers=dispatcher.headers,
                               json={"vehicle_id": off.id})).status_code == 422
    assert (await client.patch(url, headers=dispatcher.headers,
                               json={"vehicle_id": 999})).status_code == 422

    r = await client.patch(url, headers=dispatcher.headers, json={"vehicle_id": big.id})
    assert r.status_code == 200
    body = r.json()
    assert body["vehicle"]["id"] == big.id
    assert body["capacity"] == {"weight_kg": 800.0, "volume_m3": 10.0, "pallets": None}
    assert body["fill_percent"] == {"weight": 75.0, "volume": 30.0, "pallets": None}

    # Clearing falls back to the plan's profile vehicle.
    r = await client.patch(url, headers=dispatcher.headers, json={"vehicle_id": None})
    assert r.status_code == 200 and r.json()["vehicle"] is None
    assert r.json()["capacity"]["weight_kg"] == 1000.0


async def test_load_driver_assignment(client, session, dispatcher, customer, driver, make_actor):
    _, _, plan = await drafted(client, session, dispatcher, customer)
    big = await make_vehicle(session, name="Van", registration="VAN1", max_weight_kg=800)
    url = f"/api/ops/loads/{plan['loads'][0]['id']}"
    r = await client.patch(url, headers=dispatcher.headers,
                           json={"vehicle_id": big.id, "driver_id": driver.driver.id})
    assert r.status_code == 200
    assert r.json()["driver"]["id"] == driver.driver.id
    assert r.json()["driver"]["email"] == driver.user.email

    # Omitted fields don't change; null clears.
    r = await client.patch(url, headers=dispatcher.headers, json={"driver_id": None})
    assert r.json()["driver"] is None and r.json()["vehicle"]["id"] == big.id

    assert (await client.patch(url, headers=dispatcher.headers,
                               json={"driver_id": 999})).status_code == 422
    other = await make_actor(UserRole.driver)
    other.driver.active = False
    session.add(other.driver)
    await session.commit()
    assert (await client.patch(url, headers=dispatcher.headers,
                               json={"driver_id": other.driver.id})).status_code == 422
    assert (await client.patch("/api/ops/loads/999", headers=dispatcher.headers,
                               json={"driver_id": None})).status_code == 404


async def test_loads_can_be_assigned_after_locking(client, session, dispatcher, customer, driver):
    _, _, plan = await drafted(client, session, dispatcher, customer)
    await client.post(f"/api/ops/plans/{plan['id']}/lock", headers=dispatcher.headers)
    r = await client.patch(f"/api/ops/loads/{plan['loads'][1]['id']}", headers=dispatcher.headers,
                           json={"driver_id": driver.driver.id})
    assert r.status_code == 200 and r.json()["driver"]["id"] == driver.driver.id


# ---- discard -------------------------------------------------------------------------------

async def test_discard_releases_the_orders(client, session, dispatcher, customer):
    world, orders, plan = await drafted(client, session, dispatcher, customer)
    r = await client.delete(f"/api/ops/plans/{plan['id']}", headers=dispatcher.headers)
    assert r.status_code == 204
    assert (await client.get(f"/api/ops/plans/{plan['id']}", headers=dispatcher.headers)).status_code == 404
    plan_ids = (await session.exec(select(Order.plan_id).execution_options(populate_existing=True))).all()
    assert plan_ids == [None, None]
    again = await create_plan(client, dispatcher, world)
    assert again["order_ids"] == [o.id for o in orders]
    assert (await client.delete("/api/ops/plans/999", headers=dispatcher.headers)).status_code == 404


# ---- roles ---------------------------------------------------------------------------------

OPS_ROUTES = [
    ("GET", "/api/ops/orders"), ("GET", "/api/ops/orders/1"), ("POST", "/api/ops/orders/1/accept"),
    ("POST", "/api/ops/orders/1/reject"), ("GET", "/api/ops/batches"), ("GET", "/api/ops/zones"),
    ("POST", "/api/ops/zones"), ("PATCH", "/api/ops/zones/X"), ("GET", "/api/ops/addresses"),
    ("PATCH", "/api/ops/addresses/1"), ("GET", "/api/ops/vehicles"), ("POST", "/api/ops/vehicles"),
    ("PATCH", "/api/ops/vehicles/1"), ("GET", "/api/ops/drivers"), ("POST", "/api/ops/drivers"),
    ("PATCH", "/api/ops/drivers/1"), ("POST", "/api/ops/plans"), ("GET", "/api/ops/plans"),
    ("GET", "/api/ops/plans/1"), ("DELETE", "/api/ops/plans/1"), ("POST", "/api/ops/plans/1/draft"),
    ("POST", "/api/ops/plans/1/moves"), ("POST", "/api/ops/plans/1/lock"), ("PATCH", "/api/ops/loads/1"),
    ("PATCH", "/api/ops/order-lines/1"),
    ("GET", "/api/ops/invoices?month=2026-11"), ("GET", "/api/ops/invoices/1?month=2026-11"),
    ("GET", "/api/ops/invoices/1/csv?month=2026-11"),
]


def test_role_check_list_covers_every_ops_route():
    from app.main import app
    paths = {(m.upper(), p) for p, ops in app.openapi()["paths"].items() if p.startswith("/api/ops/")
             for m in ops}
    listed = {(m, p.split("?")[0]) for m, p in OPS_ROUTES}
    assert len(paths) == len(listed) == len(OPS_ROUTES)


@pytest.mark.parametrize(("method", "path"), OPS_ROUTES)
async def test_ops_routes_need_a_dispatcher(client, customer, driver, method, path):
    assert (await client.request(method, path)).status_code == 401
    assert (await client.request(method, path, headers=customer.headers)).status_code == 403
    assert (await client.request(method, path, headers=driver.headers)).status_code == 403
