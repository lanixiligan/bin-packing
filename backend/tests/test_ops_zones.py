"""Zones and address zoning (ops)."""

from tests.factories import make_address, make_zone


async def test_zone_crud(client, dispatcher):
    r = await client.post("/api/ops/zones", headers=dispatcher.headers,
                          json={"code": " north-1 ", "name": "North 1", "rate_per_kg": "0.55"})
    assert r.status_code == 201, r.text
    assert r.json()["code"] == "NORTH-1" and r.json()["rate_per_kg"] == "0.5500"
    assert r.json()["active"] is True

    r = await client.post("/api/ops/zones", headers=dispatcher.headers,
                          json={"code": "north-1", "name": "Again", "rate_per_kg": "1"})
    assert r.status_code == 409
    r = await client.post("/api/ops/zones", headers=dispatcher.headers,
                          json={"code": "bad code!", "name": "x", "rate_per_kg": "1"})
    assert r.status_code == 422
    r = await client.post("/api/ops/zones", headers=dispatcher.headers,
                          json={"code": "FREE", "name": "x", "rate_per_kg": "0"})
    assert r.status_code == 422

    await client.post("/api/ops/zones", headers=dispatcher.headers,
                      json={"code": "EAST", "name": "East", "rate_per_kg": "0.70"})
    r = await client.get("/api/ops/zones", headers=dispatcher.headers)
    assert [z["code"] for z in r.json()] == ["EAST", "NORTH-1"]

    r = await client.patch("/api/ops/zones/north-1", headers=dispatcher.headers,
                           json={"rate_per_kg": "0.6", "active": False})
    assert r.status_code == 200
    assert r.json()["rate_per_kg"] == "0.6000" and r.json()["active"] is False
    assert r.json()["name"] == "North 1"
    r = await client.patch("/api/ops/zones/NORTH-1", headers=dispatcher.headers, json={"name": None})
    assert r.status_code == 200 and r.json()["name"] == "North 1"
    assert (await client.patch("/api/ops/zones/NOPE", headers=dispatcher.headers,
                               json={"name": "x"})).status_code == 404


async def test_list_addresses_across_companies(client, session, dispatcher, customer, other_customer):
    await make_zone(session, "NORTH")
    a = await make_address(session, customer.company, label="B shop", zone="NORTH")
    b = await make_address(session, customer.company, label="A depot")
    c = await make_address(session, other_customer.company, label="Their shop", zone="NORTH")
    archived = await make_address(session, customer.company, label="Old")
    archived.archived = True
    session.add(archived)
    await session.commit()

    async def ids(**params):
        r = await client.get("/api/ops/addresses", headers=dispatcher.headers, params=params)
        assert r.status_code == 200
        return [x["id"] for x in r.json()]

    # Sorted by company name, then label.
    assert await ids() == [b.id, a.id, c.id]
    assert await ids(zone="north") == [a.id, c.id]
    assert await ids(zone="none") == [b.id]
    assert await ids(company_id=other_customer.company.id) == [c.id]
    r = await client.get("/api/ops/addresses", headers=dispatcher.headers)
    assert r.json()[2]["company_name"] == "Globex Ltd" and r.json()[2]["zone"] == "NORTH"


async def test_set_and_clear_an_address_zone(client, session, dispatcher, customer):
    await make_zone(session, "NORTH")
    off = await make_zone(session, "OLD")
    off.active = False
    session.add(off)
    await session.commit()
    addr = await make_address(session, customer.company)
    url = f"/api/ops/addresses/{addr.id}"

    r = await client.patch(url, headers=dispatcher.headers, json={"zone": "north"})
    assert r.status_code == 200 and r.json()["zone"] == "NORTH"
    assert r.json()["company_name"] == "Acme Pty Ltd"
    assert (await client.patch(url, headers=dispatcher.headers, json={"zone": "MARS"})).status_code == 422
    assert (await client.patch(url, headers=dispatcher.headers, json={"zone": "OLD"})).status_code == 422
    r = await client.patch(url, headers=dispatcher.headers, json={"zone": None})
    assert r.status_code == 200 and r.json()["zone"] is None
    assert (await client.patch("/api/ops/addresses/999", headers=dispatcher.headers,
                               json={"zone": None})).status_code == 404
    # The customer sees the zone the dispatcher set.
    await client.patch(url, headers=dispatcher.headers, json={"zone": "NORTH"})
    await session.refresh(addr)
    assert addr.zone == "NORTH"
