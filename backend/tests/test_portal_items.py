"""Portal item catalogue: CRUD, SKU uniqueness per company, archive, validation."""

import pytest

from app.models import Item

URL = "/api/portal/items"
BOX = {"sku": "BOX-1", "name": "Carton", "description": "Small carton", "weight_kg": 12.5,
       "volume_m3": 0.08, "pallet_spaces": 0}


async def _create(client, actor, **overrides):
    r = await client.post(URL, json={**BOX, **overrides}, headers=actor.headers)
    assert r.status_code == 201, r.text
    return r.json()


async def test_create_get_and_list(client, customer):
    item = await _create(client, customer)
    assert item["sku"] == "BOX-1" and item["weight_kg"] == 12.5 and item["volume_m3"] == 0.08
    assert item["company_id"] == customer.company.id and item["archived"] is False
    assert (await client.get(f"{URL}/{item['id']}", headers=customer.headers)).json() == item
    pallet = await _create(client, customer, sku="PAL-1", name="A pallet", pallet_spaces=1,
                           volume_m3=1.2, weight_kg=500)
    listed = (await client.get(URL, headers=customer.headers)).json()
    assert [i["id"] for i in listed] == [pallet["id"], item["id"]]  # sorted by name


async def test_defaults_and_trimming(client, customer):
    r = await client.post(URL, json={"sku": "  S-1 ", "name": " Thing ", "weight_kg": 1},
                          headers=customer.headers)
    assert r.status_code == 201
    item = r.json()
    assert item["sku"] == "S-1" and item["name"] == "Thing"
    assert item["volume_m3"] == 0 and item["pallet_spaces"] == 0 and item["description"] is None


@pytest.mark.parametrize("body", [
    {**BOX, "weight_kg": 0},
    {**BOX, "weight_kg": -1},
    {**BOX, "volume_m3": -0.1},
    {**BOX, "pallet_spaces": -1},
    {**BOX, "sku": ""},
    {**BOX, "sku": "   "},
    {**BOX, "name": "x" * 201},
    {k: v for k, v in BOX.items() if k != "weight_kg"},
])
async def test_create_validation(client, customer, body):
    assert (await client.post(URL, json=body, headers=customer.headers)).status_code == 422


async def test_duplicate_sku_is_409_with_a_readable_message(client, customer):
    await _create(client, customer)
    r = await client.post(URL, json={**BOX, "name": "Other"}, headers=customer.headers)
    assert r.status_code == 409
    assert r.json()["detail"] == 'SKU BOX-1 is already used by "Carton".'


async def test_archived_item_still_holds_its_sku(client, customer):
    item = await _create(client, customer)
    await client.delete(f"{URL}/{item['id']}", headers=customer.headers)
    r = await client.post(URL, json=BOX, headers=customer.headers)
    assert r.status_code == 409 and "(archived)" in r.json()["detail"]


async def test_same_sku_in_another_company_is_fine(client, customer, other_customer):
    await _create(client, customer)
    await _create(client, other_customer)


async def test_patch_changes_only_sent_fields(client, customer):
    item = await _create(client, customer)
    r = await client.patch(f"{URL}/{item['id']}", json={"name": "Big carton", "description": None},
                           headers=customer.headers)
    assert r.status_code == 200
    u = r.json()
    assert u["name"] == "Big carton" and u["description"] is None
    assert u["sku"] == "BOX-1" and u["weight_kg"] == 12.5


async def test_patch_sku_checks_other_items_only(client, customer):
    a = await _create(client, customer)
    b = await _create(client, customer, sku="BOX-2", name="Second")
    # Re-sending its own SKU is not a conflict.
    assert (await client.patch(f"{URL}/{a['id']}", json={"sku": "BOX-1"},
                               headers=customer.headers)).status_code == 200
    r = await client.patch(f"{URL}/{b['id']}", json={"sku": "BOX-1"}, headers=customer.headers)
    assert r.status_code == 409 and "BOX-1" in r.json()["detail"]
    r = await client.patch(f"{URL}/{b['id']}", json={"sku": "BOX-3"}, headers=customer.headers)
    assert r.status_code == 200 and r.json()["sku"] == "BOX-3"
    # BOX-2 is free again.
    await _create(client, customer, sku="BOX-2", name="Third")


@pytest.mark.parametrize("body", [
    {"sku": None}, {"name": None}, {"weight_kg": None}, {"volume_m3": None}, {"pallet_spaces": None},
    {"weight_kg": 0}, {"sku": " "},
])
async def test_patch_validation(client, customer, body):
    item = await _create(client, customer)
    assert (await client.patch(f"{URL}/{item['id']}", json=body,
                               headers=customer.headers)).status_code == 422


async def test_delete_archives(client, session, customer):
    item = await _create(client, customer)
    r = await client.delete(f"{URL}/{item['id']}", headers=customer.headers)
    assert r.status_code == 204 and r.content == b""
    assert (await session.get(Item, item["id"])).archived is True
    assert (await client.get(URL, headers=customer.headers)).json() == []
    listed = (await client.get(f"{URL}?include_archived=true", headers=customer.headers)).json()
    assert [(i["id"], i["archived"]) for i in listed] == [(item["id"], True)]
    # Still readable by id (old orders link to it), and deleting again is harmless.
    assert (await client.get(f"{URL}/{item['id']}", headers=customer.headers)).json()["archived"] is True
    assert (await client.delete(f"{URL}/{item['id']}", headers=customer.headers)).status_code == 204


async def test_missing_item_is_404(client, customer):
    for method in ("GET", "PATCH", "DELETE"):
        r = await client.request(method, f"{URL}/999999", json={"name": "x"}, headers=customer.headers)
        assert r.status_code == 404 and r.json() == {"detail": "Item not found."}
