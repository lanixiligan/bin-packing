"""Driver API: today's run, status changes, proof of delivery and POD photos."""

import dataclasses
from datetime import timedelta

import pytest
from sqlmodel import func, select

from app.config import settings
from app.models import Order, OrderEvent, OrderStatus, ProofOfDelivery, UserRole
from app.routers import driver as driver_router
from tests.factories import make_address, make_zone
from tests.test_ops_setup import (
    accepted_orders,
    create_plan,
    finish_job,
    locked_plan,
    make_world,
    save_draft,
)

JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 64
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
WEBP = b"RIFF\x24\x00\x00\x00WEBPVP8 " + b"\x00" * 64


@pytest.fixture
async def driver2(make_actor):
    return await make_actor(UserRole.driver)


async def run_world(client, session, dispatcher, customer, drivers, loads=None):
    """Order A: 6 boxes (units 0-5), order B: crate + 2 boxes (units 6-8), delivered
    today, in a locked plan whose loads go to `drivers` in order."""
    world = await make_world(session, customer, day=settings.today())
    orders = await accepted_orders(session, customer, world, [
        [(world.box, 6)],
        [(world.crate, 1), (world.box, 2)],
    ])
    plan = await locked_plan(client, session, dispatcher, world,
                             loads or [[0, 1, 2, 3, 4, 5], [6, 7, 8]], drivers)
    return world, orders, plan


async def set_status(client, actor, order_id, status, note=None):
    body = {"status": status} | ({"note": note} if note else {})
    return await client.post(f"/api/driver/orders/{order_id}/status", headers=actor.headers, json=body)


async def upload(client, actor, order_id, data=JPEG, filename="photo.jpg", content_type="image/jpeg",
                 signed_by="Pat Receiver", note=None):
    form = {"signed_by": signed_by} | ({"note": note} if note else {})
    return await client.post(f"/api/driver/orders/{order_id}/pod", headers=actor.headers, data=form,
                             files={"photo": (filename, data, content_type)})


async def event_count(session, order_id, to_status):
    return (await session.exec(select(func.count()).select_from(OrderEvent).where(
        OrderEvent.order_id == order_id, OrderEvent.to_status == to_status))).one()


def stored_photos() -> set[str]:
    folder = settings.upload_dir / "pod"
    return {p.name for p in folder.iterdir()} if folder.exists() else set()


# ---- run ---------------------------------------------------------------------------

async def test_run_shows_own_loads_in_locked_plans_for_the_date(client, session, dispatcher, customer,
                                                                driver, driver2):
    world, (a, b), plan = await run_world(client, session, dispatcher, customer, [driver, driver2])

    # A draft plan for the same day with a load for `driver`: not part of the run.
    await make_zone(session, "SOUTH")
    south = await make_address(session, customer.company, label="South shop", zone="SOUTH")
    south_world = dataclasses.replace(world, zone="SOUTH", delivery=south)
    await accepted_orders(session, customer, south_world, [[(world.box, 1)]])
    draft = await create_plan(client, dispatcher, south_world)
    await finish_job(session, draft["job_id"])
    draft = await save_draft(client, dispatcher, draft["id"])
    await client.patch(f"/api/ops/loads/{draft['loads'][0]['id']}", headers=dispatcher.headers,
                       json={"driver_id": driver.driver.id})

    r = await client.get("/api/driver/run", headers=driver.headers)  # default: today
    assert r.status_code == 200, r.text
    run = r.json()
    assert run["date"] == settings.today().isoformat()
    assert run["driver"]["id"] == driver.driver.id and run["driver"]["email"] == driver.user.email
    (load,) = run["loads"]
    assert load["load_id"] == plan["loads"][0]["id"] and load["number"] == 1
    assert load["plan_id"] == plan["id"] and load["zone"] == "NORTH" and load["vehicle"] is None
    (order,) = load["orders"]
    assert order["order_id"] == a.id and order["reference"] == a.reference
    assert order["status"] == "planned" and order["load_id"] == load["load_id"]
    assert order["lines"] == [{"item_name": "Item BOX", "item_sku": "BOX", "quantity": 6,
                               "dg_class": None, "un_number": None}]
    assert order["total_weight_kg"] == 600.0
    assert order["next_statuses"] == ["picked_up", "exception"]
    assert order["pickup_address"]["label"] == "Depot" and order["delivery_address"]["label"] == "Shop"
    assert order["company_name"] == "Acme Pty Ltd" and order["pods"] == []

    r = await client.get("/api/driver/run", headers=driver2.headers,
                         params={"date": settings.today().isoformat()})
    (load2,) = r.json()["loads"]
    assert [o["order_id"] for o in load2["orders"]] == [b.id]
    assert {ln["item_sku"]: ln["quantity"] for ln in load2["orders"][0]["lines"]} == {"CRATE": 1, "BOX": 2}

    other_day = (settings.today() + timedelta(days=1)).isoformat()
    r = await client.get("/api/driver/run", headers=driver.headers, params={"date": other_day})
    assert r.json()["loads"] == []


