"""
Dispatcher API: /api/ops/*. Owner: Agent C. Every route requires role=dispatcher.
"""

import logging
from collections import Counter
from collections.abc import Iterable
from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import func, update
from sqlalchemy.exc import IntegrityError
from sqlmodel import col, select
from sqlmodel.ext.asyncio.session import AsyncSession

from app import pricing, workers
from app.auth import DispatcherUser, create_user
from app.config import settings
from app.db import get_session
from app.lifecycle import transition
from app.models import (
    Address,
    Company,
    Driver,
    Job,
    JobKind,
    JobStatus,
    Load,
    LoadAssignment,
    Order,
    OrderLine,
    OrderStatus,
    Plan,
    PlanStatus,
    User,
    UserRole,
    Vehicle,
    Zone,
    utcnow,
)
from app.schemas import (
    MONTH_PATTERN,
    AddressZoneUpdate,
    BatchSummary,
    Capacity,
    DriverCreate,
    DriverRead,
    DriverUpdate,
    InfeasibleDetail,
    Invoice,
    InvoiceSummary,
    LineMove,
    LoadLineRead,
    LoadRead,
    LoadUpdate,
    OpsAddressRead,
    OrderRead,
    OrderSummary,
    PlanCreate,
    PlanRead,
    PlanSaveDraft,
    PlanSummary,
    RejectBody,
    SolveJobPayload,
    SolveResult,
    StatusNote,
    Usage,
    VehicleCreate,
    VehicleRead,
    VehicleUpdate,
    ZoneCreate,
    ZoneRead,
    ZoneUpdate,
)
from app.serializers import order_read, order_summary
from app.solver import exceeded, expand_lines, fill_percent, find_misfits

log = logging.getLogger(__name__)

router = APIRouter()
Session = Annotated[AsyncSession, Depends(get_session)]
Month = Annotated[str, Query(pattern=MONTH_PATTERN, description='"YYYY-MM"')]

NO_ZONE = "none"  # query value meaning "delivery address has no zone"


def _not_found(what: str) -> HTTPException:
    return HTTPException(status.HTTP_404_NOT_FOUND, f"{what} not found.")


def _conflict(message: str) -> HTTPException:
    return HTTPException(status.HTTP_409_CONFLICT, message)


def _unprocessable(detail) -> HTTPException:
    return HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail)


def _zone_code(value: str) -> str:
    return value.strip().upper()


# ---- Order queue ----------------------------------------------------------------

async def _order_or_404(session: AsyncSession, order_id: int, *, lock: bool = False) -> Order:
    """A non-draft order (drafts are private to the customer)."""
    query = (select(Order).where(Order.id == order_id, Order.status != OrderStatus.draft)
             .execution_options(populate_existing=True))
    if lock:
        query = query.with_for_update()
    order = (await session.exec(query)).first()
    if order is None:
        raise _not_found("Order")
    return order


async def _order_detail(session: AsyncSession, order_id: int) -> OrderRead:
    order = await session.get(Order, order_id, populate_existing=True)
    return await order_read(session, order)


@router.get("/orders", response_model=list[OrderSummary])
async def list_orders(
    user: DispatcherUser,
    session: Session,
    status_: Annotated[list[OrderStatus] | None, Query(alias="status")] = None,
    delivery_date: date | None = None,
    zone: str | None = Query(default=None, description='Zone code, or "none" for unzoned'),
    company_id: int | None = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 200,
    offset: Annotated[int, Query(ge=0)] = 0,
):
    """All companies. Never includes drafts (they're private to the customer).
    Sorted by delivery_date, then id."""
    query = (
        select(Order)
        .join(Address, Address.id == Order.delivery_address_id)
        .where(Order.status != OrderStatus.draft)
    )
    if status_:
        query = query.where(col(Order.status).in_(status_))
    if delivery_date is not None:
        query = query.where(Order.delivery_date == delivery_date)
    if zone is not None:
        if zone.strip().lower() == NO_ZONE:
            query = query.where(col(Address.zone).is_(None))
        else:
            query = query.where(Address.zone == _zone_code(zone))
    if company_id is not None:
        query = query.where(Order.company_id == company_id)
    query = query.order_by(Order.delivery_date, Order.id).offset(offset).limit(limit)
    return [order_summary(o) for o in (await session.exec(query)).all()]


@router.get("/orders/{order_id}", response_model=OrderRead)
async def get_order(order_id: int, user: DispatcherUser, session: Session):
    """404 for drafts."""
    order = await _order_or_404(session, order_id)
    return await order_read(session, order)


