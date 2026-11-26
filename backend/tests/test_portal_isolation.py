"""
Tenant isolation of the customer portal.

* Another company's row addressed by id in the PATH answers 404, exactly like
  a missing row.
* Another company's item or address referenced in a request BODY (order
  create/update, quote preview) answers 422 with the same message as a
  missing or archived one.
* Lists never contain another company's rows.
* Dispatchers and drivers get 403 on every portal route; no token gets 401.
"""

import re

import pytest
from sqlmodel import select

from app.main import app
from app.models import Address, Item, Order, OrderEvent, OrderStatus, UserRole
from tests.factories import make_order
from tests.test_portal_support import make_catalog, order_body, zone_north

PORTAL_ROUTES = sorted(
    (method.upper(), path)
    for path, ops in app.openapi()["paths"].items()
    if path.startswith("/api/portal")
    for method in ops
)


def _fill(path: str, ids: dict[str, int]) -> str:
    return re.sub(r"\{(\w+)\}", lambda m: str(ids[m.group(1)]), path)


@pytest.fixture
async def world(session, customer, other_customer):
    """Company A (customer) with a catalogue and orders; company B (other_customer) with its own."""
    zone = await zone_north(session)
    a = await make_catalog(session, customer.company, zone=zone)
    b = await make_catalog(session, other_customer.company, zone=zone)
    draft = await make_order(session, company=customer.company, created_by=customer.user,
                             pickup=a.pickup, delivery=a.delivery, lines=[(a.item, 2)])
    submitted = await make_order(session, company=customer.company, created_by=customer.user,
                                 pickup=a.pickup, delivery=a.delivery, lines=[(a.item, 1)],
                                 status=OrderStatus.submitted)
    return {"a": a, "b": b, "draft": draft, "submitted": submitted}


def test_the_route_list_is_complete():
    assert len(PORTAL_ROUTES) == 17


# Path-id requests from company B to company A's rows.
FOREIGN = [
    ("GET", "/api/portal/items/{id}", "item", None),
    ("PATCH", "/api/portal/items/{id}", "item", {"name": "Hacked"}),
    ("DELETE", "/api/portal/items/{id}", "item", None),
    ("GET", "/api/portal/addresses/{id}", "address", None),
    ("PATCH", "/api/portal/addresses/{id}", "address", {"label": "Hacked"}),
    ("DELETE", "/api/portal/addresses/{id}", "address", None),
    ("GET", "/api/portal/orders/{id}", "draft", None),
    ("PATCH", "/api/portal/orders/{id}", "draft", {"notes": "Hacked"}),
    ("POST", "/api/portal/orders/{id}/submit", "draft", None),
    ("POST", "/api/portal/orders/{id}/cancel", "draft", None),
    ("POST", "/api/portal/orders/{id}/cancel", "submitted", None),
]


async def test_other_company_rows_are_404(client, session, world, other_customer):
    ids = {"item": world["a"].item.id, "address": world["a"].delivery.id,
           "draft": world["draft"].id, "submitted": world["submitted"].id}
    for method, path, target, body in FOREIGN:
        url = path.replace("{id}", str(ids[target]))
        r = await client.request(method, url, json=body, headers=other_customer.headers)
        assert r.status_code == 404, (method, path, target, r.text)
        # Same body as a row that doesn't exist at all.
        missing = await client.request(method, path.replace("{id}", "999999"), json=body,
                                       headers=other_customer.headers)
        assert missing.status_code == 404 and missing.json() == r.json(), (method, path)

    # Nothing changed on company A's side.
    item = await session.get(Item, world["a"].item.id, populate_existing=True)
    addr = await session.get(Address, world["a"].delivery.id, populate_existing=True)
    assert (item.name, item.archived) == ("Item BOX-1", False)
    assert (addr.label, addr.archived) == ("Site A", False)
    for key, status in (("draft", OrderStatus.draft), ("submitted", OrderStatus.submitted)):
        order = await session.get(Order, world[key].id, populate_existing=True)
        assert order.status == status and order.notes is None and order.quote_id == world[key].quote_id
    assert len((await session.exec(select(OrderEvent))).all()) == 2