async def test_run_lists_only_the_units_on_this_load(client, session, dispatcher, customer, driver, driver2):
    _, (a, b), _ = await run_world(client, session, dispatcher, customer, [driver, driver2],
                                   loads=[[0, 1, 2, 3, 6, 7], [4, 5, 8]])
    run1 = (await client.get("/api/driver/run", headers=driver.headers)).json()
    run2 = (await client.get("/api/driver/run", headers=driver2.headers)).json()
    on1 = {o["order_id"]: o for o in run1["loads"][0]["orders"]}
    on2 = {o["order_id"]: o for o in run2["loads"][0]["orders"]}
    assert on1[a.id]["lines"][0]["quantity"] == 4 and on2[a.id]["lines"][0]["quantity"] == 2
    assert on1[b.id]["total_weight_kg"] == 500.0 and on2[b.id]["total_weight_kg"] == 100.0


async def test_driver_order_is_only_visible_to_its_driver(client, session, dispatcher, customer, driver,
                                                          driver2, make_actor):
    _, (a, b), _ = await run_world(client, session, dispatcher, customer, [driver, driver2])
    r = await client.get(f"/api/driver/orders/{a.id}", headers=driver.headers)
    assert r.status_code == 200 and r.json()["order_id"] == a.id
    assert (await client.get(f"/api/driver/orders/{a.id}", headers=driver2.headers)).status_code == 404
    assert (await set_status(client, driver2, a.id, "picked_up")).status_code == 404
    assert (await upload(client, driver2, a.id)).status_code == 404
    stranger = await make_actor(UserRole.driver)
    assert (await client.get(f"/api/driver/orders/{b.id}", headers=stranger.headers)).status_code == 404
    assert (await client.get("/api/driver/orders/999", headers=driver.headers)).status_code == 404


async def test_orders_in_draft_plans_are_not_visible(client, session, dispatcher, customer, driver):
    world = await make_world(session, customer, day=settings.today())
    order, = await accepted_orders(session, customer, world, [[(world.box, 1)]])
    plan = await create_plan(client, dispatcher, world)
    await finish_job(session, plan["job_id"])
    plan = await save_draft(client, dispatcher, plan["id"])
    await client.patch(f"/api/ops/loads/{plan['loads'][0]['id']}", headers=dispatcher.headers,
                       json={"driver_id": driver.driver.id})
    assert (await client.get(f"/api/driver/orders/{order.id}", headers=driver.headers)).status_code == 404
    assert (await client.get("/api/driver/run", headers=driver.headers)).json()["loads"] == []


# ---- status ------------------------------------------------------------------------------

