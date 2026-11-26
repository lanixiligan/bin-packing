"""Regression tests for the security review fixes: JWT secret guard, staff identities
in the customer timeline, address moves, CSV formulas, body size limits, the demo
solver's concurrency cap, POD photo headers and the seed guard."""

import os
import subprocess
import sys

from app.config import BACKEND_DIR, Settings, settings
from app.models import OrderEvent, OrderStatus
from app.pricing import csv_text
from app.routers import demo
from app.routers.driver import POD_MAX_BODY_BYTES
from tests.factories import make_address, make_item, make_order, make_zone
from tests.test_driver import run_world, set_status, upload


def _import_config(**env) -> subprocess.CompletedProcess:
    full = {k: v for k, v in os.environ.items() if k not in ("APP_ENV", "JWT_SECRET")} | env
    return subprocess.run([sys.executable, "-c", "import app.config"], cwd=BACKEND_DIR, env=full,
                          capture_output=True, text=True)


def test_app_env_defaults_to_prod():
    assert Settings.model_fields["APP_ENV"].default == "prod"


def test_jwt_secret_guard():
    weak = _import_config(APP_ENV="prod", JWT_SECRET="changeme")
    assert weak.returncode != 0 and "JWT_SECRET" in weak.stderr
    default = _import_config(APP_ENV="prod", JWT_SECRET="dev-only-change-me")
    assert default.returncode != 0
    strong = _import_config(APP_ENV="prod", JWT_SECRET="x" * 40)
    assert strong.returncode == 0, strong.stderr
    dev = _import_config(APP_ENV="dev", JWT_SECRET="dev-only-change-me")
    assert dev.returncode == 0, dev.stderr


async def _order_with_staff_event(session, customer, dispatcher):
    pickup = await make_address(session, customer.company, label="Yard")
    delivery = await make_address(session, customer.company, label="Site")
    item = await make_item(session, customer.company)
    order = await make_order(session, company=customer.company, created_by=customer.user,
                             pickup=pickup, delivery=delivery, lines=[(item, 1)],
                             status=OrderStatus.submitted)
    session.add(OrderEvent(order_id=order.id, from_status=OrderStatus.submitted,
                           to_status=OrderStatus.rejected, actor_id=dispatcher.user.id, note="No"))
    await session.commit()
    return order


async def test_customer_timeline_hides_staff_ids_and_emails(client, session, customer, dispatcher):
    order = await _order_with_staff_event(session, customer, dispatcher)
    mine = (await client.get(f"/api/portal/orders/{order.id}", headers=customer.headers)).json()
    own, staff = mine["events"]
    assert own["actor_id"] == str(customer.user.id) and own["actor_role"] == "customer"
    assert staff["actor_id"] is None and staff["actor_role"] == "dispatcher"
    assert staff["actor_name"] == dispatcher.user.full_name
    assert dispatcher.user.email not in str(mine)

    ops = (await client.get(f"/api/ops/orders/{order.id}", headers=dispatcher.headers)).json()
    assert ops["events"][1]["actor_id"] == str(dispatcher.user.id)


async def test_customer_timeline_never_falls_back_to_staff_email(client, session, customer,
                                                                 dispatcher):
    order = await _order_with_staff_event(session, customer, dispatcher)
    dispatcher.user.full_name = ""
    session.add(dispatcher.user)
    await session.commit()
    mine = (await client.get(f"/api/portal/orders/{order.id}", headers=customer.headers)).json()
    assert mine["events"][1]["actor_name"] is None
    assert dispatcher.user.email not in str(mine)


async def test_moving_an_address_clears_its_zone(client, session, customer):
    await make_zone(session, "NORTH")
    addr = await make_address(session, customer.company, zone="NORTH", suburb="Chatswood")
    url = f"/api/portal/addresses/{addr.id}"
    r = await client.patch(url, json={"label": "Renamed", "suburb": "Chatswood"}, headers=customer.headers)
    assert r.status_code == 200 and r.json()["zone"] == "NORTH"  # same location: zone kept
    r = await client.patch(url, json={"suburb": "Broome", "state": "WA"}, headers=customer.headers)
    assert r.status_code == 200 and r.json()["zone"] is None