async def test_owner_can_do_all_of_that(client, world, customer):
    """Control for the test above: the same requests work for company A."""
    a = world["a"]
    h = customer.headers
    assert (await client.get(f"/api/portal/items/{a.item.id}", headers=h)).status_code == 200
    assert (await client.get(f"/api/portal/addresses/{a.delivery.id}", headers=h)).status_code == 200
    assert (await client.get(f"/api/portal/orders/{world['draft'].id}", headers=h)).status_code == 200
    assert (await client.post(f"/api/portal/orders/{world['draft'].id}/submit",
                              headers=h)).status_code == 200


@pytest.mark.parametrize("ref", ["item", "pickup", "delivery"])
async def test_cannot_reference_other_company_rows_in_an_order(client, world, other_customer, ref):
    a, b = world["a"], world["b"]
    body = order_body(b)
    if ref == "item":
        body["lines"] = [{"item_id": a.item.id, "quantity": 1}]
    else:
        body[f"{ref}_address_id"] = getattr(a, ref).id
    r = await client.post("/api/portal/orders", json=body, headers=other_customer.headers)
    assert r.status_code == 422, r.text
    assert "doesn't exist or is archived" in r.json()["detail"]

    # Same when editing B's own draft.
    own = await client.post("/api/portal/orders", json=order_body(b), headers=other_customer.headers)
    assert own.status_code == 201
    patch = ({"lines": body["lines"]} if ref == "item"
             else {f"{ref}_address_id": body[f"{ref}_address_id"]})
    r = await client.patch(f"/api/portal/orders/{own.json()['id']}", json=patch,
                           headers=other_customer.headers)
    assert r.status_code == 422, r.text


@pytest.mark.parametrize("ref", ["item", "delivery"])
async def test_cannot_quote_with_other_company_rows(client, world, other_customer, ref):
    a, b = world["a"], world["b"]
    body = {"delivery_address_id": (a if ref == "delivery" else b).delivery.id,
            "lines": [{"item_id": (a if ref == "item" else b).item.id, "quantity": 1}]}
    r = await client.post("/api/portal/quote-preview", json=body, headers=other_customer.headers)
    assert r.status_code == 422
    assert "doesn't exist or is archived" in r.json()["detail"]


async def test_lists_only_show_own_rows(client, session, world, customer, other_customer):
    b = world["b"]
    await make_order(session, company=other_customer.company, created_by=other_customer.user,
                     pickup=b.pickup, delivery=b.delivery, lines=[(b.item, 1)])
    await client.delete(f"/api/portal/items/{world['a'].bulky.id}", headers=customer.headers)
    await client.delete(f"/api/portal/addresses/{world['a'].unzoned.id}", headers=customer.headers)

    for actor, company in ((customer, customer.company), (other_customer, other_customer.company)):
        for url in ("/api/portal/items?include_archived=true", "/api/portal/addresses?include_archived=true",
                    "/api/portal/orders", "/api/portal/orders?status=draft&status=submitted",
                    "/api/portal/items", "/api/portal/addresses"):
            rows = (await client.get(url, headers=actor.headers)).json()
            assert rows, url
            assert {r["company_id"] for r in rows} == {company.id}, url
    orders = (await client.get("/api/portal/orders", headers=other_customer.headers)).json()
    assert len(orders) == 1


async def test_same_company_users_share_data(client, world, make_actor, customer):
    colleague = await make_actor(UserRole.customer, company=customer.company)
    r = await client.get(f"/api/portal/orders/{world['draft'].id}", headers=colleague.headers)
    assert r.status_code == 200
    assert len((await client.get("/api/portal/orders", headers=colleague.headers)).json()) == 2


async def test_staff_roles_get_403_on_every_route(client, world, dispatcher, driver):
    ids = {"item_id": world["a"].item.id, "address_id": world["a"].delivery.id,
           "order_id": world["draft"].id}
    for method, path in PORTAL_ROUTES:
        body = {} if method in ("POST", "PATCH") else None
        for actor in (dispatcher, driver):
            r = await client.request(method, _fill(path, ids), json=body, headers=actor.headers)
            assert r.status_code == 403, (method, path, actor.user.role, r.text)


async def test_anonymous_gets_401_on_every_route(client):
    bad = {"Authorization": "Bearer not-a-token"}
    for method, path in PORTAL_ROUTES:
        url = _fill(path, {"item_id": 1, "address_id": 1, "order_id": 1})
        body = {} if method in ("POST", "PATCH") else None
        assert (await client.request(method, url, json=body)).status_code == 401, (method, path)
        assert (await client.request(method, url, json=body, headers=bad)).status_code == 401, path
