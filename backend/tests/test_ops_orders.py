"""Dispatcher order queue, accept / reject, and batches."""

import dataclasses
from datetime import timedelta

from app.models import Order, OrderStatus
from tests.factories import make_address, make_zone
from tests.test_ops_setup import accepted_orders, create_plan, make_world


async def queue(client, dispatcher, **params):
    r = await client.get("/api/ops/orders", headers=dispatcher.headers, params=params)
    assert r.status_code == 200, r.text
    return [o["id"] for o in r.json()]


async def test_queue_never_shows_drafts_and_filters(client, session, dispatcher, customer, other_customer):
    world = await make_world(session, customer)
    later = dataclasses.replace(world, day=world.day + timedelta(days=1))
    unzoned = await make_address(session, customer.company, label="Unzoned")
    draft, = await accepted_orders(session, customer, world, [[(world.box, 1)]], status=OrderStatus.draft)
    sub, = await accepted_orders(session, customer, later, [[(world.box, 1)]], status=OrderStatus.submitted)
    acc, = await accepted_orders(session, customer, world, [[(world.box, 2)]])
    unz, = await accepted_orders(session, customer, world, [[(world.box, 1)]], delivery=unzoned,
                                 status=OrderStatus.submitted)
    other_pick = await make_address(session, other_customer.company, label="Their depot")
    other_drop = await make_address(session, other_customer.company, label="Their shop", zone="NORTH")
    other_world = dataclasses.replace(world, pickup=other_pick, delivery=other_drop)
    theirs, = await accepted_orders(session, other_customer, other_world, [[(world.box, 1)]])

    # Sorted by delivery date, then id; drafts never appear.
    assert await queue(client, dispatcher) == [acc.id, unz.id, theirs.id, sub.id]
    assert await queue(client, dispatcher, status=["submitted"]) == [unz.id, sub.id]
    assert await queue(client, dispatcher, status=["submitted", "accepted"]) == [acc.id, unz.id, theirs.id,
                                                                                 sub.id]
    assert await queue(client, dispatcher, status=["draft"]) == []
    assert await queue(client, dispatcher, delivery_date=later.day.isoformat()) == [sub.id]
    assert await queue(client, dispatcher, zone="north") == [acc.id, theirs.id, sub.id]
    assert await queue(client, dispatcher, zone="none") == [unz.id]
    assert await queue(client, dispatcher, company_id=other_customer.company.id) == [theirs.id]
    assert await queue(client, dispatcher, limit=2, offset=1) == [unz.id, theirs.id]

    r = await client.get("/api/ops/orders", headers=dispatcher.headers, params={"zone": "north"})
    row = r.json()[0]
    assert row["company_name"] == "Acme Pty Ltd" and row["zone"] == "NORTH" and row["amount"] == "100.00"
    assert draft.id not in await queue(client, dispatcher, limit=500)


async def test_order_detail_hides_drafts(client, session, dispatcher, customer):
    world = await make_world(session, customer)
    draft, sub = await accepted_orders(session, customer, world, [[(world.box, 1)], [(world.box, 1)]],
                                       status=OrderStatus.draft)
    assert (await client.get(f"/api/ops/orders/{draft.id}", headers=dispatcher.headers)).status_code == 404
    assert (await client.get("/api/ops/orders/999", headers=dispatcher.headers)).status_code == 404


async def test_accept_and_reject(client, session, dispatcher, customer):
    world = await make_world(session, customer)
    a, b, c = await accepted_orders(session, customer, world, [[(world.box, 1)]] * 3,
                                    status=OrderStatus.submitted)

    r = await client.post(f"/api/ops/orders/{a.id}/accept", headers=dispatcher.headers)
    assert r.status_code == 200 and r.json()["status"] == "accepted"
    event = r.json()["events"][-1]
    assert event["to_status"] == "accepted" and event["actor_role"] == "dispatcher"

    r = await client.post(f"/api/ops/orders/{c.id}/accept", headers=dispatcher.headers,
                          json={"note": "Looks good"})
    assert r.json()["events"][-1]["note"] == "Looks good"

    r = await client.post(f"/api/ops/orders/{b.id}/reject", headers=dispatcher.headers,
                          json={"note": "We don't deliver there"})
    assert r.status_code == 200 and r.json()["status"] == "rejected"
    assert r.json()["events"][-1]["note"] == "We don't deliver there"

    # A rejection needs a reason; final / wrong states give 409.
    assert (await client.post(f"/api/ops/orders/{a.id}/reject", headers=dispatcher.headers,
                              json={})).status_code == 422
    assert (await client.post(f"/api/ops/orders/{a.id}/reject", headers=dispatcher.headers,
                              json={"note": "   "})).status_code == 422
    for order_id, expected in ((b.id, 409), (a.id, 409), (999, 404)):
        r = await client.post(f"/api/ops/orders/{order_id}/accept", headers=dispatcher.headers)
        assert r.status_code == expected


