"""The demo seed (scripts/seed.py) runs against the test DB and produces consistent data."""

from collections import Counter, defaultdict
from datetime import timedelta

import pytest
from sqlmodel import select

from app.config import settings
from app.lifecycle import TRANSITIONS
from app.models import (
    Address,
    Driver,
    Item,
    Job,
    JobStatus,
    Load,
    LoadAssignment,
    Order,
    OrderEvent,
    OrderStatus,
    Plan,
    PlanStatus,
    ProofOfDelivery,
    User,
    UserRole,
    Vehicle,
    utcnow,
)
from app.schemas import Capacity, SolveJobPayload, SolveResult
from app.solver import exceeded, expand_lines, usage_of
from scripts import seed as seed_script

S = OrderStatus
PAST_PLANNED = {S.planned, S.picked_up, S.in_transit, S.delivered}


@pytest.fixture
async def seeded(session):
    async with seed_script.SessionLocal() as s:
        counts = await seed_script.seed(s)
    return counts


async def test_counts(seeded, session):
    assert seeded["companies"] == 1 and seeded["users"] == 5 and seeded["drivers"] == 2
    assert seeded["zones"] == 3 and seeded["vehicles"] == 4
    assert 14 <= seeded["addresses"] <= 16 and 18 <= seeded["items"] <= 22
    assert 28 <= seeded["orders"] <= 40
    roles = Counter(u.role for u in (await session.exec(select(User))).all())
    assert roles == {UserRole.customer: 2, UserRole.dispatcher: 1, UserRole.driver: 2}
    zones = Counter(a.zone for a in (await session.exec(select(Address))).all())
    assert set(zones) == {"NORTH", "SOUTH", "WEST", None} and 1 <= zones[None] <= 2
    statuses = Counter(o.status for o in (await session.exec(select(Order))).all())
    assert set(statuses) == set(S)  # every status is represented
    assert statuses[S.rejected] == 1 and statuses[S.cancelled] == 1 and statuses[S.exception] == 1
    assert statuses[S.submitted] >= 2 and statuses[S.draft] >= 2


async def test_seed_logins_work(seeded, client):
    for email in ("alice@acme.example.com", "bob@acme.example.com", "dispatch@freightco.example.com",
                  "driver1@freightco.example.com", "driver2@freightco.example.com"):
        r = await client.post("/api/auth/jwt/login",
                              data={"username": email, "password": seed_script.SEED_PASSWORD})
        assert r.status_code == 200, email
    me = (await client.get("/api/users/me", headers={
        "Authorization": f"Bearer {r.json()['access_token']}"})).json()
    assert me["role"] == "driver" and me["driver_id"] is not None


async def test_every_event_history_is_valid(seeded, session):
    users = {u.id: u for u in (await session.exec(select(User))).all()}
    events = defaultdict(list)
    for e in (await session.exec(select(OrderEvent).order_by(OrderEvent.id))).all():
        events[e.order_id].append(e)
    now = utcnow()
    for order in (await session.exec(select(Order))).all():
        chain = events[order.id]
        assert chain[0].from_status is None and chain[0].to_status == S.draft, order.id
        assert chain[0].actor_id == order.created_by_id
        assert chain[0].created_at == order.created_at
        for prev, ev in zip(chain, chain[1:], strict=False):
            assert ev.from_status == prev.to_status, order.id
            assert users[ev.actor_id].role in TRANSITIONS[(ev.from_status, ev.to_status)], order.id
            assert ev.created_at > prev.created_at, order.id
        assert chain[-1].to_status == order.status, order.id
        assert chain[-1].created_at <= now and order.updated_at == chain[-1].created_at
        if order.status == S.rejected:
            assert chain[-1].note
        if order.status == S.exception:
            assert chain[-1].note and chain[-2].to_status == S.picked_up


async def test_quotes_dates_and_reservations(seeded, session):
    today = settings.today()
    orders = (await session.exec(select(Order))).all()
    for o in orders:
        assert (o.quote_id is None) == (o.status == S.draft), o.id
        assert (o.submitted_at is None) == (o.status == S.draft)
        assert (o.delivered_at is not None) == (o.status == S.delivered)
        assert (o.plan_id is not None) == (o.status in PAST_PLANNED | {S.exception}), o.id
        if o.status in (S.draft, S.submitted, S.accepted):
            assert o.delivery_date >= today
        if o.quote and o.delivery_address.zone is None:
            assert o.quote.provisional
    # Unplanned accepted orders for today and tomorrow in every zone (for the optimiser demo).
    for day in (today, today + timedelta(days=1)):
        zones = {o.delivery_address.zone for o in orders
                 if o.status == S.accepted and o.plan_id is None and o.delivery_date == day}
        assert {"NORTH", "SOUTH", "WEST"} <= zones, day
    # Invoice data last month.
    first = today.replace(day=1)
    last_month = [o for o in orders if o.delivered_at
                  and o.delivered_at.astimezone(settings.tz).date() < first]
    assert len(last_month) >= 3
    assert {o.delivery_date for o in orders} >= {today - timedelta(days=1), today,
                                                 today + timedelta(days=1), today + timedelta(days=2)}