async def test_full_delivery_flow(client, session, dispatcher, customer, driver, driver2):
    _, (a, _), _ = await run_world(client, session, dispatcher, customer, [driver, driver2])

    assert (await set_status(client, driver, a.id, "in_transit")).status_code == 409  # not picked up yet
    r = await set_status(client, driver, a.id, "picked_up")
    assert r.status_code == 200 and r.json()["status"] == "picked_up"
    assert r.json()["next_statuses"] == ["in_transit", "exception"]
    r = await set_status(client, driver, a.id, "in_transit")
    assert r.json()["status"] == "in_transit" and r.json()["next_statuses"] == ["delivered", "exception"]

    r = await upload(client, driver, a.id, note="Left at the loading dock")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "delivered" and body["next_statuses"] == []
    (pod,) = body["pods"]
    assert pod["signed_by"] == "Pat Receiver" and pod["note"] == "Left at the loading dock"
    assert pod["driver_name"] == driver.user.full_name
    assert pod["photo_url"] == f"/api/pods/{pod['id']}/photo"

    order = await session.get(Order, a.id, populate_existing=True)
    assert order.delivered_at is not None
    assert [(e.to_status, e.actor_id) for e in order.events[-3:]] == [
        (OrderStatus.picked_up, driver.user.id), (OrderStatus.in_transit, driver.user.id),
        (OrderStatus.delivered, driver.user.id)]

    row = await session.get(ProofOfDelivery, pod["id"])
    assert row.photo_content_type == "image/jpeg" and row.photo_path.startswith("pod/")
    assert row.photo_path.endswith(".jpg") and "photo" not in row.photo_path
    assert (settings.upload_dir / row.photo_path).read_bytes() == JPEG

    r = await client.get(pod["photo_url"], headers=driver.headers)
    assert r.status_code == 200 and r.content == JPEG and r.headers["content-type"] == "image/jpeg"

    # The customer sees the POD on their order.
    r = await client.get(f"/api/ops/orders/{a.id}", headers=dispatcher.headers)
    assert r.json()["pods"][0]["id"] == pod["id"]


async def test_exception_needs_a_note(client, session, dispatcher, customer, driver, driver2):
    _, (a, _), _ = await run_world(client, session, dispatcher, customer, [driver, driver2])
    assert (await set_status(client, driver, a.id, "exception")).status_code == 422
    assert (await set_status(client, driver, a.id, "exception", note="  ")).status_code == 422
    assert (await set_status(client, driver, a.id, "delivered")).status_code == 422
    r = await set_status(client, driver, a.id, "exception", note="Gate locked, nobody on site")
    assert r.status_code == 200 and r.json()["status"] == "exception" and r.json()["next_statuses"] == []
    order = await session.get(Order, a.id, populate_existing=True)
    assert order.events[-1].note == "Gate locked, nobody on site"
    assert (await set_status(client, driver, a.id, "picked_up")).status_code == 409
    assert (await upload(client, driver, a.id)).status_code == 409


async def test_split_order_status_changes_are_idempotent(client, session, dispatcher, customer, driver,
                                                         driver2):
    # Order B: crate on load 1 (driver), 2 boxes on load 2 (driver2).
    _, (_, b), _ = await run_world(client, session, dispatcher, customer, [driver, driver2],
                                   loads=[[0, 1, 2, 3, 4, 5, 6], [7, 8]])
    for status in ("picked_up", "in_transit"):
        r1 = await set_status(client, driver, b.id, status)
        r2 = await set_status(client, driver2, b.id, status)
        assert (r1.status_code, r2.status_code) == (200, 200)
        assert r2.json()["status"] == status and r2.json()["load_id"] != r1.json()["load_id"]
        assert await event_count(session, b.id, status) == 1

    # The order is delivered only when every driver carrying part of it has a POD.
    r = await upload(client, driver, b.id)
    assert r.status_code == 200 and r.json()["status"] == "in_transit"
    assert r.json()["next_statuses"] == []  # this driver's part is done
    assert (await client.get(f"/api/driver/orders/{b.id}", headers=driver2.headers)).json()[
        "next_statuses"] == ["delivered", "exception"]
    r = await upload(client, driver2, b.id, data=PNG, filename="x.png", signed_by="Other receiver")
    assert r.status_code == 200 and r.json()["status"] == "delivered"
    assert [p["signed_by"] for p in r.json()["pods"]] == ["Pat Receiver", "Other receiver"]
    assert await event_count(session, b.id, OrderStatus.delivered) == 1
    assert (await upload(client, driver2, b.id)).status_code == 409  # already recorded
    assert (await upload(client, driver, b.id)).status_code == 409


