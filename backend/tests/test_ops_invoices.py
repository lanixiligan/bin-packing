"""Monthly invoices per company, and the CSV export."""

import csv
import dataclasses
import io
from datetime import UTC, datetime

from sqlalchemy import update

from app.models import Order, OrderStatus
from tests.factories import make_address
from tests.test_ops_setup import accepted_orders, make_world


def utc(*args) -> datetime:
    return datetime(*args, tzinfo=UTC)


async def delivered(session, customer, world, qty: int, at: datetime, **kw) -> Order:
    order, = await accepted_orders(session, customer, world, [[(world.box, qty)]],
                                   status=OrderStatus.delivered, **kw)
    # Test setup: delivered_at is normally set by the lifecycle.
    await session.exec(update(Order).where(Order.id == order.id).values(delivered_at=at))
    await session.commit()
    return order


async def setup(session, customer, other_customer):
    world = await make_world(session, customer)
    # Sydney is UTC+11 in November: the month runs 2026-10-31T13:00Z .. 2026-11-30T13:00Z.
    october = await delivered(session, customer, world, 1, utc(2026, 10, 31, 12, 59))
    first = await delivered(session, customer, world, 2, utc(2026, 10, 31, 13, 0))
    last = await delivered(session, customer, world, 3, utc(2026, 11, 30, 12, 59))
    december = await delivered(session, customer, world, 4, utc(2026, 11, 30, 13, 0))
    other_pick = await make_address(session, other_customer.company, label="Their depot")
    other_drop = await make_address(session, other_customer.company, label="Their shop", zone="NORTH",
                                    suburb="Ryde")
    other_world = dataclasses.replace(world, pickup=other_pick, delivery=other_drop)
    theirs = await delivered(session, other_customer, other_world, 5, utc(2026, 11, 15))
    # Not delivered: never invoiced.
    await accepted_orders(session, customer, world, [[(world.box, 1)]], status=OrderStatus.in_transit)
    return world, {"october": october, "first": first, "last": last, "december": december,
                   "theirs": theirs}


async def test_invoice_summaries_use_business_month_boundaries(client, session, dispatcher, customer,
                                                               other_customer):
    await setup(session, customer, other_customer)
    r = await client.get("/api/ops/invoices", headers=dispatcher.headers, params={"month": "2026-11"})
    assert r.status_code == 200
    assert r.json() == [
        {"company_id": customer.company.id, "company_name": "Acme Pty Ltd", "month": "2026-11",
         "order_count": 2, "total_amount": "250.00"},
        {"company_id": other_customer.company.id, "company_name": "Globex Ltd", "month": "2026-11",
         "order_count": 1, "total_amount": "250.00"},
    ]
    r = await client.get("/api/ops/invoices", headers=dispatcher.headers, params={"month": "2026-10"})
    assert [(s["company_name"], s["order_count"]) for s in r.json()] == [("Acme Pty Ltd", 1)]
    r = await client.get("/api/ops/invoices", headers=dispatcher.headers, params={"month": "2026-12"})
    assert [(s["company_name"], s["total_amount"]) for s in r.json()] == [("Acme Pty Ltd", "200.00")]
    r = await client.get("/api/ops/invoices", headers=dispatcher.headers, params={"month": "2026-13"})
    assert r.status_code == 422


async def test_invoice_lines_come_from_the_quotes(client, session, dispatcher, customer, other_customer):
    _, orders = await setup(session, customer, other_customer)
    r = await client.get(f"/api/ops/invoices/{customer.company.id}", headers=dispatcher.headers,
                         params={"month": "2026-11"})
    assert r.status_code == 200
    invoice = r.json()
    assert invoice["company_name"] == "Acme Pty Ltd" and invoice["order_count"] == 2
    assert invoice["total_amount"] == "250.00"
    assert [ln["order_id"] for ln in invoice["lines"]] == [orders["first"].id, orders["last"].id]
    first = invoice["lines"][0]
    assert first == {
        "order_id": orders["first"].id, "reference": orders["first"].reference, "customer_reference": None,
        "delivered_at": "2026-10-31T13:00:00Z", "delivery_suburb": "Chatswood", "zone_code": "NORTH",
        "total_weight_kg": 200.0, "total_volume_m3": 1.0, "cubic_weight_kg": 200.0,
        "rate_per_kg": "0.5000", "amount": "100.00",
    }
    assert (await client.get("/api/ops/invoices/999", headers=dispatcher.headers,
                             params={"month": "2026-11"})).status_code == 404
    r = await client.get(f"/api/ops/invoices/{customer.company.id}", headers=dispatcher.headers,
                         params={"month": "2025-01"})
    assert r.json()["lines"] == [] and r.json()["total_amount"] == "0.00"


async def test_invoice_csv(client, session, dispatcher, customer, other_customer):
    _, orders = await setup(session, customer, other_customer)
    r = await client.get(f"/api/ops/invoices/{customer.company.id}/csv", headers=dispatcher.headers,
                         params={"month": "2026-11"})
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/csv")
    assert r.headers["content-disposition"] == 'attachment; filename="invoice-acme-pty-ltd-2026-11.csv"'
    rows = list(csv.reader(io.StringIO(r.text)))
    assert rows[0] == ["reference", "customer_reference", "delivered_at", "delivery_suburb", "zone",
                       "weight_kg", "volume_m3", "cubic_weight_kg", "rate_per_kg", "amount"]
    assert rows[1] == [orders["first"].reference, "", "2026-11-01T00:00:00+11:00", "Chatswood", "NORTH",
                       "200", "1", "200", "0.5000", "100.00"]
    assert rows[2][0] == orders["last"].reference and rows[2][2] == "2026-11-30T23:59:00+11:00"
    assert rows[3] == ["TOTAL", "", "", "", "", "", "", "", "", "250.00"]
    assert len(rows) == 4

    assert (await client.get("/api/ops/invoices/999/csv", headers=dispatcher.headers,
                             params={"month": "2026-11"})).status_code == 404
    assert (await client.get(f"/api/ops/invoices/{customer.company.id}/csv", headers=dispatcher.headers,
                             params={"month": "Nov"})).status_code == 422


async def test_csv_quotes_awkward_values(client, session, dispatcher, make_actor, customer):
    tricky = await make_actor(customer.user.role, company_name='Smith, "Jones" & Co')
    world = await make_world(session, tricky)
    order = await delivered(session, tricky, world, 1, utc(2026, 11, 10))
    await session.exec(update(Order).where(Order.id == order.id).values(customer_reference='PO, "7"'))
    await session.commit()
    r = await client.get(f"/api/ops/invoices/{tricky.company.id}/csv", headers=dispatcher.headers,
                         params={"month": "2026-11"})
    assert 'filename="invoice-smith-jones-co-2026-11.csv"' in r.headers["content-disposition"]
    assert '"PO, ""7"""' in r.text
    assert list(csv.reader(io.StringIO(r.text)))[1][1] == 'PO, "7"'
