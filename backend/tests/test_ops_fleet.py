"""Vehicles and drivers (ops)."""

from app.models import Driver, User
from tests.conftest import PASSWORD

TRUCK = {"name": "Truck 1", "registration": "abc123", "max_weight_kg": 1000}


async def test_vehicle_crud(client, dispatcher):
    r = await client.post("/api/ops/vehicles", headers=dispatcher.headers, json=TRUCK)
    assert r.status_code == 201, r.text
    truck = r.json()
    assert truck["registration"] == "ABC123" and truck["max_pallets"] is None and truck["active"]

    assert (await client.post("/api/ops/vehicles", headers=dispatcher.headers,
                              json={**TRUCK, "registration": "NEW1"})).status_code == 409
    assert (await client.post("/api/ops/vehicles", headers=dispatcher.headers,
                              json={**TRUCK, "name": "Truck 2"})).status_code == 409
    assert (await client.post("/api/ops/vehicles", headers=dispatcher.headers,
                              json={"name": "Empty", "registration": "E1"})).status_code == 422

    r = await client.post("/api/ops/vehicles", headers=dispatcher.headers,
                          json={"name": "Pallet van", "registration": "PV1", "max_pallets": 8})
    van = r.json()

    url = f"/api/ops/vehicles/{truck['id']}"
    r = await client.patch(url, headers=dispatcher.headers, json={"max_volume_m3": 20, "max_weight_kg": None})
    assert r.status_code == 200
    assert r.json()["max_weight_kg"] is None and r.json()["max_volume_m3"] == 20
    r = await client.patch(url, headers=dispatcher.headers, json={"max_volume_m3": None})
    assert r.status_code == 422
    assert (await client.patch(url, headers=dispatcher.headers,
                               json={"name": "Pallet van"})).status_code == 409
    assert (await client.patch(url, headers=dispatcher.headers,
                               json={"registration": "pv1"})).status_code == 409
    r = await client.patch(url, headers=dispatcher.headers, json={"active": False, "name": None})
    assert r.status_code == 200 and r.json()["active"] is False and r.json()["name"] == "Truck 1"
    assert (await client.patch("/api/ops/vehicles/999", headers=dispatcher.headers,
                               json={"active": True})).status_code == 404

    r = await client.get("/api/ops/vehicles", headers=dispatcher.headers)
    assert [v["id"] for v in r.json()] == [van["id"]]
    r = await client.get("/api/ops/vehicles", headers=dispatcher.headers, params={"include_inactive": True})
    assert [v["name"] for v in r.json()] == ["Pallet van", "Truck 1"]


async def test_create_driver_creates_a_login(client, session, dispatcher):
    body = {"email": "Dan@Example.com", "password": "long-enough-1", "name": "Dan Driver",
            "phone": "0400 123 456", "licence_number": "NSW123"}
    r = await client.post("/api/ops/drivers", headers=dispatcher.headers, json=body)
    assert r.status_code == 201, r.text
    created = r.json()
    assert created["email"] == "dan@example.com" and created["name"] == "Dan Driver" and created["active"]

    r = await client.post("/api/auth/jwt/login", data={"username": "dan@example.com",
                                                       "password": "long-enough-1"})
    assert r.status_code == 200
    me = await client.get("/api/users/me", headers={"Authorization": f"Bearer {r.json()['access_token']}"})
    assert me.json()["role"] == "driver" and me.json()["driver_id"] == created["id"]

    r = await client.post("/api/ops/drivers", headers=dispatcher.headers,
                          json={**body, "email": "DAN@example.com"})
    assert r.status_code == 409
    r = await client.post("/api/ops/drivers", headers=dispatcher.headers,
                          json={**body, "email": dispatcher.user.email})
    assert r.status_code == 409
    r = await client.post("/api/ops/drivers", headers=dispatcher.headers,
                          json={**body, "email": "x@y.com", "password": "short"})
    assert r.status_code == 422


async def test_deactivating_a_driver_blocks_their_login(client, session, dispatcher, driver):
    url = f"/api/ops/drivers/{driver.driver.id}"
    r = await client.patch(url, headers=dispatcher.headers, json={"active": False, "phone": None})
    assert r.status_code == 200 and r.json()["active"] is False and r.json()["phone"] is None
    user = await session.get(User, driver.user.id, populate_existing=True)
    assert user.is_active is False
    assert (await client.get("/api/driver/run", headers=driver.headers)).status_code == 401
    r = await client.post("/api/auth/jwt/login", data={"username": driver.user.email, "password": PASSWORD})
    assert r.status_code == 400

    r = await client.get("/api/ops/drivers", headers=dispatcher.headers)
    assert r.json() == []
    r = await client.get("/api/ops/drivers", headers=dispatcher.headers, params={"include_inactive": True})
    assert [d["id"] for d in r.json()] == [driver.driver.id]

    r = await client.patch(url, headers=dispatcher.headers, json={"active": True, "name": "Renamed"})
    assert r.status_code == 200 and r.json()["active"] and r.json()["name"] == "Renamed"
    user = await session.get(User, driver.user.id, populate_existing=True)
    assert user.is_active is True and user.full_name == "Renamed"
    assert (await session.get(Driver, driver.driver.id, populate_existing=True)).name == "Renamed"
    assert (await client.get("/api/driver/run", headers=driver.headers)).status_code == 200
    assert (await client.patch("/api/ops/drivers/999", headers=dispatcher.headers,
                               json={"active": True})).status_code == 404
