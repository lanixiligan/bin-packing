"""Portal orders: create, edit (drafts only), quote preview, submit, cancel, list, timeline."""

from datetime import timedelta
from decimal import Decimal

import pytest
from sqlalchemy import func
from sqlmodel import select

from app.config import settings
from app.models import Order, OrderEvent, OrderStatus, Quote
from tests.factories import make_order
from tests.test_portal_support import (
    create_order,
    in_days,
    make_catalog,
    order_body,
    submitted_order,
    zone_north,
)

S = OrderStatus


@pytest.fixture
async def cat(session, customer):
    return await make_catalog(session, customer.company, zone=await zone_north(session))


# ---- Create -------------------------------------------------------------------

async def test_create_draft_with_snapshot_and_first_event(client, customer, cat):
    o = await create_order(client, customer, cat, window_start="09:00", window_end="12:00",
                           notes="Ring the bell", lines=[{"item_id": cat.item.id, "quantity": 3},
                                                         {"item_id": cat.bulky.id, "quantity": 2}])
    assert o["status"] == "draft"
    assert o["reference"] == f"ORD-{o['id']:06d}"
    assert o["company_name"] == "Acme Pty Ltd"
    assert o["pickup_address"]["id"] == cat.pickup.id
    assert o["delivery_label"] == "Site A" and o["zone"] == "NORTH"
    assert o["window_start"] == "09:00:00" and o["window_end"] == "12:00:00"
    assert o["notes"] == "Ring the bell" and o["customer_reference"] == "PO-1"
    assert [(ln["item_sku"], ln["quantity"], ln["unit_weight_kg"], ln["unit_volume_m3"])
            for ln in o["lines"]] == [("BOX-1", 3, 100, 0.5), ("BATTS", 2, 10, 1.0)]
    assert o["line_count"] == 2 and o["total_units"] == 5
    assert o["total_weight_kg"] == 320 and o["total_volume_m3"] == 3.5
    assert o["quote"] is None and o["amount"] is None and o["submitted_at"] is None
    assert o["pods"] == [] and o["plan_id"] is None
    [ev] = o["events"]
    assert ev["from_status"] is None and ev["to_status"] == "draft"
    assert ev["actor_id"] == str(customer.user.id)
    assert ev["actor_role"] == "customer" and ev["actor_name"] == customer.user.full_name


async def test_lines_keep_their_snapshot_when_the_item_changes(client, customer, cat):
    o = await create_order(client, customer, cat)
    r = await client.patch(f"/api/portal/items/{cat.item.id}", json={"weight_kg": 999, "name": "Renamed"},
                           headers=customer.headers)
    assert r.status_code == 200
    again = (await client.get(f"/api/portal/orders/{o['id']}", headers=customer.headers)).json()
    assert again["lines"][0]["unit_weight_kg"] == 100
    assert again["lines"][0]["item_name"] == o["lines"][0]["item_name"]


async def test_delivery_today_is_allowed_but_the_past_is_not(client, customer, cat):
    await create_order(client, customer, cat, delivery_date=in_days(0))
    r = await client.post("/api/portal/orders", json=order_body(cat, delivery_date=in_days(-1)),
                          headers=customer.headers)
    assert r.status_code == 422
    assert "past" in r.json()["detail"]


@pytest.mark.parametrize("change", [
    lambda c: {"delivery_address_id": c.pickup.id},                       # same as pickup
    lambda c: {"window_start": "12:00", "window_end": "09:00"},
    lambda c: {"lines": []},
    lambda c: {"lines": [{"item_id": c.item.id, "quantity": 0}]},
    lambda c: {"lines": [{"item_id": c.item.id, "quantity": 1}, {"item_id": c.item.id, "quantity": 2}]},
    lambda c: {"lines": [{"item_id": 999999, "quantity": 1}]},
    lambda c: {"delivery_address_id": 999999},
    lambda c: {"pickup_address_id": 999999},
])
async def test_create_validation(client, customer, cat, change):
    r = await client.post("/api/portal/orders", json=order_body(cat, **change(cat)), headers=customer.headers)
    assert r.status_code == 422, r.text


