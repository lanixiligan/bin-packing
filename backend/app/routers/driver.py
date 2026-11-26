"""
Driver API: /api/driver/*, plus the POD photo route /api/pods/{id}/photo.
Owner: Agent C.

A driver only sees orders on loads assigned to them in LOCKED plans.
"""

from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, Query, UploadFile
from fastapi.responses import FileResponse
from sqlmodel.ext.asyncio.session import AsyncSession

from app.auth import CurrentDriver, CurrentUser
from app.db import get_session
from app.routers._stub import todo
from app.schemas import DriverOrder, DriverRun, DriverStatusUpdate

router = APIRouter()        # mounted at /api/driver
pods_router = APIRouter()   # mounted at /api/pods
Session = Annotated[AsyncSession, Depends(get_session)]


@router.get("/run", response_model=DriverRun)
async def get_run(
    driver: CurrentDriver,
    session: Session,
    date_: Annotated[date | None, Query(alias="date", description="Default: today")] = None,
):
    """Default date: today in BUSINESS_TZ."""
    raise todo()


@router.get("/orders/{order_id}", response_model=DriverOrder)
async def get_order(order_id: int, driver: CurrentDriver, session: Session):
    """404 unless the order is on one of this driver's loads in a locked plan."""
    raise todo()


@router.post("/orders/{order_id}/status", response_model=DriverOrder)
async def update_status(order_id: int, body: DriverStatusUpdate, driver: CurrentDriver,
                        session: Session):
    """planned → picked_up → in_transit, or → exception (note required).
    If an order is split over several loads and another driver already made
    this change, returns 200 without writing a second event."""
    raise todo()


@router.post("/orders/{order_id}/pod", response_model=DriverOrder)
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
    415 if not an allowed image."""
    raise todo()


@pods_router.get(
    "/{pod_id}/photo",
    response_class=FileResponse,
    responses={200: {"content": {"image/jpeg": {}, "image/png": {}, "image/webp": {}}}},
)
async def get_pod_photo(pod_id: int, user: CurrentUser, session: Session):
    """Customers of the order's company, dispatchers, and the driver who recorded it.
    404 for anyone else."""
    raise todo()