@router.post("/orders/{order_id}/accept", response_model=OrderRead)
async def accept_order(order_id: int, user: DispatcherUser, session: Session,
                       body: StatusNote | None = None):
    order = await _order_or_404(session, order_id, lock=True)
    await transition(session, order, OrderStatus.accepted, user, body.note if body else None)
    await session.commit()
    return await _order_detail(session, order_id)


@router.post("/orders/{order_id}/reject", response_model=OrderRead)
async def reject_order(order_id: int, body: RejectBody, user: DispatcherUser, session: Session):
    if not body.note.strip():
        raise _unprocessable("Give a reason for rejecting the order.")
    order = await _order_or_404(session, order_id, lock=True)
    await transition(session, order, OrderStatus.rejected, user, body.note)
    await session.commit()
    return await _order_detail(session, order_id)


@router.get("/batches", response_model=list[BatchSummary])
async def list_batches(user: DispatcherUser, session: Session,
                       from_date: date | None = None, to_date: date | None = None):
    """Accepted + planned orders grouped by delivery_date and zone.

    Unplanned orders are grouped by their delivery address's zone; orders
    reserved by a plan are counted in that plan's date + zone (so re-zoning an
    address later doesn't move them)."""
    def in_range(column, query):
        if from_date is not None:
            query = query.where(column >= from_date)
        if to_date is not None:
            query = query.where(column <= to_date)
        return query

    rows: dict[tuple[date, str | None], dict] = {}

    def row(key: tuple[date, str | None]) -> dict:
        return rows.setdefault(key, {"unplanned": 0, "planned": 0, "weight": 0.0, "volume": 0.0,
                                     "pallets": 0.0, "plan_ids": []})

    unplanned = in_range(Order.delivery_date, (
        select(
            Order.delivery_date, Address.zone,
            func.count(func.distinct(Order.id)),
            func.coalesce(func.sum(OrderLine.quantity * OrderLine.unit_weight_kg), 0.0),
            func.coalesce(func.sum(OrderLine.quantity * OrderLine.unit_volume_m3), 0.0),
            func.coalesce(func.sum(OrderLine.quantity * OrderLine.unit_pallet_spaces), 0.0),
        )
        .join(Address, Address.id == Order.delivery_address_id)
        .join(OrderLine, OrderLine.order_id == Order.id)
        .where(Order.status == OrderStatus.accepted, col(Order.plan_id).is_(None))
        .group_by(Order.delivery_date, Address.zone)
    ))
    for d, zone, count, weight, volume, pallets in (await session.exec(unplanned)).all():
        r = row((d, zone))
        r.update(unplanned=count, weight=weight, volume=volume, pallets=pallets)

    planned = in_range(Plan.delivery_date, (
        select(Plan.delivery_date, Plan.zone, func.count(Order.id))
        .join(Plan, Plan.id == Order.plan_id)
        .where(col(Order.status).in_([OrderStatus.accepted, OrderStatus.planned]))
        .group_by(Plan.delivery_date, Plan.zone)
    ))
    for d, zone, count in (await session.exec(planned)).all():
        row((d, zone))["planned"] = count

    plans = in_range(Plan.delivery_date, select(Plan.id, Plan.delivery_date, Plan.zone).order_by(Plan.id))
    for plan_id, d, zone in (await session.exec(plans)).all():
        if (d, zone) in rows:
            rows[(d, zone)]["plan_ids"].append(plan_id)

    zone_names = {z.code: z.name for z in (await session.exec(select(Zone))).all()}
    return [
        BatchSummary(
            delivery_date=d, zone=zone, zone_name=zone_names.get(zone) if zone else None,
            unplanned_orders=r["unplanned"], planned_orders=r["planned"],
            total_weight_kg=round(r["weight"], 3), total_volume_m3=round(r["volume"], 4),
            total_pallet_spaces=round(r["pallets"], 3), plan_ids=r["plan_ids"],
        )
        for (d, zone), r in sorted(rows.items(), key=lambda kv: (kv[0][0], kv[0][1] is None,
                                                                 kv[0][1] or ""))
    ]


# ---- Zones and addresses ---------------------------------------------------------

@router.get("/zones", response_model=list[ZoneRead])
async def list_zones(user: DispatcherUser, session: Session):
    return (await session.exec(select(Zone).order_by(Zone.code))).all()


@router.post("/zones", response_model=ZoneRead, status_code=status.HTTP_201_CREATED)
async def create_zone(body: ZoneCreate, user: DispatcherUser, session: Session):
    """409 if the code exists."""
    if await session.get(Zone, body.code) is not None:
        raise _conflict(f"Zone {body.code} already exists.")
    zone = Zone(code=body.code, name=body.name.strip(), rate_per_kg=body.rate_per_kg)
    session.add(zone)
    try:
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        raise _conflict(f"Zone {body.code} already exists.") from exc
    await session.refresh(zone)  # the stored rate has 4 decimals
    return zone


