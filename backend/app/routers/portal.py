"""
Customer portal API: /api/portal/*. Owner: Agent A.

Every route requires role=customer, and EVERY query must be filtered by
`user.company_id`. Another company's row must look exactly like a missing
row (404), never 403, so ids can't be probed.
"""

from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response, status
from sqlmodel.ext.asyncio.session import AsyncSession

from app.auth import CustomerUser
from app.db import get_session
from app.models import OrderStatus
from app.routers._stub import todo
from app.schemas import (
    AddressCreate,
    AddressRead,
    AddressUpdate,
    ItemCreate,
    ItemRead,
    ItemUpdate,
    OrderCreate,
    OrderRead,
    OrderSummary,
    OrderUpdate,
    QuotePreviewRequest,
    QuoteRead,
    StatusNote,
)

router = APIRouter()
Session = Annotated[AsyncSession, Depends(get_session)]


# ---- Items ------------------------------------------------------------------

@router.get("/items", response_model=list[ItemRead])
async def list_items(user: CustomerUser, session: Session, include_archived: bool = False):
    raise todo()


@router.post("/items", response_model=ItemRead, status_code=status.HTTP_201_CREATED)
async def create_item(body: ItemCreate, user: CustomerUser, session: Session):
    """409 if the SKU is already used by this company."""
    raise todo()


@router.get("/items/{item_id}", response_model=ItemRead)
async def get_item(item_id: int, user: CustomerUser, session: Session):
    raise todo()


@router.patch("/items/{item_id}", response_model=ItemRead)
async def update_item(item_id: int, body: ItemUpdate, user: CustomerUser, session: Session):
    raise todo()


@router.delete("/items/{item_id}", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
async def archive_item(item_id: int, user: CustomerUser, session: Session):
    """Archives (soft-deletes): existing orders keep their lines."""
    raise todo()


# ---- Addresses ----------------------------------------------------------------

@router.get("/addresses", response_model=list[AddressRead])
async def list_addresses(user: CustomerUser, session: Session, include_archived: bool = False):
    raise todo()


@router.post("/addresses", response_model=AddressRead, status_code=status.HTTP_201_CREATED)
async def create_address(body: AddressCreate, user: CustomerUser, session: Session):
    raise todo()


@router.get("/addresses/{address_id}", response_model=AddressRead)
async def get_address(address_id: int, user: CustomerUser, session: Session):
    raise todo()


@router.patch("/addresses/{address_id}", response_model=AddressRead)
async def update_address(address_id: int, body: AddressUpdate, user: CustomerUser, session: Session):
    """Customers cannot set `zone` (dispatchers do)."""
    raise todo()


@router.delete("/addresses/{address_id}", status_code=status.HTTP_204_NO_CONTENT,
               response_class=Response)
async def archive_address(address_id: int, user: CustomerUser, session: Session):
    raise todo()


# ---- Quotes ---------------------------------------------------------------------

@router.post("/quote-preview", response_model=QuoteRead)
async def quote_preview(body: QuotePreviewRequest, user: CustomerUser, session: Session):
    """Price for these lines to this delivery address. Not stored (id = null)."""
    raise todo()


# ---- Orders -----------------------------------------------------------------------

@router.get("/orders", response_model=list[OrderSummary])
async def list_orders(
    user: CustomerUser,
    session: Session,
    status_: Annotated[list[OrderStatus] | None, Query(alias="status")] = None,
    from_date: date | None = None,
    to_date: date | None = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 200,
    offset: Annotated[int, Query(ge=0)] = 0,
):
    """Newest first. `status` may be repeated: ?status=draft&status=submitted."""
    raise todo()


@router.post("/orders", response_model=OrderRead, status_code=status.HTTP_201_CREATED)
async def create_order(body: OrderCreate, user: CustomerUser, session: Session):
    """Creates a draft (and its first event). Archived items/addresses are rejected (422)."""
    raise todo()


@router.get("/orders/{order_id}", response_model=OrderRead)
async def get_order(order_id: int, user: CustomerUser, session: Session):
    raise todo()


@router.patch("/orders/{order_id}", response_model=OrderRead)
async def update_order(order_id: int, body: OrderUpdate, user: CustomerUser, session: Session):
    """Draft orders only (409 otherwise)."""
    raise todo()


@router.post("/orders/{order_id}/submit", response_model=OrderRead)
async def submit_order(order_id: int, user: CustomerUser, session: Session,
                       body: StatusNote | None = None):
    """draft → submitted. Prices the order (stores a Quote and links it)."""
    raise todo()


@router.post("/orders/{order_id}/cancel", response_model=OrderRead)
async def cancel_order(order_id: int, user: CustomerUser, session: Session,
                       body: StatusNote | None = None):
    """draft | submitted → cancelled."""
    raise todo()
