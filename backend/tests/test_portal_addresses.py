"""Portal saved addresses: CRUD, archive, validation; customers can never set the zone."""

import pytest

from app.models import Address
from tests.factories import make_address, make_zone

URL = "/api/portal/addresses"
HOME = {"label": "Main warehouse", "contact_name": "Sam", "phone": "0400 111 222",
        "line1": "12 Distribution Dr", "suburb": "Wetherill Park", "state": "NSW", "postcode": "2164"}


async def _create(client, actor, **overrides):
    r = await client.post(URL, json={**HOME, **overrides}, headers=actor.headers)
    assert r.status_code == 201, r.text
    return r.json()


async def test_create_get_and_list(client, customer):
    a = await _create(client, customer)
    assert a["company_id"] == customer.company.id and a["country"] == "AU"
    assert a["zone"] is None and a["archived"] is False and a["line2"] is None
    assert (await client.get(f"{URL}/{a['id']}", headers=customer.headers)).json() == a
    b = await _create(client, customer, label="Chatswood store", country="au")
    assert b["country"] == "AU"
    listed = (await client.get(URL, headers=customer.headers)).json()
    assert [x["id"] for x in listed] == [b["id"], a["id"]]  # sorted by label


async def test_customer_cannot_set_zone(client, session, customer):
    await make_zone(session, "NORTH")
    a = await _create(client, customer, zone="NORTH")
    assert a["zone"] is None
    zoned = await make_address(session, customer.company, zone="NORTH")
    r = await client.patch(f"{URL}/{zoned.id}", json={"zone": None, "label": "Renamed"},
                           headers=customer.headers)
    assert r.status_code == 200
    assert r.json()["zone"] == "NORTH" and r.json()["label"] == "Renamed"
    r = await client.patch(f"{URL}/{a['id']}", json={"zone": "NORTH"}, headers=customer.headers)
    assert r.json()["zone"] is None


@pytest.mark.parametrize("change", [
    {"label": ""}, {"line1": ""}, {"suburb": ""}, {"state": ""}, {"postcode": "12"},
    {"country": "AUS"}, {"notes": "x" * 1001}, {"label": None},
])
async def test_create_validation(client, customer, change):
    body = {**HOME, **change}
    assert (await client.post(URL, json=body, headers=customer.headers)).status_code == 422


async def test_patch_changes_only_sent_fields_and_clears_nullable_ones(client, customer):
    a = await _create(client, customer, notes="Dock 3")
    r = await client.patch(f"{URL}/{a['id']}", json={"line2": "Unit 4", "notes": None, "phone": None},
                           headers=customer.headers)
    assert r.status_code == 200
    u = r.json()
    assert u["line2"] == "Unit 4" and u["notes"] is None and u["phone"] is None
    assert u["label"] == a["label"] and u["contact_name"] == "Sam"


@pytest.mark.parametrize("body", [
    {"label": None}, {"line1": None}, {"suburb": None}, {"state": None}, {"postcode": None},
    {"country": None}, {"postcode": "1"},
])
async def test_patch_validation(client, customer, body):
    a = await _create(client, customer)
    assert (await client.patch(f"{URL}/{a['id']}", json=body, headers=customer.headers)).status_code == 422


async def test_delete_archives(client, session, customer):
    a = await _create(client, customer)
    r = await client.delete(f"{URL}/{a['id']}", headers=customer.headers)
    assert r.status_code == 204
    assert (await session.get(Address, a["id"])).archived is True
    assert (await client.get(URL, headers=customer.headers)).json() == []
    listed = (await client.get(f"{URL}?include_archived=true", headers=customer.headers)).json()
    assert [x["id"] for x in listed] == [a["id"]]
    assert (await client.get(f"{URL}/{a['id']}", headers=customer.headers)).json()["archived"] is True


async def test_missing_address_is_404(client, customer):
    for method in ("GET", "PATCH", "DELETE"):
        r = await client.request(method, f"{URL}/999999", json={"label": "x"}, headers=customer.headers)
        assert r.status_code == 404 and r.json() == {"detail": "Address not found."}