@router.patch("/zones/{code}", response_model=ZoneRead)
async def update_zone(code: str, body: ZoneUpdate, user: DispatcherUser, session: Session):
    zone = await session.get(Zone, _zone_code(code))
    if zone is None:
        raise _not_found("Zone")
    for field, value in body.model_dump(exclude_unset=True).items():
        if value is not None:  # none of a zone's fields can be cleared
            setattr(zone, field, value.strip() if isinstance(value, str) else value)
    await session.commit()
    await session.refresh(zone)
    return zone


def _ops_address(address: Address, company_name: str) -> OpsAddressRead:
    return OpsAddressRead.model_validate({**address.model_dump(), "company_name": company_name})


@router.get("/addresses", response_model=list[OpsAddressRead])
async def list_addresses(
    user: DispatcherUser,
    session: Session,
    zone: str | None = Query(default=None, description='Zone code, or "none" for unzoned'),
    company_id: int | None = None,
):
    """All companies' non-archived addresses."""
    query = (
        select(Address, Company.name)
        .join(Company, Company.id == Address.company_id)
        .where(col(Address.archived).is_(False))
    )
    if zone is not None:
        if zone.strip().lower() == NO_ZONE:
            query = query.where(col(Address.zone).is_(None))
        else:
            query = query.where(Address.zone == _zone_code(zone))
    if company_id is not None:
        query = query.where(Address.company_id == company_id)
    query = query.order_by(Company.name, Address.label, Address.id)
    return [_ops_address(a, name) for a, name in (await session.exec(query)).all()]


@router.patch("/addresses/{address_id}", response_model=OpsAddressRead)
async def set_address_zone(address_id: int, body: AddressZoneUpdate, user: DispatcherUser,
                           session: Session):
    """422 if the zone doesn't exist or is inactive. Orders already reserved by a
    plan keep their plan."""
    address = await session.get(Address, address_id)
    if address is None:
        raise _not_found("Address")
    if body.zone is None or not body.zone.strip():
        address.zone = None
    else:
        code = _zone_code(body.zone)
        zone = await session.get(Zone, code)
        if zone is None:
            raise _unprocessable(f"Zone {code} doesn't exist.")
        if not zone.active:
            raise _unprocessable(f"Zone {code} is inactive.")
        address.zone = code
    await session.commit()
    company = await session.get(Company, address.company_id)
    return _ops_address(address, company.name)


# ---- Fleet --------------------------------------------------------------------------

async def _check_vehicle_unique(session: AsyncSession, name: str, registration: str,
                                exclude_id: int | None = None) -> None:
    query = select(Vehicle).where((Vehicle.name == name) | (Vehicle.registration == registration))
    if exclude_id is not None:
        query = query.where(Vehicle.id != exclude_id)
    clash = (await session.exec(query)).first()
    if clash is not None:
        if clash.name == name:
            raise _conflict(f"A vehicle named {name!r} already exists.")
        raise _conflict(f"A vehicle with registration {registration!r} already exists.")


@router.get("/vehicles", response_model=list[VehicleRead])
async def list_vehicles(user: DispatcherUser, session: Session, include_inactive: bool = False):
    query = select(Vehicle).order_by(Vehicle.name, Vehicle.id)
    if not include_inactive:
        query = query.where(col(Vehicle.active).is_(True))
    return (await session.exec(query)).all()


@router.post("/vehicles", response_model=VehicleRead, status_code=status.HTTP_201_CREATED)
async def create_vehicle(body: VehicleCreate, user: DispatcherUser, session: Session):
    data = body.model_dump()
    data["name"], data["registration"] = data["name"].strip(), data["registration"].strip().upper()
    await _check_vehicle_unique(session, data["name"], data["registration"])
    vehicle = Vehicle(**data)
    session.add(vehicle)
    try:
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        raise _conflict("A vehicle with this name or registration already exists.") from exc
    return vehicle