async def test_items_fit_the_bigger_vehicles(seeded, session):
    vehicles = (await session.exec(select(Vehicle))).all()
    caps = [Capacity(weight_kg=v.max_weight_kg, volume_m3=v.max_volume_m3, pallets=v.max_pallets)
            for v in vehicles]
    assert len({(c.weight_kg, c.volume_m3, c.pallets) for c in caps}) == 4
    for item in (await session.exec(select(Item))).all():
        fits = [not exceeded(usage_of([_unit(item)]), c) for c in caps]
        assert sum(fits) >= 2, item.sku


def _unit(item: Item):
    from app.schemas import PackUnit
    return PackUnit(id=0, order_id=0, order_reference="x", order_line_id=0, item_name=item.name,
                    item_sku=item.sku, weight_kg=item.weight_kg, volume_m3=item.volume_m3,
                    pallets=item.pallet_spaces)


async def test_plans_loads_and_jobs_are_consistent(seeded, session):
    today = settings.today()
    plans = (await session.exec(select(Plan))).all()
    assert plans and all(p.status == PlanStatus.locked and p.locked_at for p in plans)
    for plan in plans:
        job = await session.get(Job, plan.job_id)
        assert job.status == JobStatus.succeeded and job.finished_at
        payload = SolveJobPayload.model_validate(job.payload)
        result = SolveResult.model_validate(job.result)
        orders = (await session.exec(select(Order).where(Order.plan_id == plan.id))).all()
        assert set(payload.order_ids) == {o.id for o in orders} and payload.plan_id == plan.id
        assert all(o.delivery_date == plan.delivery_date for o in orders)
        assert all(o.delivery_address.zone == plan.zone for o in orders)
        assert len(result.units) == sum(ln.quantity for o in orders for ln in o.lines)
        assert result.ffd.num_loads == len(plan.loads)
        cap = payload.capacity
        assigned: Counter = Counter()
        for load in plan.loads:
            assert load.vehicle_id is not None and load.driver_id is not None
            units = [u for a in load.assignments for u in expand_lines([a.order_line])[: a.quantity]]
            assert not exceeded(usage_of(units), cap), (plan.id, load.number)
            for a in load.assignments:
                assigned[a.order_line_id] += a.quantity
        assert assigned == Counter({ln.id: ln.quantity for o in orders for ln in o.lines})
    # Both drivers have a run today.
    drivers_today = {ld.driver_id for p in plans if p.delivery_date == today for ld in p.loads}
    all_drivers = {d.id for d in (await session.exec(select(Driver))).all()}
    assert drivers_today == all_drivers


async def test_driver_steps_are_done_by_the_load_driver(seeded, session):
    drivers = {d.user_id: d.id for d in (await session.exec(select(Driver))).all()}
    for order in (await session.exec(select(Order).where(Order.plan_id.is_not(None)))).all():
        load_drivers = {ld.driver_id for ld in (await session.exec(
            select(Load).join(LoadAssignment).where(
                LoadAssignment.order_line_id.in_([ln.id for ln in order.lines])))).all()}
        for ev in order.events:
            if ev.to_status in (S.picked_up, S.in_transit, S.delivered, S.exception):
                assert drivers[ev.actor_id] in load_drivers, order.id


async def test_delivered_orders_have_a_pod_photo(seeded, session):
    delivered = (await session.exec(select(Order).where(Order.status == S.delivered))).all()
    pods = {p.order_id: p for p in (await session.exec(select(ProofOfDelivery))).all()}
    assert set(pods) == {o.id for o in delivered}
    for o in delivered:
        pod = pods[o.id]
        data = (settings.upload_dir / pod.photo_path).read_bytes()
        assert data.startswith(b"\x89PNG\r\n\x1a\n") and pod.photo_content_type == "image/png"
        assert pod.signed_by and pod.load_id is not None and pod.created_at == o.delivered_at


async def test_seed_is_repeatable(seeded, session):
    async with seed_script.SessionLocal() as s:
        again = await seed_script.seed(s)
    assert again == seeded
    assert (await session.exec(select(Order).order_by(Order.id))).first().id == 1  # identities reset
