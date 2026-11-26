"""
Dispatcher API: /api/ops/*. Owner: Agent C. Every route requires role=dispatcher.
"""

from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response, status
from fastapi.responses import PlainTextResponse
from sqlmodel.ext.asyncio.session import AsyncSession

from app.auth import DispatcherUser
from app.db import get_session
from app.models import OrderStatus, PlanStatus
from app.routers._stub import todo
from app.schemas import (
    MONTH_PATTERN,
    AddressZoneUpdate,
    BatchSummary,
    DriverCreate,
    DriverRead,
    DriverUpdate,
    InfeasibleDetail,  # noqa: F401  (detail of the 422 from create_plan)
    Invoice,
    InvoiceSummary,
    LineMove,
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
    StatusNote,
    VehicleCreate,
    VehicleRead,
    VehicleUpdate,
    ZoneCreate,
    ZoneRead,
    ZoneUpdate,
)

router = APIRouter()
Session = Annotated[AsyncSession, Depends(get_session)]
Month = Annotated[str, Query(pattern=MONTH_PATTERN, description='"YYYY-MM"')]


# ---- Order queue ----------------------------------------------------------------

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
    raise todo()


@router.get("/orders/{order_id}", response_model=OrderRead)
async def get_order(order_id: int, user: DispatcherUser, session: Session):
    """404 for drafts."""
    raise todo()


@router.post("/orders/{order_id}/accept", response_model=OrderRead)
async def accept_order(order_id: int, user: DispatcherUser, session: Session,
                       body: StatusNote | None = None):
    raise todo()


@router.post("/orders/{order_id}/reject", response_model=OrderRead)
async def reject_order(order_id: int, body: RejectBody, user: DispatcherUser, session: Session):
    raise todo()


@router.get("/batches", response_model=list[BatchSummary])
async def list_batches(user: DispatcherUser, session: Session,
                       from_date: date | None = None, to_date: date | None = None):
    """Accepted + planned orders grouped by delivery_date and zone."""
    raise todo()


# ---- Zones and addresses ---------------------------------------------------------

@router.get("/zones", response_model=list[ZoneRead])
async def list_zones(user: DispatcherUser, session: Session):
    raise todo()


@router.post("/zones", response_model=ZoneRead, status_code=status.HTTP_201_CREATED)
async def create_zone(body: ZoneCreate, user: DispatcherUser, session: Session):
    """409 if the code exists."""
    raise todo()


@router.patch("/zones/{code}", response_model=ZoneRead)
async def update_zone(code: str, body: ZoneUpdate, user: DispatcherUser, session: Session):
    raise todo()


@router.get("/addresses", response_model=list[OpsAddressRead])
async def list_addresses(
    user: DispatcherUser,
    session: Session,
    zone: str | None = Query(default=None, description='Zone code, or "none" for unzoned'),
    company_id: int | None = None,
):
    """All companies' non-archived addresses."""
    raise todo()


@router.patch("/addresses/{address_id}", response_model=OpsAddressRead)
async def set_address_zone(address_id: int, body: AddressZoneUpdate, user: DispatcherUser,
                           session: Session):
    """422 if the zone doesn't exist or is inactive."""
    raise todo()


# ---- Fleet --------------------------------------------------------------------------

@router.get("/vehicles", response_model=list[VehicleRead])
async def list_vehicles(user: DispatcherUser, session: Session, include_inactive: bool = False):
    raise todo()


@router.post("/vehicles", response_model=VehicleRead, status_code=status.HTTP_201_CREATED)
async def create_vehicle(body: VehicleCreate, user: DispatcherUser, session: Session):
    raise todo()


@router.patch("/vehicles/{vehicle_id}", response_model=VehicleRead)
async def update_vehicle(vehicle_id: int, body: VehicleUpdate, user: DispatcherUser,
                         session: Session):
    """422 if no capacity would remain set."""
    raise todo()


@router.get("/drivers", response_model=list[DriverRead])
async def list_drivers(user: DispatcherUser, session: Session, include_inactive: bool = False):
    raise todo()


@router.post("/drivers", response_model=DriverRead, status_code=status.HTTP_201_CREATED)
async def create_driver(body: DriverCreate, user: DispatcherUser, session: Session):
    """Creates the login (role=driver) too. 409 if the e-mail is taken."""
    raise todo()


@router.patch("/drivers/{driver_id}", response_model=DriverRead)
async def update_driver(driver_id: int, body: DriverUpdate, user: DispatcherUser,
                        session: Session):
    """active=false also deactivates the driver's login."""
    raise todo()


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
    raise todo()


@router.get("/plans", response_model=list[PlanSummary])
async def list_plans(user: DispatcherUser, session: Session,
                     delivery_date: date | None = None, zone: str | None = None,
                     status_: Annotated[PlanStatus | None, Query(alias="status")] = None):
    raise todo()


@router.get("/plans/{plan_id}", response_model=PlanRead)
async def get_plan(plan_id: int, user: DispatcherUser, session: Session):
    raise todo()


@router.delete("/plans/{plan_id}", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
async def discard_plan(plan_id: int, user: DispatcherUser, session: Session):
    """Draft plans only: deletes its loads and releases its orders."""
    raise todo()


@router.post("/plans/{plan_id}/draft", response_model=PlanRead)
async def save_draft(plan_id: int, body: PlanSaveDraft, user: DispatcherUser, session: Session):
    """Write the loads of the job's `method` solution (409 if the job hasn't succeeded
    or the plan is locked). Replaces any existing loads of this draft."""
    raise todo()


@router.post("/plans/{plan_id}/moves", response_model=PlanRead)
async def move_line(plan_id: int, body: LineMove, user: DispatcherUser, session: Session):
    """422 if the target load would exceed its capacity; 409 if the plan is locked.
    Loads left empty are deleted and the remaining loads renumbered."""
    raise todo()


@router.post("/plans/{plan_id}/lock", response_model=PlanRead)
async def lock_plan(plan_id: int, user: DispatcherUser, session: Session):
    """Draft with loads → locked; every order in it: accepted → planned.
    409 if a load is over capacity or the plan has no loads."""
    raise todo()


@router.patch("/loads/{load_id}", response_model=LoadRead)
async def update_load(load_id: int, body: LoadUpdate, user: DispatcherUser, session: Session):
    """Assign/clear the vehicle and driver (allowed on draft and locked plans).
    422 if the load doesn't fit the new vehicle or the vehicle/driver is inactive."""
    raise todo()


# ---- Invoices -----------------------------------------------------------------------

@router.get("/invoices", response_model=list[InvoiceSummary])
async def list_invoices(month: Month, user: DispatcherUser, session: Session):
    """One row per company with delivered orders in `month` (business timezone)."""
    raise todo()


@router.get("/invoices/{company_id}", response_model=Invoice)
async def get_invoice(company_id: int, month: Month, user: DispatcherUser, session: Session):
    raise todo()


@router.get(
    "/invoices/{company_id}/csv",
    response_class=PlainTextResponse,
    responses={200: {"content": {"text/csv": {}}, "description": "Invoice as CSV"}},
)
async def get_invoice_csv(company_id: int, month: Month, user: DispatcherUser, session: Session):
    """Content-Disposition: attachment; filename="invoice-<company>-<month>.csv"."""
    raise todo()
