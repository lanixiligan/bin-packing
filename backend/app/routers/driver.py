"""
Driver API: /api/driver/*, plus the POD photo route /api/pods/{id}/photo.
Owner: Agent C.

A driver only sees orders on loads assigned to them in LOCKED plans.

`DriverOrder.next_statuses` comes straight from app.lifecycle for the driver
role, so for an order in transit it contains `delivered`: the UI offers that
as the proof-of-delivery form (POST …/pod), not as a status change.
"""

import asyncio
import logging
import uuid
from datetime import date, time
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from fastapi.responses import FileResponse
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from app.auth import CurrentDriver, CurrentUser
from app.config import settings
from app.db import get_session
from app.lifecycle import next_statuses, transition
from app.models import (
    Driver,
    Load,
    LoadAssignment,
    Order,
    OrderLine,
    OrderStatus,
    Plan,
    PlanStatus,
    ProofOfDelivery,
    UserRole,
)
from app.schemas import (
    AddressRead,
    DriverLine,
    DriverOrder,
    DriverRead,
    DriverRun,
    DriverRunLoad,
    DriverStatusUpdate,
    VehicleRead,
)
from app.serializers import pods_for

log = logging.getLogger(__name__)

router = APIRouter()        # mounted at /api/driver
pods_router = APIRouter()   # mounted at /api/pods
Session = Annotated[AsyncSession, Depends(get_session)]

# Magic bytes -> (extension, content type). WebP is "RIFF" <4-byte size> "WEBP".
_PNG = b"\x89PNG\r\n\x1a\n"


def _image_type(data: bytes) -> tuple[str, str] | None:
    if data.startswith(b"\xff\xd8\xff"):
        return "jpg", "image/jpeg"
    if data.startswith(_PNG):
        return "png", "image/png"
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp", "image/webp"
    return None


def _driver_read(driver: Driver) -> DriverRead:
    return DriverRead(id=driver.id, user_id=driver.user_id, email=driver.user.email, name=driver.name,
                      phone=driver.phone, licence_number=driver.licence_number, active=driver.active,
                      created_at=driver.created_at)


def _order_key(order: Order) -> tuple:
    return (order.window_start is None, order.window_start or time.min, order.id)


async def _driver_order(session: AsyncSession, order: Order, load: Load) -> DriverOrder:
    """The order as seen on `load`: only the units of its lines on that load."""
    assignments = [a for a in load.assignments if a.order_line.order_id == order.id]
    return DriverOrder(
        order_id=order.id,
        reference=order.reference,
        status=order.status,
        load_id=load.id,
        company_name=order.company.name,
        delivery_date=order.delivery_date,
        window_start=order.window_start,
        window_end=order.window_end,
        pickup_address=AddressRead.model_validate(order.pickup_address),
        delivery_address=AddressRead.model_validate(order.delivery_address),
        notes=order.notes,
        lines=[DriverLine(item_name=a.order_line.item_name, item_sku=a.order_line.item_sku,
                          quantity=a.quantity,
                          dg_class=(a.order_line.dg or {}).get("dg_class"),
                          un_number=(a.order_line.dg or {}).get("un_number"))
               for a in assignments],
        total_weight_kg=round(sum(a.order_line.unit_weight_kg * a.quantity for a in assignments), 3),
        next_statuses=[] if await _has_my_pod(session, order.id, load.driver_id)
        else next_statuses(order.status, UserRole.driver),
        pods=await pods_for(session, order.id),
    )


async def _has_my_pod(session: AsyncSession, order_id: int, driver_id: int | None) -> bool:
    if driver_id is None:
        return False
    return (await session.exec(select(ProofOfDelivery.id).where(
        ProofOfDelivery.order_id == order_id, ProofOfDelivery.driver_id == driver_id))).first() is not None


async def _undelivered_drivers(session: AsyncSession, order_id: int) -> set[int]:
    """Drivers of locked-plan loads carrying the order who haven't recorded a POD for it."""
    carrying = set((await session.exec(
        select(Load.driver_id)
        .join(Plan, Plan.id == Load.plan_id)
        .join(LoadAssignment, LoadAssignment.load_id == Load.id)
        .join(OrderLine, OrderLine.id == LoadAssignment.order_line_id)
        .where(Plan.status == PlanStatus.locked, OrderLine.order_id == order_id,
               Load.driver_id.is_not(None))
        .distinct()
    )).all())
    delivered = set((await session.exec(
        select(ProofOfDelivery.driver_id).where(ProofOfDelivery.order_id == order_id)
    )).all())
    return carrying - delivered