async def test_archived_items_and_addresses_cannot_be_used(client, customer, cat):
    await client.delete(f"/api/portal/items/{cat.bulky.id}", headers=customer.headers)
    await client.delete(f"/api/portal/addresses/{cat.unzoned.id}", headers=customer.headers)
    r = await client.post("/api/portal/orders", headers=customer.headers,
                          json=order_body(cat, lines=[{"item_id": cat.bulky.id, "quantity": 1}]))
    assert r.status_code == 422 and "archived" in r.json()["detail"]
    r = await client.post("/api/portal/orders", headers=customer.headers,
                          json=order_body(cat, delivery_address_id=cat.unzoned.id))
    assert r.status_code == 422 and "archived" in r.json()["detail"]
    r = await client.post("/api/portal/orders", headers=customer.headers,
                          json=order_body(cat, pickup_address_id=cat.unzoned.id))
    assert r.status_code == 422


# ---- Update -------------------------------------------------------------------

async def test_patch_draft_fields_and_replace_lines(client, customer, cat):
    o = await create_order(client, customer, cat)
    old_line_id = o["lines"][0]["id"]
    r = await client.patch(f"/api/portal/orders/{o['id']}", headers=customer.headers, json={
        "notes": "Side gate", "customer_reference": None, "delivery_address_id": cat.unzoned.id,
        "delivery_date": in_days(3),
        "lines": [{"item_id": cat.bulky.id, "quantity": 4}, {"item_id": cat.item.id, "quantity": 1}],
    })
    assert r.status_code == 200, r.text
    u = r.json()
    assert u["notes"] == "Side gate" and u["customer_reference"] is None
    assert u["delivery_address"]["id"] == cat.unzoned.id and u["zone"] is None
    assert u["delivery_date"] == in_days(3)
    assert [(ln["item_id"], ln["quantity"]) for ln in u["lines"]] == [(cat.bulky.id, 4), (cat.item.id, 1)]
    assert old_line_id not in {ln["id"] for ln in u["lines"]}
    assert u["status"] == "draft" and len(u["events"]) == 1  # edits are not status changes
    assert u["updated_at"] > o["updated_at"]


async def test_patch_only_changes_sent_fields(client, customer, cat):
    o = await create_order(client, customer, cat, notes="keep me")
    u = (await client.patch(f"/api/portal/orders/{o['id']}", json={"customer_reference": "PO-2"},
                            headers=customer.headers)).json()
    assert u["notes"] == "keep me" and u["customer_reference"] == "PO-2"
    assert [ln["id"] for ln in u["lines"]] == [ln["id"] for ln in o["lines"]]


@pytest.mark.parametrize("body", [
    {"delivery_date": None},
    {"lines": None},
    {"pickup_address_id": None},
    {"delivery_date": "2000-01-01"},
    {"window_start": "18:00"},                     # after the stored window_end
    {"pickup_address_id": "DELIVERY"},             # merged result equals the delivery address
    {"lines": [{"item_id": 999999, "quantity": 1}]},
])
async def test_patch_validation(client, customer, cat, body):
    o = await create_order(client, customer, cat, window_start="09:00", window_end="12:00")
    if body.get("pickup_address_id") == "DELIVERY":
        body = {"pickup_address_id": cat.delivery.id}
    r = await client.patch(f"/api/portal/orders/{o['id']}", json=body, headers=customer.headers)
    assert r.status_code == 422, r.text


@pytest.mark.parametrize("status", [S.submitted, S.accepted, S.cancelled, S.delivered])
async def test_patch_only_for_drafts(client, session, customer, cat, status):
    o = await make_order(session, company=customer.company, created_by=customer.user, pickup=cat.pickup,
                         delivery=cat.delivery, lines=[(cat.item, 1)], status=status)
    r = await client.patch(f"/api/portal/orders/{o.id}", json={"notes": "x"}, headers=customer.headers)
    assert r.status_code == 409
    assert "draft" in r.json()["detail"]


# ---- Quotes and submit ----------------------------------------------------------

async def test_quote_preview_uses_cubic_weight_and_zone_rate(client, session, customer, cat):
    body = {"delivery_address_id": cat.delivery.id,
            "lines": [{"item_id": cat.item.id, "quantity": 3}, {"item_id": cat.bulky.id, "quantity": 1}]}
    r = await client.post("/api/portal/quote-preview", json=body, headers=customer.headers)
    assert r.status_code == 200, r.text
    q = r.json()
    # 310 kg, 2.5 m³ → cubic max(310, 625) = 625 kg × 0.45 = 281.25
    assert q["id"] is None and q["created_at"] is None
    assert q["total_weight_kg"] == 310 and q["total_volume_m3"] == 2.5 and q["cubic_weight_kg"] == 625
    assert q["rate_per_kg"] == "0.4500" and q["amount"] == "281.25"
    assert q["zone_code"] == "NORTH" and q["provisional"] is False
    assert (await session.exec(select(func.count()).select_from(Quote))).one() == 0