async def test_accepting_a_draft_is_not_found(client, session, dispatcher, customer):
    world = await make_world(session, customer)
    draft, = await accepted_orders(session, customer, world, [[(world.box, 1)]], status=OrderStatus.draft)
    r = await client.post(f"/api/ops/orders/{draft.id}/accept", headers=dispatcher.headers)
    assert r.status_code == 404
    assert (await session.get(Order, draft.id, populate_existing=True)).status == OrderStatus.draft


async def test_batches_group_by_date_and_zone(client, session, dispatcher, customer):
    world = await make_world(session, customer)
    await make_zone(session, "SOUTH", name="South side")
    south = await make_address(session, customer.company, label="South shop", zone="SOUTH")
    unzoned = await make_address(session, customer.company, label="Unzoned")
    later = dataclasses.replace(world, day=world.day + timedelta(days=1))

    planned = await accepted_orders(session, customer, world, [[(world.box, 2)], [(world.crate, 1)]])
    plan = await create_plan(client, dispatcher, world)
    await accepted_orders(session, customer, world, [[(world.box, 3)], [(world.crate, 2)]])  # unplanned
    await accepted_orders(session, customer, world, [[(world.box, 1)]], delivery=south)
    await accepted_orders(session, customer, world, [[(world.box, 1)]], delivery=unzoned)
    await accepted_orders(session, customer, later, [[(world.box, 1)]])
    await accepted_orders(session, customer, world, [[(world.box, 9)]], status=OrderStatus.submitted)

    r = await client.get("/api/ops/batches", headers=dispatcher.headers)
    rows = {(b["delivery_date"], b["zone"]): b for b in r.json()}
    day, nxt = world.day.isoformat(), later.day.isoformat()
    assert list(rows) == [(day, "NORTH"), (day, "SOUTH"), (day, None), (nxt, "NORTH")]
    north = rows[(day, "NORTH")]
    assert north == {
        "delivery_date": day, "zone": "NORTH", "zone_name": "North",
        "unplanned_orders": 2, "planned_orders": len(planned),
        "total_weight_kg": 1100.0, "total_volume_m3": 3.5, "total_pallet_spaces": 2.0,
        "plan_ids": [plan["id"]],
    }
    assert rows[(day, "SOUTH")]["zone_name"] == "South side"
    assert rows[(day, None)]["zone_name"] is None and rows[(day, None)]["unplanned_orders"] == 1

    r = await client.get("/api/ops/batches", headers=dispatcher.headers,
                         params={"from_date": nxt, "to_date": nxt})
    assert [(b["delivery_date"], b["zone"]) for b in r.json()] == [(nxt, "NORTH")]


async def test_rezoning_an_address_keeps_reserved_orders_in_their_plan(client, session, dispatcher,
                                                                       customer):
    world = await make_world(session, customer)
    await make_zone(session, "SOUTH")
    order, = await accepted_orders(session, customer, world, [[(world.box, 1)]])
    plan = await create_plan(client, dispatcher, world)
    r = await client.patch(f"/api/ops/addresses/{world.delivery.id}", headers=dispatcher.headers,
                           json={"zone": "SOUTH"})
    assert r.status_code == 200
    fresh = await session.get(Order, order.id, populate_existing=True)
    assert fresh.plan_id == plan["id"]
    plan = (await client.get(f"/api/ops/plans/{plan['id']}", headers=dispatcher.headers)).json()
    assert plan["order_ids"] == [order.id] and plan["zone"] == "NORTH"
    rows = (await client.get("/api/ops/batches", headers=dispatcher.headers)).json()
    assert [(b["zone"], b["planned_orders"]) for b in rows] == [("NORTH", 1)]