# Forward progress of a picked-up order. A split order moves with the first driver
# to reach a step, so the others' later requests for that step are already done.
_PROGRESS = {OrderStatus.planned: 0, OrderStatus.picked_up: 1, OrderStatus.in_transit: 2,
             OrderStatus.delivered: 3}


async def _driver_loads_for_order(session: AsyncSession, driver_id: int, order_id: int) -> list[Load]:
    """This driver's loads in locked plans that carry some of the order's units."""
    return list((await session.exec(
        select(Load)
        .join(Plan, Plan.id == Load.plan_id)
        .join(LoadAssignment, LoadAssignment.load_id == Load.id)
        .join(OrderLine, OrderLine.id == LoadAssignment.order_line_id)
        .where(Load.driver_id == driver_id, Plan.status == PlanStatus.locked,
               OrderLine.order_id == order_id)
        .order_by(Load.number, Load.id)
        .distinct()
    )).all())


async def _order_on_my_load(session: AsyncSession, driver: Driver, order_id: int, *,
                            lock: bool = False) -> tuple[Order, Load]:
    """(order, the driver's first load carrying it), or 404. lock=True locks the
    order row so concurrent status changes of a split order run one at a time."""
    loads = await _driver_loads_for_order(session, driver.id, order_id)
    if not loads:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Order not found.")
    query = select(Order).where(Order.id == order_id).execution_options(populate_existing=True)
    if lock:
        query = query.with_for_update()
    order = (await session.exec(query)).one()
    return order, loads[0]


@router.get("/run", response_model=DriverRun)
async def get_run(
    driver: CurrentDriver,
    session: Session,
    date_: Annotated[date | None, Query(alias="date", description="Default: today")] = None,
):
    """Default date: today in BUSINESS_TZ."""
    day = date_ or settings.today()
    loads = (await session.exec(
        select(Load)
        .join(Plan, Plan.id == Load.plan_id)
        .where(Load.driver_id == driver.id, Plan.status == PlanStatus.locked,
               Plan.delivery_date == day)
        .order_by(Plan.id, Load.number)
    )).all()
    run_loads = []
    for load in loads:
        orders: dict[int, Order] = {}
        for a in load.assignments:
            orders.setdefault(a.order_line.order_id, a.order_line.order)
        run_loads.append(DriverRunLoad(
            load_id=load.id,
            number=load.number,
            plan_id=load.plan_id,
            zone=load.plan.zone,
            delivery_date=load.plan.delivery_date,
            vehicle=VehicleRead.model_validate(load.vehicle) if load.vehicle else None,
            orders=[await _driver_order(session, o, load)
                    for o in sorted(orders.values(), key=_order_key)],
        ))
    return DriverRun(date=day, driver=_driver_read(driver), loads=run_loads)


@router.get("/orders/{order_id}", response_model=DriverOrder)
async def get_order(order_id: int, driver: CurrentDriver, session: Session):
    """404 unless the order is on one of this driver's loads in a locked plan.
    If several of the driver's loads carry it, the first one is shown."""
    order, load = await _order_on_my_load(session, driver, order_id)
    return await _driver_order(session, order, load)


@router.post("/orders/{order_id}/status", response_model=DriverOrder)
async def update_status(order_id: int, body: DriverStatusUpdate, driver: CurrentDriver,
                        session: Session):
    """planned → picked_up → in_transit, or → exception (note required).
    If an order is split over several loads and another driver already moved it
    to this step or further, returns 200 without writing a second event."""
    order, load = await _order_on_my_load(session, driver, order_id, lock=True)
    already = (body.status in _PROGRESS and order.status in _PROGRESS
               and _PROGRESS[order.status] >= _PROGRESS[body.status])
    if order.status != body.status and not already:
        await transition(session, order, body.status, driver.user, body.note)
        await session.commit()
    return await _driver_order(session, order, load)


# The photo limit plus room for the multipart framing and the text fields. The
# body is cut off while it streams in, before auth runs (FastAPI reads it first).
POD_MAX_BODY_BYTES = settings.MAX_UPLOAD_BYTES + 64 * 1024