async def test_quote_preview_without_zone_is_provisional(client, customer, cat):
    body = {"delivery_address_id": cat.unzoned.id, "lines": [{"item_id": cat.item.id, "quantity": 2}]}
    q = (await client.post("/api/portal/quote-preview", json=body, headers=customer.headers)).json()
    assert q["provisional"] is True and q["zone_code"] is None
    assert Decimal(q["rate_per_kg"]) == settings.DEFAULT_RATE_PER_KG
    assert Decimal(q["amount"]) == (Decimal(250) * settings.DEFAULT_RATE_PER_KG).quantize(Decimal("0.01"))


async def test_quote_preview_rejects_unknown_or_archived(client, customer, cat):
    await client.delete(f"/api/portal/items/{cat.bulky.id}", headers=customer.headers)
    for body in (
        {"delivery_address_id": 999999, "lines": [{"item_id": cat.item.id, "quantity": 1}]},
        {"delivery_address_id": cat.delivery.id, "lines": [{"item_id": cat.bulky.id, "quantity": 1}]},
        {"delivery_address_id": cat.delivery.id, "lines": []},
    ):
        r = await client.post("/api/portal/quote-preview", json=body, headers=customer.headers)
        assert r.status_code == 422, body


async def test_submit_stores_the_quote(client, session, customer, cat):
    o = await create_order(client, customer, cat)  # 3 × (100 kg, 0.5 m³) → 375 cubic kg
    r = await client.post(f"/api/portal/orders/{o['id']}/submit", json={"note": "  Fragile  "},
                          headers=customer.headers)
    assert r.status_code == 200, r.text
    s = r.json()
    assert s["status"] == "submitted" and s["submitted_at"] is not None
    q = s["quote"]
    assert q["id"] is not None and q["created_at"] is not None
    assert q["cubic_weight_kg"] == 375 and q["rate_per_kg"] == "0.4500" and q["amount"] == "168.75"
    assert q["provisional"] is False and q["zone_code"] == "NORTH"
    assert s["amount"] == "168.75"
    assert [(e["from_status"], e["to_status"]) for e in s["events"]] == [(None, "draft"),
                                                                        ("draft", "submitted")]
    assert s["events"][1]["note"] == "Fragile"
    assert s["events"][1]["actor_id"] == str(customer.user.id)
    stored = await session.get(Order, o["id"])
    assert stored.quote_id == q["id"]
    assert (await session.get(Quote, q["id"])).company_id == customer.company.id


async def test_submit_without_body_and_provisional_quote(client, customer, cat):
    o = await create_order(client, customer, cat, delivery_address_id=cat.unzoned.id)
    s = (await client.post(f"/api/portal/orders/{o['id']}/submit", headers=customer.headers)).json()
    assert s["status"] == "submitted"
    assert s["quote"]["provisional"] is True and s["events"][1]["note"] is None


async def test_submit_twice_is_a_conflict_and_stores_one_quote(client, session, customer, cat):
    o = await submitted_order(client, customer, cat)
    r = await client.post(f"/api/portal/orders/{o['id']}/submit", headers=customer.headers)
    assert r.status_code == 409
    assert r.json()["detail"] == "An order that is submitted cannot become submitted."
    assert (await session.exec(select(func.count()).select_from(Quote))).one() == 1


async def test_submit_checks_date_and_archived_addresses(client, session, customer, cat):
    o = await create_order(client, customer, cat)
    row = await session.get(Order, o["id"])
    row.delivery_date = settings.today() - timedelta(days=1)
    await session.commit()
    r = await client.post(f"/api/portal/orders/{o['id']}/submit", headers=customer.headers)
    assert r.status_code == 422 and "past" in r.json()["detail"]

    o2 = await create_order(client, customer, cat)
    await client.delete(f"/api/portal/addresses/{cat.delivery.id}", headers=customer.headers)
    r = await client.post(f"/api/portal/orders/{o2['id']}/submit", headers=customer.headers)
    assert r.status_code == 422 and "archived" in r.json()["detail"]
    assert (await session.exec(select(func.count()).select_from(Quote))).one() == 0