@router.patch("/vehicles/{vehicle_id}", response_model=VehicleRead)
async def update_vehicle(vehicle_id: int, body: VehicleUpdate, user: DispatcherUser,
                         session: Session):
    """422 if no capacity would remain set."""
    vehicle = await session.get(Vehicle, vehicle_id)
    if vehicle is None:
        raise _not_found("Vehicle")
    changes = body.model_dump(exclude_unset=True)
    for field in ("name", "registration", "active"):  # not nullable: null means "no change"
        if field in changes and changes[field] is None:
            del changes[field]
    if "name" in changes:
        changes["name"] = changes["name"].strip()
    if "registration" in changes:
        changes["registration"] = changes["registration"].strip().upper()
    merged = {**vehicle.model_dump(), **changes}
    if merged["max_weight_kg"] is None and merged["max_volume_m3"] is None and merged["max_pallets"] is None:
        raise _unprocessable("Set at least one capacity: weight, volume or pallets.")
    await _check_vehicle_unique(session, merged["name"], merged["registration"], exclude_id=vehicle.id)
    for field, value in changes.items():
        setattr(vehicle, field, value)
    try:
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        raise _conflict("A vehicle with this name or registration already exists.") from exc
    return vehicle


def _driver_read(driver: Driver, user: User | None = None) -> DriverRead:
    user = user or driver.user
    return DriverRead(id=driver.id, user_id=driver.user_id, email=user.email, name=driver.name,
                      phone=driver.phone, licence_number=driver.licence_number, active=driver.active,
                      created_at=driver.created_at)


@router.get("/drivers", response_model=list[DriverRead])
async def list_drivers(user: DispatcherUser, session: Session, include_inactive: bool = False):
    query = select(Driver).order_by(Driver.name, Driver.id)
    if not include_inactive:
        query = query.where(col(Driver.active).is_(True))
    return [_driver_read(d) for d in (await session.exec(query)).all()]


@router.post("/drivers", response_model=DriverRead, status_code=status.HTTP_201_CREATED)
async def create_driver(body: DriverCreate, user: DispatcherUser, session: Session):
    """Creates the login (role=driver) too. 409 if the e-mail is taken."""
    email = body.email.lower()
    if (await session.exec(select(User).where(func.lower(User.email) == email))).first() is not None:
        raise _conflict("A user with this e-mail already exists.")
    if email in body.password.lower():
        raise _unprocessable("Password must not contain the e-mail address.")
    name = body.name.strip()
    try:
        login = await create_user(session, email=email, password=body.password,
                                  role=UserRole.driver, full_name=name)
        driver = Driver(user_id=login.id, name=name, phone=body.phone,
                        licence_number=body.licence_number)
        session.add(driver)
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        raise _conflict("A user with this e-mail already exists.") from exc
    return _driver_read(driver, login)


@router.patch("/drivers/{driver_id}", response_model=DriverRead)
async def update_driver(driver_id: int, body: DriverUpdate, user: DispatcherUser,
                        session: Session):
    """active=false also deactivates the driver's login."""
    driver = await session.get(Driver, driver_id)
    if driver is None:
        raise _not_found("Driver")
    changes = body.model_dump(exclude_unset=True)
    for field in ("name", "active"):  # not nullable
        if field in changes and changes[field] is None:
            del changes[field]
    if "name" in changes:
        changes["name"] = changes["name"].strip()
        driver.user.full_name = changes["name"]
    if "active" in changes:
        driver.user.is_active = changes["active"]
    for field, value in changes.items():
        setattr(driver, field, value)
    await session.commit()
    return _driver_read(driver)


# ---- Plans and loads: helpers -------------------------------------------------------

_DIMS = (("weight", "weight_kg", "kg"), ("volume", "volume_m3", "m³"), ("pallets", "pallets", "pallets"))


def _capacity(vehicle: Vehicle) -> Capacity:
    return Capacity(weight_kg=vehicle.max_weight_kg, volume_m3=vehicle.max_volume_m3,
                    pallets=vehicle.max_pallets)


def _load_capacity(load: Load, plan: Plan) -> Capacity:
    """The assigned vehicle's limits, else the plan's capacity profile."""
    return _capacity(load.vehicle if load.vehicle is not None else plan.vehicle)


def _usage(pairs: Iterable[tuple[OrderLine, int]]) -> Usage:
    """Usage of `quantity` units of each line."""
    weight = volume = pallets = 0.0
    for line, quantity in pairs:
        weight += line.unit_weight_kg * quantity
        volume += line.unit_volume_m3 * quantity
        pallets += line.unit_pallet_spaces * quantity
    return Usage(weight_kg=round(weight, 6), volume_m3=round(volume, 6), pallets=round(pallets, 6))


def _load_usage(load: Load) -> Usage:
    return _usage((a.order_line, a.quantity) for a in load.assignments)


def _num(value: float) -> str:
    return f"{round(value, 3):,g}"


def _amounts(usage: Usage, capacity: Capacity, dims: list[str]) -> str:
    """ "1,250 kg of 1,000 kg and 9 pallets of 8 pallets" """
    parts = [f"{_num(getattr(usage, attr))} {unit} of {_num(getattr(capacity, attr))} {unit}"
             for dim, attr, unit in _DIMS if dim in dims]
    return " and ".join(parts)