async def test_split_order_later_driver_catches_up(client, session, dispatcher, customer, driver,
                                                   driver2):
    """driver is already in transit when driver2 picks up: driver2's steps are 200
    no-ops, and driver's POD alone doesn't deliver the order."""
    _, (_, b), _ = await run_world(client, session, dispatcher, customer, [driver, driver2],
                                   loads=[[0, 1, 2, 3, 4, 5, 6], [7, 8]])
    await set_status(client, driver, b.id, "picked_up")
    await set_status(client, driver, b.id, "in_transit")
    r = await set_status(client, driver2, b.id, "picked_up")
    assert r.status_code == 200 and r.json()["status"] == "in_transit"
    assert await event_count(session, b.id, OrderStatus.picked_up) == 1
    assert (await upload(client, driver, b.id)).status_code == 200
    order = await session.get(Order, b.id, populate_existing=True)
    assert order.status == OrderStatus.in_transit and order.delivered_at is None
    assert (await set_status(client, driver2, b.id, "in_transit")).status_code == 200
    r = await upload(client, driver2, b.id, data=PNG, filename="x.png")
    assert r.status_code == 200 and r.json()["status"] == "delivered"


# ---- POD upload ------------------------------------------------------------------------------

async def in_transit(client, session, dispatcher, customer, driver, driver2):
    _, (a, b), _ = await run_world(client, session, dispatcher, customer, [driver, driver2])
    await set_status(client, driver, a.id, "picked_up")
    await set_status(client, driver, a.id, "in_transit")
    return a, b


async def test_pod_accepts_png_and_webp_by_content(client, session, dispatcher, customer, driver, driver2):
    a, b = await in_transit(client, session, dispatcher, customer, driver, driver2)
    # The client's name and content type are ignored: the bytes decide.
    r = await upload(client, driver, a.id, data=WEBP, filename="../../evil.exe",
                     content_type="application/octet-stream")
    assert r.status_code == 200, r.text
    row = await session.get(ProofOfDelivery, r.json()["pods"][0]["id"])
    assert row.photo_content_type == "image/webp" and row.photo_path.endswith(".webp")
    assert "evil" not in row.photo_path

    await set_status(client, driver2, b.id, "picked_up")
    await set_status(client, driver2, b.id, "in_transit")
    r = await upload(client, driver2, b.id, data=PNG, content_type="image/jpeg")
    row = await session.get(ProofOfDelivery, r.json()["pods"][0]["id"])
    assert row.photo_content_type == "image/png"


async def test_pod_rejects_files_that_are_not_images(client, session, dispatcher, customer, driver,
                                                     driver2):
    a, _ = await in_transit(client, session, dispatcher, customer, driver, driver2)
    before = stored_photos()
    for data in (b"just some text pretending", b"RIFF\x00\x00\x00\x00WAVEfmt ", b"\xff\xd8", b""):
        r = await upload(client, driver, a.id, data=data)
        assert r.status_code == 415, (data, r.text)
    assert stored_photos() == before
    assert (await session.get(Order, a.id, populate_existing=True)).status == OrderStatus.in_transit


async def test_pod_too_large(client, session, dispatcher, customer, driver, driver2, monkeypatch):
    a, _ = await in_transit(client, session, dispatcher, customer, driver, driver2)
    monkeypatch.setattr(settings, "MAX_UPLOAD_BYTES", len(JPEG) - 1)
    r = await upload(client, driver, a.id)
    assert r.status_code == 413
    monkeypatch.setattr(settings, "MAX_UPLOAD_BYTES", len(JPEG))
    assert (await upload(client, driver, a.id)).status_code == 200