# ---- Cancel -----------------------------------------------------------------------

@pytest.mark.parametrize("submit_first", [False, True])
async def test_cancel_draft_or_submitted(client, customer, cat, submit_first):
    o = await (submitted_order if submit_first else create_order)(client, customer, cat)
    r = await client.post(f"/api/portal/orders/{o['id']}/cancel", json={"note": "No longer needed"},
                          headers=customer.headers)
    assert r.status_code == 200
    c = r.json()
    assert c["status"] == "cancelled"
    assert c["events"][-1]["from_status"] == ("submitted" if submit_first else "draft")
    assert c["events"][-1]["to_status"] == "cancelled" and c["events"][-1]["note"] == "No longer needed"


@pytest.mark.parametrize("status", [S.accepted, S.rejected, S.planned, S.in_transit, S.delivered,
                                    S.cancelled, S.exception])
async def test_cancel_after_acceptance_is_a_conflict(client, session, customer, cat, status):
    o = await make_order(session, company=customer.company, created_by=customer.user, pickup=cat.pickup,
                         delivery=cat.delivery, lines=[(cat.item, 1)], status=status)
    r = await client.post(f"/api/portal/orders/{o.id}/cancel", headers=customer.headers)
    assert r.status_code == 409
    assert r.json()["detail"].startswith(f"An order that is {status.value.replace('_', ' ')} cannot")
    events = (await session.exec(select(OrderEvent).where(OrderEvent.order_id == o.id))).all()
    assert len(events) == 1


async def test_full_customer_timeline(client, customer, cat):
    o = await submitted_order(client, customer, cat)
    c = (await client.post(f"/api/portal/orders/{o['id']}/cancel", headers=customer.headers)).json()
    steps = [(e["from_status"], e["to_status"]) for e in c["events"]]
    assert steps == [(None, "draft"), ("draft", "submitted"), ("submitted", "cancelled")]
    times = [e["created_at"] for e in c["events"]]
    assert times == sorted(times)
    assert {e["actor_role"] for e in c["events"]} == {"customer"}


# ---- Read and list --------------------------------------------------------------

async def test_get_order_detail(client, customer, cat):
    o = await submitted_order(client, customer, cat)
    r = await client.get(f"/api/portal/orders/{o['id']}", headers=customer.headers)
    assert r.status_code == 200 and r.json() == o
    assert (await client.get("/api/portal/orders/999999", headers=customer.headers)).status_code == 404


async def test_list_filters_newest_first_and_pages(client, session, customer, cat):
    a = await create_order(client, customer, cat, delivery_date=in_days(1))
    b = await submitted_order(client, customer, cat, delivery_date=in_days(2))
    c = await create_order(client, customer, cat, delivery_date=in_days(3))
    await client.post(f"/api/portal/orders/{c['id']}/cancel", headers=customer.headers)

    def ids(r):
        assert r.status_code == 200, r.text
        return [o["id"] for o in r.json()]

    h = customer.headers
    assert ids(await client.get("/api/portal/orders", headers=h)) == [c["id"], b["id"], a["id"]]
    assert ids(await client.get("/api/portal/orders?status=draft", headers=h)) == [a["id"]]
    assert ids(await client.get("/api/portal/orders?status=draft&status=submitted", headers=h)) == [
        b["id"], a["id"]]
    assert ids(await client.get(f"/api/portal/orders?from_date={in_days(2)}", headers=h)) == [c["id"], b["id"]]
    assert ids(await client.get(f"/api/portal/orders?to_date={in_days(2)}", headers=h)) == [b["id"], a["id"]]
    assert ids(await client.get(
        f"/api/portal/orders?from_date={in_days(2)}&to_date={in_days(2)}", headers=h)) == [b["id"]]
    assert ids(await client.get("/api/portal/orders?limit=1&offset=1", headers=h)) == [b["id"]]
    assert (await client.get("/api/portal/orders?limit=501", headers=h)).status_code == 422
    assert (await client.get("/api/portal/orders?status=bogus", headers=h)).status_code == 422

    row = (await client.get("/api/portal/orders?status=submitted", headers=h)).json()[0]
    assert row["amount"] == "168.75" and row["total_units"] == 3 and row["zone"] == "NORTH"
    assert "lines" not in row and "events" not in row