def _load_read(load: Load, plan: Plan) -> LoadRead:
    capacity = _load_capacity(load, plan)
    usage = _load_usage(load)
    return LoadRead(
        id=load.id,
        number=load.number,
        vehicle=VehicleRead.model_validate(load.vehicle) if load.vehicle else None,
        driver=_driver_read(load.driver) if load.driver else None,
        capacity=capacity,
        usage=usage,
        fill_percent=fill_percent(usage, capacity),
        over_capacity=bool(exceeded(usage, capacity)),
        lines=[
            LoadLineRead(
                assignment_id=a.id,
                order_line_id=a.order_line_id,
                order_id=a.order_line.order_id,
                order_reference=a.order_line.order.reference,
                company_name=a.order_line.order.company.name,
                item_name=a.order_line.item_name,
                item_sku=a.order_line.item_sku,
                quantity=a.quantity,
                line_quantity=a.order_line.quantity,
                unit_weight_kg=a.order_line.unit_weight_kg,
                unit_volume_m3=a.order_line.unit_volume_m3,
                unit_pallet_spaces=a.order_line.unit_pallet_spaces,
            )
            for a in load.assignments
        ],
    )


async def _plan_or_404(session: AsyncSession, plan_id: int, *, lock: bool = False) -> Plan:
    """The plan, freshly loaded. lock=True takes a row lock (SELECT … FOR UPDATE)
    so concurrent edits of the same plan run one after the other."""
    query = select(Plan).where(Plan.id == plan_id).execution_options(populate_existing=True)
    if lock:
        query = query.with_for_update()
    plan = (await session.exec(query)).first()
    if plan is None:
        raise _not_found("Plan")
    return plan


async def _reserved_orders(session: AsyncSession, plan: Plan, *, lock: bool = False) -> list[Order]:
    query = select(Order).where(Order.plan_id == plan.id).order_by(Order.id)
    if lock:
        query = query.with_for_update()
    return list((await session.exec(query)).all())


async def _order_counts(session: AsyncSession, plan_ids: list[int]) -> dict[int, int]:
    if not plan_ids:
        return {}
    rows = await session.exec(
        select(Order.plan_id, func.count(Order.id))
        .where(col(Order.plan_id).in_(plan_ids)).group_by(Order.plan_id)
    )
    return dict(rows.all())


async def _plan_read(session: AsyncSession, plan_id: int) -> PlanRead:
    plan = await _plan_or_404(session, plan_id)
    job = await session.get(Job, plan.job_id)
    order_ids = list((await session.exec(
        select(Order.id).where(Order.plan_id == plan.id).order_by(Order.id)
    )).all())
    return PlanRead(
        id=plan.id, delivery_date=plan.delivery_date, zone=plan.zone, status=plan.status,
        job_id=plan.job_id, job_status=job.status, method=plan.method,
        order_count=len(order_ids), load_count=len(plan.loads),
        created_at=plan.created_at, locked_at=plan.locked_at,
        vehicle=VehicleRead.model_validate(plan.vehicle),
        order_ids=order_ids,
        loads=[_load_read(load, plan) for load in plan.loads],
    )


def _require_draft(plan: Plan) -> None:
    if plan.status != PlanStatus.draft:
        raise _conflict("This plan is locked; its loads can't be changed.")


async def _renumber(session: AsyncSession, plan: Plan) -> None:
    """Number the plan's loads 1..n, keeping their order. Two steps, so the
    (plan_id, number) unique constraint never sees a duplicate."""
    loads = sorted(plan.loads, key=lambda ld: (ld.number, ld.id))
    if [ld.number for ld in loads] == list(range(1, len(loads) + 1)):
        return
    for i, load in enumerate(loads, start=1):
        load.number = -i
    await session.flush()
    for i, load in enumerate(loads, start=1):
        load.number = i
    await session.flush()


# ---- Plans and loads ------------------------------------------------------------------

