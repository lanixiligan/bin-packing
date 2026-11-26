"""
Builders shared by the ops and driver tests (Agent C). No tests in here.

Typical use:
    world = await make_world(session, customer)          # zone, addresses, items
    orders = await accepted_orders(session, customer, world, [[(world.box, 3)]])
    plan = await create_plan(client, dispatcher, world)  # POST /api/ops/plans
    await finish_job(session, plan["job_id"], [[0, 1], [2]])  # handcrafted SolveResult
    plan = await save_draft(client, dispatcher, plan["id"])
"""

import uuid
from dataclasses import dataclass
from datetime import date

from sqlmodel import select

from app.models import Address, Item, Job, JobStatus, Order, OrderStatus, Plan, Vehicle, utcnow
from app.schemas import Capacity, LowerBounds, MethodResult, PackedLoad, SolveResult
from app.solver import expand_lines, fill_percent, usage_of
from tests.factories import make_address, make_item, make_order, make_vehicle, make_zone, tomorrow


@dataclass
class World:
    zone: str
    pickup: Address
    delivery: Address
    box: Item       # 100 kg, 0.5 m³
    crate: Item     # 400 kg, 1 m³, 1 pallet
    vehicle: Vehicle  # 1000 kg
    day: date


async def make_world(session, customer, *, zone: str = "NORTH", day: date | None = None,
                     vehicle_kg: float = 1000) -> World:
    await make_zone(session, zone)
    pickup = await make_address(session, customer.company, label="Depot")
    delivery = await make_address(session, customer.company, label="Shop", zone=zone, suburb="Chatswood")
    box = await make_item(session, customer.company, sku="BOX", weight_kg=100, volume_m3=0.5)
    crate = await make_item(session, customer.company, sku="CRATE", weight_kg=400, volume_m3=1,
                            pallet_spaces=1)
    vehicle = await make_vehicle(session, max_weight_kg=vehicle_kg)
    return World(zone, pickup, delivery, box, crate, vehicle, day or tomorrow())


async def accepted_orders(session, customer, world: World, orders: list[list[tuple[Item, int]]],
                          *, status: OrderStatus = OrderStatus.accepted,
                          delivery: Address | None = None) -> list[Order]:
    out = []
    for lines in orders:
        out.append(await make_order(
            session, company=customer.company, created_by=customer.user, pickup=world.pickup,
            delivery=delivery or world.delivery, lines=lines, status=status, delivery_date=world.day,
        ))
    return out


async def create_plan(client, dispatcher, world: World, vehicle_id: int | None = None):
    r = await client.post("/api/ops/plans", headers=dispatcher.headers, json={
        "delivery_date": world.day.isoformat(), "zone": world.zone,
        "vehicle_id": vehicle_id or world.vehicle.id,
    })
    assert r.status_code == 202, r.text
    return r.json()


async def reserved_units(session, plan_id: int):
    orders = (await session.exec(
        select(Order).where(Order.plan_id == plan_id).order_by(Order.id)
        .execution_options(populate_existing=True)
    )).all()
    return expand_lines(line for o in orders for line in o.lines)


def _method(units, capacity: Capacity, loads: list[list[int]], status: str) -> MethodResult:
    by_id = {u.id: u for u in units}
    packed = []
    for i, ids in enumerate(loads, start=1):
        usage = usage_of(by_id[u] for u in ids)
        packed.append(PackedLoad(number=i, unit_ids=ids, usage=usage,
                                 fill_percent=fill_percent(usage, capacity)))
    return MethodResult(num_loads=len(loads), loads=packed, solve_time_ms=1.0,
                        drop_order=[u for ids in loads for u in ids], optimal=True, status=status)


def solve_result(units, capacity: Capacity, loads: list[list[int]], *,
                 ortools: bool = True) -> SolveResult:
    return SolveResult(
        capacity=capacity, totals=usage_of(units), lower_bound=len(loads),
        lower_bounds=LowerBounds(weight=len(loads)), units=units,
        ffd=_method(units, capacity, loads, "HEURISTIC"),
        ortools=_method(units, capacity, loads, "OPTIMAL") if ortools else None,
        recommended="ortools" if ortools else "ffd", time_limit_s=10.0,
    )


async def finish_job(session, job_id: str | uuid.UUID, loads: list[list[int]] | None = None, *,
                     ortools: bool = True) -> SolveResult:
    """Mark the plan's job succeeded with a handcrafted result (`loads` = unit ids
    per load; None = every unit on one load)."""
    job = await session.get(Job, uuid.UUID(str(job_id)), populate_existing=True)
    plan = (await session.exec(select(Plan).where(Plan.job_id == job.id))).one()
    units = await reserved_units(session, plan.id)
    capacity = Capacity.model_validate(job.payload["capacity"])
    if loads is None:
        loads = [[u.id for u in units]]
    result = solve_result(units, capacity, loads, ortools=ortools)
    job.status = JobStatus.succeeded
    job.finished_at = utcnow()
    job.result = result.model_dump(mode="json")
    session.add(job)
    await session.commit()
    return result


async def save_draft(client, dispatcher, plan_id: int, method: str = "ortools"):
    r = await client.post(f"/api/ops/plans/{plan_id}/draft", headers=dispatcher.headers,
                          json={"method": method})
    assert r.status_code == 200, r.text
    return r.json()


async def locked_plan(client, session, dispatcher, world: World, loads: list[list[int]] | None = None,
                      drivers: list | None = None):
    """Create, solve (handcrafted), save, assign drivers (one per load, in order) and lock."""
    plan = await create_plan(client, dispatcher, world)
    await finish_job(session, plan["job_id"], loads)
    plan = await save_draft(client, dispatcher, plan["id"])
    for load, drv in zip(plan["loads"], drivers or [], strict=False):
        r = await client.patch(f"/api/ops/loads/{load['id']}", headers=dispatcher.headers,
                               json={"driver_id": drv.driver.id})
        assert r.status_code == 200, r.text
    r = await client.post(f"/api/ops/plans/{plan['id']}/lock", headers=dispatcher.headers)
    assert r.status_code == 200, r.text
    return r.json()