@router.post("/orders/{order_id}/pod", response_model=DriverOrder, max_body_size=POD_MAX_BODY_BYTES)
async def upload_pod(
    order_id: int,
    driver: CurrentDriver,
    session: Session,
    signed_by: Annotated[str, Form(min_length=1, max_length=200)],
    photo: Annotated[UploadFile, File(description="JPEG, PNG or WebP, up to MAX_UPLOAD_BYTES")],
    note: Annotated[str | None, Form(max_length=1000)] = None,
):
    """Record proof of delivery and move in_transit → delivered. The photo is
    checked by content (magic bytes), not by its name or declared type, and
    stored under UPLOAD_DIR with a server-generated name. 413 if too large,
    415 if not an allowed image.

    If the order is split over several drivers' loads, each driver records a POD
    for their part, and the order becomes delivered with the last one. 409 if
    this driver already recorded one."""
    signed_by = signed_by.strip()
    if not signed_by:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT,
                            "Enter the name of the person who signed.")
    note = (note or "").strip() or None

    order, load = await _order_on_my_load(session, driver, order_id, lock=True)
    if await _has_my_pod(session, order.id, driver.id):
        raise HTTPException(status.HTTP_409_CONFLICT, "You already recorded a proof of delivery "
                                                      "for this order.")
    if order.status not in (OrderStatus.in_transit, OrderStatus.delivered):
        label = order.status.value.replace("_", " ")
        raise HTTPException(status.HTTP_409_CONFLICT,
                            f"Only an order that is in transit can be delivered (this one is {label}).")

    data = await photo.read(settings.MAX_UPLOAD_BYTES + 1)
    if len(data) > settings.MAX_UPLOAD_BYTES:
        raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE,
                            f"The photo is larger than {settings.MAX_UPLOAD_BYTES // (1024 * 1024)} MB.")
    kind = _image_type(data)
    if kind is None:
        raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
                            "The photo must be a JPEG, PNG or WebP image.")
    ext, content_type = kind

    relative = Path("pod") / f"{uuid.uuid4().hex}.{ext}"
    path = settings.upload_dir / relative
    await asyncio.to_thread(path.parent.mkdir, parents=True, exist_ok=True)
    await asyncio.to_thread(path.write_bytes, data)
    try:
        session.add(ProofOfDelivery(
            order_id=order.id, load_id=load.id, driver_id=driver.id, signed_by=signed_by,
            photo_path=relative.as_posix(), photo_content_type=content_type, note=note,
        ))
        await session.flush()
        if order.status == OrderStatus.in_transit and not await _undelivered_drivers(session, order.id):
            await transition(session, order, OrderStatus.delivered, driver.user, note)
        await session.commit()
    except BaseException:
        await session.rollback()
        await asyncio.to_thread(path.unlink, missing_ok=True)
        raise
    return await _driver_order(session, order, load)


# ---- POD photos --------------------------------------------------------------------

async def _may_see_pod(session: AsyncSession, user, pod: ProofOfDelivery, order: Order) -> bool:
    if user.role == UserRole.dispatcher:
        return True
    if user.role == UserRole.customer:
        return user.company_id is not None and order.company_id == user.company_id
    if user.role == UserRole.driver:
        driver = (await session.exec(select(Driver).where(Driver.user_id == user.id))).first()
        if driver is None or not driver.active:
            return False
        if pod.driver_id == driver.id:
            return True
        return bool(await _driver_loads_for_order(session, driver.id, order.id))
    return False


@pods_router.get(
    "/{pod_id}/photo",
    response_class=FileResponse,
    responses={200: {"content": {"image/jpeg": {}, "image/png": {}, "image/webp": {}}}},
)
async def get_pod_photo(pod_id: int, user: CurrentUser, session: Session):
    """Customers of the order's company, dispatchers, and the driver who recorded it
    (or who carries the order). 404 for anyone else."""
    not_found = HTTPException(status.HTTP_404_NOT_FOUND, "Photo not found.")
    pod = await session.get(ProofOfDelivery, pod_id)
    if pod is None:
        raise not_found
    order = await session.get(Order, pod.order_id)
    if order is None or not await _may_see_pod(session, user, pod, order):
        raise not_found
    root = settings.upload_dir.resolve()
    path = (root / pod.photo_path).resolve()
    if not path.is_relative_to(root) or not await asyncio.to_thread(path.is_file):
        raise not_found
    ext = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}.get(pod.photo_content_type, "bin")
    return FileResponse(path, media_type=pod.photo_content_type, headers={
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": f'inline; filename="pod-{pod.id}.{ext}"',
        "Cache-Control": "private, no-store",
    })