@router.post(
    "/plans",
    response_model=PlanRead,
    status_code=status.HTTP_202_ACCEPTED,
    responses={422: {"description": "No orders to plan (detail is a string), or units that "
                                    "can't fit (detail is an InfeasibleDetail object)."}},
)
async def create_plan(body: PlanCreate, user: DispatcherUser, session: Session):
    """
    Reserve all accepted, unreserved orders for this date + zone, create the
    Plan and a queued solve Job, enqueue it, and return the plan (with job_id;
    poll GET /api/jobs/{job_id}). 422 if there are none, or if some unit is
    bigger than the vehicle (detail = InfeasibleDetail).
    """
    code = _zone_code(body.zone)
    if await session.get(Zone, code) is None:
        raise _unprocessable(f"Zone {code} doesn't exist.")
    vehicle = await session.get(Vehicle, body.vehicle_id)
    if vehicle is None:
        raise _unprocessable("That vehicle doesn't exist.")
    if not vehicle.active:
        raise _unprocessable(f"{vehicle.name} is inactive.")

    # Row locks: a concurrent create for the same batch waits here, then sees
    # plan_id set on these orders and skips them.
    orders = list((await session.exec(
        select(Order)
        .join(Address, Address.id == Order.delivery_address_id)
        .where(Order.status == OrderStatus.accepted, Order.delivery_date == body.delivery_date,
               Address.zone == code, col(Order.plan_id).is_(None))
        .order_by(Order.id)
        .with_for_update(of=Order)
        .execution_options(populate_existing=True)
    )).all())
    if not orders:
        raise _unprocessable(f"No accepted orders for {body.delivery_date.isoformat()} in {code} "
                             "that aren't already in a plan.")

    capacity = _capacity(vehicle)
    units = expand_lines(line for order in orders for line in order.lines)
    misfits = find_misfits(units, capacity)
    if misfits:
        n = len(misfits)
        raise _unprocessable(InfeasibleDetail(
            message=f"{n} order line{'s' if n != 1 else ''} can't fit {vehicle.name} even on an "
                    "empty load. Choose a bigger vehicle or remove those items.",
            misfits=misfits,
        ).model_dump())

    job = Job(kind=JobKind.solve, payload={}, created_by_id=user.id)
    session.add(job)
    await session.flush()
    plan = Plan(delivery_date=body.delivery_date, zone=code, status=PlanStatus.draft,
                vehicle_id=vehicle.id, job_id=job.id, created_by_id=user.id)
    session.add(plan)
    await session.flush()
    job.payload = SolveJobPayload(
        plan_id=plan.id, order_ids=[o.id for o in orders], capacity=capacity,
        time_limit_s=settings.SOLVER_TIME_LIMIT_S,
    ).model_dump(mode="json")
    for order in orders:
        order.plan_id = plan.id
    await session.commit()

    try:
        await workers.enqueue_solve(job.id)
    except Exception as exc:
        log.exception("Could not enqueue solve job %s", job.id)
        await session.rollback()
        await session.exec(update(Order).where(Order.plan_id == plan.id).values(plan_id=None))
        await session.delete(plan)
        await session.flush()
        await session.delete(job)
        await session.commit()
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE,
                            "The job queue is unavailable. Try again in a moment.") from exc

    return await _plan_read(session, plan.id)


@router.get("/plans", response_model=list[PlanSummary])
async def list_plans(user: DispatcherUser, session: Session,
                     delivery_date: date | None = None, zone: str | None = None,
                     status_: Annotated[PlanStatus | None, Query(alias="status")] = None):
    query = select(Plan, Job.status).join(Job, Job.id == Plan.job_id)
    if delivery_date is not None:
        query = query.where(Plan.delivery_date == delivery_date)
    if zone is not None:
        query = query.where(Plan.zone == _zone_code(zone))
    if status_ is not None:
        query = query.where(Plan.status == status_)
    query = query.order_by(Plan.delivery_date, Plan.zone, Plan.id)
    rows = (await session.exec(query)).all()
    counts = await _order_counts(session, [p.id for p, _ in rows])
    return [
        PlanSummary(id=p.id, delivery_date=p.delivery_date, zone=p.zone, status=p.status,
                    job_id=p.job_id, job_status=job_status, method=p.method,
                    order_count=counts.get(p.id, 0), load_count=len(p.loads),
                    created_at=p.created_at, locked_at=p.locked_at)
        for p, job_status in rows
    ]


@router.get("/plans/{plan_id}", response_model=PlanRead)
async def get_plan(plan_id: int, user: DispatcherUser, session: Session):
    return await _plan_read(session, plan_id)