async def test_address_on_a_submitted_order_cannot_move(client, session, customer):
    await make_zone(session, "NORTH")
    pickup = await make_address(session, customer.company, label="Yard")
    delivery = await make_address(session, customer.company, label="Site", zone="NORTH")
    item = await make_item(session, customer.company)
    await make_order(session, company=customer.company, created_by=customer.user, pickup=pickup,
                     delivery=delivery, lines=[(item, 1)], status=OrderStatus.delivered)
    for addr in (pickup, delivery):
        r = await client.patch(f"/api/portal/addresses/{addr.id}", json={"line1": "1 New St"},
                               headers=customer.headers)
        assert r.status_code == 409, r.text
    r = await client.patch(f"/api/portal/addresses/{delivery.id}",
                           json={"label": "Site (main gate)", "phone": "02 9000 0000"},
                           headers=customer.headers)
    assert r.status_code == 200 and r.json()["zone"] == "NORTH"


def test_csv_text_neutralises_formulas():
    for payload in ("=cmd|' /C calc'!A0", "+1+1", "-2", "@SUM(A1)", "\t=1", "\r=1"):
        assert csv_text(payload) == "'" + payload
    assert csv_text("Chatswood") == "Chatswood" and csv_text("") == ""


async def test_oversized_bodies_are_rejected_before_auth(client):
    r = await client.post("/api/portal/orders/1/cancel", content=b"x" * (2 * 1024 * 1024),
                          headers={"content-type": "application/json"})
    assert r.status_code == 413
    r = await client.post("/api/driver/orders/1/pod", data={"signed_by": "x"},
                          files={"photo": ("a.jpg", b"x" * (POD_MAX_BODY_BYTES + 1), "image/jpeg")})
    assert r.status_code == 413
    r = await client.post("/api/driver/orders/1/pod", data={"signed_by": "x"},
                          files={"photo": ("a.jpg", b"x" * settings.MAX_UPLOAD_BYTES, "image/jpeg")})
    assert r.status_code == 401  # a full-size photo still reaches the auth check


async def test_demo_solve_is_capped(client):
    body = {"capacity": 100, "shipments": [{"name": "A", "weight": 60}, {"name": "B", "weight": 50}]}
    held = [demo._solve_slots.acquire(blocking=False) for _ in range(demo.MAX_CONCURRENT_SOLVES)]
    try:
        assert all(held)
        r = await client.post("/api/solve", json=body)
        assert r.status_code == 429 and "busy" in r.json()["detail"]
    finally:
        for _ in held:
            demo._solve_slots.release()
    r = await client.post("/api/solve", json=body)
    assert r.status_code == 200 and r.json()["ortools"]["num_trucks"] == 2


async def test_pod_photo_headers(client, session, dispatcher, customer, driver, make_actor):
    from app.models import UserRole
    driver2 = await make_actor(UserRole.driver)
    _, (a, _), _ = await run_world(client, session, dispatcher, customer, [driver, driver2])
    await set_status(client, driver, a.id, "picked_up")
    await set_status(client, driver, a.id, "in_transit")
    pod = (await upload(client, driver, a.id)).json()["pods"][0]
    r = await client.get(pod["photo_url"], headers=customer.headers)
    assert r.status_code == 200
    assert r.headers["x-content-type-options"] == "nosniff"
    assert r.headers["content-disposition"] == f'inline; filename="pod-{pod["id"]}.jpg"'
    assert "no-store" in r.headers["cache-control"]


def test_seed_refuses_outside_dev():
    env = {k: v for k, v in os.environ.items() if k != "APP_ENV"} | {
        "APP_ENV": "prod", "JWT_SECRET": "x" * 40, "DATABASE_URL": "postgresql+asyncpg://nobody@127.0.0.1:1/x"}
    r = subprocess.run([sys.executable, "-m", "scripts.seed"], cwd=BACKEND_DIR, env=env,
                       capture_output=True, text=True)
    assert r.returncode != 0 and "APP_ENV=dev" in r.stderr