async def test_pod_needs_an_order_in_transit(client, session, dispatcher, customer, driver, driver2):
    _, (a, _), _ = await run_world(client, session, dispatcher, customer, [driver, driver2])
    before = stored_photos()
    r = await upload(client, driver, a.id)
    assert r.status_code == 409 and "in transit" in r.json()["detail"]
    await set_status(client, driver, a.id, "picked_up")
    assert (await upload(client, driver, a.id)).status_code == 409
    assert stored_photos() == before
    await set_status(client, driver, a.id, "in_transit")
    assert (await upload(client, driver, a.id, signed_by="   ")).status_code == 422
    r = await client.post(f"/api/driver/orders/{a.id}/pod", headers=driver.headers,
                          data={"signed_by": "Pat"})
    assert r.status_code == 422  # no photo


async def test_pod_file_is_removed_when_saving_fails(client, session, dispatcher, customer, driver,
                                                     driver2, monkeypatch):
    a, _ = await in_transit(client, session, dispatcher, customer, driver, driver2)
    before = stored_photos()

    async def broken(*args, **kwargs):
        raise RuntimeError("database fell over")

    monkeypatch.setattr(driver_router, "transition", broken)
    with pytest.raises(RuntimeError):
        await upload(client, driver, a.id)
    assert stored_photos() == before
    assert (await session.exec(select(func.count()).select_from(ProofOfDelivery))).one() == 0


# ---- POD photos ------------------------------------------------------------------------------

async def test_pod_photo_access(client, session, dispatcher, customer, other_customer, driver, driver2,
                                make_actor):
    # Order B is split over both drivers' loads; driver delivers it.
    _, (a, b), _ = await run_world(client, session, dispatcher, customer, [driver, driver2],
                                   loads=[[0, 1, 2, 3, 4, 5, 6], [7, 8]])
    for status in ("picked_up", "in_transit"):
        await set_status(client, driver, b.id, status)
    pod = (await upload(client, driver, b.id)).json()["pods"][0]
    url = pod["photo_url"]
    same_company = await make_actor(UserRole.customer, company=customer.company)
    stranger = await make_actor(UserRole.driver)

    assert (await client.get(url)).status_code == 401
    for actor, expected in ((customer, 200), (same_company, 200), (dispatcher, 200), (driver, 200),
                            (driver2, 200), (other_customer, 404), (stranger, 404)):
        r = await client.get(url, headers=actor.headers)
        assert r.status_code == expected, (actor.user.email, r.text)
    assert (await client.get("/api/pods/999/photo", headers=dispatcher.headers)).status_code == 404


async def test_pod_photo_path_must_stay_inside_the_upload_dir(client, session, dispatcher, customer,
                                                              driver, driver2):
    a, _ = await in_transit(client, session, dispatcher, customer, driver, driver2)
    pod_id = (await upload(client, driver, a.id)).json()["pods"][0]["id"]
    row = await session.get(ProofOfDelivery, pod_id)
    row.photo_path = "../../../../etc/hostname"
    session.add(row)
    await session.commit()
    assert (await client.get(f"/api/pods/{pod_id}/photo", headers=dispatcher.headers)).status_code == 404


# ---- roles ---------------------------------------------------------------------------------

DRIVER_ROUTES = [
    ("GET", "/api/driver/run"), ("GET", "/api/driver/orders/1"),
    ("POST", "/api/driver/orders/1/status"), ("POST", "/api/driver/orders/1/pod"),
]


@pytest.mark.parametrize(("method", "path"), DRIVER_ROUTES)
async def test_driver_routes_need_a_driver(client, customer, dispatcher, method, path):
    assert (await client.request(method, path)).status_code == 401
    assert (await client.request(method, path, headers=customer.headers)).status_code == 403
    assert (await client.request(method, path, headers=dispatcher.headers)).status_code == 403


async def test_inactive_driver_profile_is_forbidden(client, session, driver):
    driver.driver.active = False
    session.add(driver.driver)
    await session.commit()
    assert (await client.get("/api/driver/run", headers=driver.headers)).status_code == 403