@router.delete("/plans/{plan_id}", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
async def discard_plan(plan_id: int, user: DispatcherUser, session: Session):
    """Draft plans only: deletes its loads and releases its orders. The solve Job
    is kept (a worker may still be running it); its payload's plan_id then
    points at nothing."""
    plan = await _plan_or_404(session, plan_id, lock=True)
    if plan.status != PlanStatus.draft:
        raise _conflict("A locked plan can't be discarded.")
    await session.exec(update(Order).where(Order.plan_id == plan.id).values(plan_id=None))
    await session.delete(plan)
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/plans/{plan_id}/draft", response_model=PlanRead)
async def save_draft(plan_id: int, body: PlanSaveDraft, user: DispatcherUser, session: Session):
    """Write the loads of the job's `method` solution (409 if the job hasn't succeeded
    or the plan is locked). Replaces any existing loads of this draft."""
    plan = await _plan_or_404(session, plan_id, lock=True)
    _require_draft(plan)
    job = await session.get(Job, plan.job_id, populate_existing=True)
    if job is None or job.status != JobStatus.succeeded or job.result is None:
        raise _conflict("The optimiser hasn't finished for this plan yet.")
    result = SolveResult.model_validate(job.result)
    solution = result.ortools if body.method == "ortools" else result.ffd
    if solution is None:
        raise _conflict("OR-Tools found no solution in time; save the FFD result instead.")

    # The solution must cover exactly the units of the orders this plan reserves.
    expected = Counter({ln.id: ln.quantity
                        for o in await _reserved_orders(session, plan) for ln in o.lines})
    units = {u.id: u for u in result.units}
    stale = _conflict("The orders in this plan changed after the optimiser ran. "
                      "Discard the plan and create a new one.")
    placed: Counter[int] = Counter()
    seen: set[int] = set()
    loads_lines: list[dict[int, int]] = []
    for packed in solution.loads:
        per_line: dict[int, int] = {}
        for uid in packed.unit_ids:
            if uid not in units or uid in seen:
                raise stale
            seen.add(uid)
            line_id = units[uid].order_line_id
            per_line[line_id] = per_line.get(line_id, 0) + 1
            placed[line_id] += 1
        if per_line:
            loads_lines.append(per_line)
    if placed != expected:
        raise stale

    plan.loads.clear()  # delete-orphan removes the old loads
    await session.flush()
    for number, per_line in enumerate(loads_lines, start=1):
        plan.loads.append(Load(number=number, assignments=[
            LoadAssignment(order_line_id=line_id, quantity=qty) for line_id, qty in per_line.items()
        ]))
    plan.method = body.method
    await session.commit()
    return await _plan_read(session, plan.id)


@router.post("/plans/{plan_id}/moves", response_model=PlanRead)
async def move_line(plan_id: int, body: LineMove, user: DispatcherUser, session: Session):
    """422 if the target load would exceed its capacity; 409 if the plan is locked.
    Loads left empty are deleted and the remaining loads renumbered."""
    plan = await _plan_or_404(session, plan_id, lock=True)
    _require_draft(plan)
    loads = {ld.id: ld for ld in plan.loads}
    source = loads.get(body.from_load_id)
    if source is None:
        raise _not_found("Load")
    assignment = next((a for a in source.assignments if a.order_line_id == body.order_line_id), None)
    if assignment is None:
        raise _unprocessable(f"That order line isn't on load {source.number}.")
    quantity = body.quantity if body.quantity is not None else assignment.quantity
    if quantity > assignment.quantity:
        raise _unprocessable(f"Load {source.number} only carries {assignment.quantity} of those units.")

    line = assignment.order_line
    if body.to_load_id is not None:
        target = loads.get(body.to_load_id)
        if target is None:
            raise _not_found("Target load")
        if target.id == source.id:
            raise _unprocessable("The units are already on that load.")
        capacity = _load_capacity(target, plan)
        after = _usage([*((a.order_line, a.quantity) for a in target.assignments), (line, quantity)])
        label = f"Load {target.number}"
    else:
        target = None
        capacity = _capacity(plan.vehicle)
        after = _usage([(line, quantity)])
        label = "A new load"
    dims = exceeded(after, capacity)
    if dims:
        raise _unprocessable(f"{label} would carry {_amounts(after, capacity, dims)}.")

    if quantity == assignment.quantity:
        source.assignments.remove(assignment)
    else:
        assignment.quantity -= quantity
    if target is None:
        number = max((ld.number for ld in plan.loads), default=0) + 1
        plan.loads.append(Load(number=number, assignments=[
            LoadAssignment(order_line_id=line.id, quantity=quantity)]))
    else:
        existing = next((a for a in target.assignments if a.order_line_id == line.id), None)
        if existing is not None:
            existing.quantity += quantity
        else:
            target.assignments.append(LoadAssignment(order_line_id=line.id, quantity=quantity))
    await session.flush()
    if not source.assignments:
        plan.loads.remove(source)
        await session.flush()
        await _renumber(session, plan)
    await session.commit()
    return await _plan_read(session, plan.id)


@router.post("/plans/{plan_id}/lock", response_model=PlanRead)
async def lock_plan(plan_id: int, user: DispatcherUser, session: Session):
    """Draft with loads → locked; every order in it: accepted → planned.
    409 if a load is over capacity or the plan has no loads."""
    plan = await _plan_or_404(session, plan_id, lock=True)
    if plan.status != PlanStatus.draft:
        raise _conflict("This plan is already locked.")
    if not plan.loads:
        raise _conflict("Save a draft with loads before locking the plan.")
    for load in plan.loads:
        capacity = _load_capacity(load, plan)
        usage = _load_usage(load)
        dims = exceeded(usage, capacity)
        if dims:
            raise _conflict(f"Load {load.number} is over capacity: it carries "
                            f"{_amounts(usage, capacity, dims)}.")

    orders = await _reserved_orders(session, plan, lock=True)
    assigned: Counter[int] = Counter()
    for load in plan.loads:
        for a in load.assignments:
            assigned[a.order_line_id] += a.quantity
    expected = Counter({ln.id: ln.quantity for o in orders for ln in o.lines})
    if assigned != expected:
        raise _conflict("Not every unit of the plan's orders is on a load (or a load carries units "
                        "of an order that isn't in the plan). Save the draft again.")
    not_accepted = [o.reference for o in orders if o.status != OrderStatus.accepted]
    if not_accepted:
        raise _conflict(f"These orders are no longer accepted: {', '.join(not_accepted)}.")

    for order in orders:
        await transition(session, order, OrderStatus.planned, user)
    plan.status = PlanStatus.locked
    plan.locked_at = utcnow()
    await session.commit()
    return await _plan_read(session, plan.id)


@router.patch("/loads/{load_id}", response_model=LoadRead)
async def update_load(load_id: int, body: LoadUpdate, user: DispatcherUser, session: Session):
    """Assign/clear the vehicle and driver (allowed on draft and locked plans).
    422 if the load doesn't fit the new vehicle or the vehicle/driver is inactive.
    Clearing the vehicle re-checks the load against the plan's capacity profile."""
    plan_id = (await session.exec(select(Load.plan_id).where(Load.id == load_id))).first()
    if plan_id is None:
        raise _not_found("Load")
    plan = await _plan_or_404(session, plan_id, lock=True)
    load = next((ld for ld in plan.loads if ld.id == load_id), None)
    if load is None:  # deleted while we waited for the lock
        raise _not_found("Load")
    fields = body.model_fields_set

    if "vehicle_id" in fields:
        if body.vehicle_id is None:
            vehicle = plan.vehicle
        else:
            vehicle = await session.get(Vehicle, body.vehicle_id)
            if vehicle is None:
                raise _unprocessable("That vehicle doesn't exist.")
            if not vehicle.active:
                raise _unprocessable(f"{vehicle.name} is inactive.")
        capacity = _capacity(vehicle)
        usage = _load_usage(load)
        dims = exceeded(usage, capacity)
        if dims:
            raise _unprocessable(f"Load {load.number} doesn't fit {vehicle.name}: it carries "
                                 f"{_amounts(usage, capacity, dims)}.")
        load.vehicle_id = body.vehicle_id

    if "driver_id" in fields:
        if body.driver_id is not None:
            driver = await session.get(Driver, body.driver_id)
            if driver is None:
                raise _unprocessable("That driver doesn't exist.")
            if not driver.active:
                raise _unprocessable(f"{driver.name} is inactive.")
        load.driver_id = body.driver_id

    await session.commit()
    plan = await _plan_or_404(session, plan_id)
    load = await session.get(Load, load_id, populate_existing=True)
    return _load_read(load, plan)


# ---- Invoices -----------------------------------------------------------------------

async def _company_or_404(session: AsyncSession, company_id: int) -> Company:
    company = await session.get(Company, company_id)
    if company is None:
        raise _not_found("Company")
    return company


@router.get("/invoices", response_model=list[InvoiceSummary])
async def list_invoices(month: Month, user: DispatcherUser, session: Session):
    """One row per company with delivered orders in `month` (business timezone)."""
    return await pricing.invoice_summaries(session, month)


@router.get("/invoices/{company_id}", response_model=Invoice)
async def get_invoice(company_id: int, month: Month, user: DispatcherUser, session: Session):
    company = await _company_or_404(session, company_id)
    return await pricing.build_invoice(session, company, month)


@router.get(
    "/invoices/{company_id}/csv",
    response_class=Response,
    responses={200: {"content": {"text/csv": {}}, "description": "Invoice as CSV"}},
)
async def get_invoice_csv(company_id: int, month: Month, user: DispatcherUser, session: Session):
    """Content-Disposition: attachment; filename="invoice-<company>-<month>.csv"."""
    company = await _company_or_404(session, company_id)
    invoice = await pricing.build_invoice(session, company, month)
    filename = pricing.invoice_filename(invoice, company)
    return Response(
        content=pricing.invoice_csv(invoice),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
