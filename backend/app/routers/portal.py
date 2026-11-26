"""
Customer portal API: /api/portal/*. Owner: Agent A.

Every route requires role=customer, and EVERY query must be filtered by
`user.company_id`. Another company's row must look exactly like a missing
row (404), never 403, so ids can't be probed.

Error conventions used here:
* An id in the PATH that is missing, or belongs to another company → 404.
* An id in the BODY (an item or address referenced by an order or a quote
  preview) that is missing, archived or belongs to another company → 422
  with a readable `detail` string. The message is the same for all three
  cases, so it can't be used to probe other companies' ids either.
* Invalid status changes → 409 (TransitionError, mapped in app.main).
"""

from collections.abc import Iterable
from datetime import date
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.exc import IntegrityError
from sqlmodel import col, select
from sqlmodel.ext.asyncio.session import AsyncSession

from app import lifecycle, pricing
from app.auth import CustomerUser
from app.config import settings
from app.db import get_session
from app.models import Address, Item, Order, OrderLine, OrderStatus, User, utcnow
from app.schemas import (
    AddressCreate,
    AddressRead,
    AddressUpdate,
    ItemCreate,
    ItemRead,
    ItemUpdate,
    OrderCreate,
    OrderLineIn,
    OrderRead,
    OrderSummary,
    OrderUpdate,
    QuotePreviewRequest,
    QuoteRead,
    StatusNote,
)
from app.serializers import order_read, order_summary

router = APIRouter()
Session = Annotated[AsyncSession, Depends(get_session)]


# ---- Helpers ------------------------------------------------------------------------

def _unprocessable(message: str) -> HTTPException:
    return HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, message)


def _no_nulls(changes: dict[str, Any], fields: Iterable[str]) -> None:
    """PATCH: `null` only clears nullable fields; for required ones it's a 422."""
    for name in fields:
        if name in changes and changes[name] is None:
            raise _unprocessable(f"'{name}' cannot be empty.")


async def _owned(session: AsyncSession, model, row_id: int, user: User, what: str):
    """The row `row_id` of `model` if it belongs to the caller's company, else 404."""
    row = (await session.exec(
        select(model).where(model.id == row_id, model.company_id == user.company_id)
    )).first()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"{what} not found.")
    return row


async def _usable_address(session: AsyncSession, address_id: int, user: User, role: str) -> Address:
    """An address referenced in a body: own company and not archived (422 otherwise)."""
    addr = (await session.exec(
        select(Address).where(Address.id == address_id, Address.company_id == user.company_id)
    )).first()
    if addr is None or addr.archived:
        raise _unprocessable(f"The {role} address (id {address_id}) doesn't exist or is archived.")
    return addr


async def _usable_items(session: AsyncSession, lines: list[OrderLineIn], user: User) -> dict[int, Item]:
    """The items referenced by `lines`: own company and not archived (422 otherwise)."""
    ids = [ln.item_id for ln in lines]
    rows = (await session.exec(
        select(Item).where(col(Item.id).in_(ids), Item.company_id == user.company_id)
    )).all()
    items = {it.id: it for it in rows}
    for item_id in ids:
        item = items.get(item_id)
        if item is None or item.archived:
            raise _unprocessable(f"Item {item_id} doesn't exist or is archived.")
    return items


def _check_delivery_date(d: date) -> None:
    if d < settings.today():
        raise _unprocessable(
            f"The delivery date {d.isoformat()} is in the past. Choose today or a later date."
        )


def _make_lines(lines: list[OrderLineIn], items: dict[int, Item]) -> list[OrderLine]:
    """Order lines with a snapshot of the item's current values."""
    out = []
    for ln in lines:
        item = items[ln.item_id]
        out.append(OrderLine(
            item_id=item.id, quantity=ln.quantity, item_name=item.name, item_sku=item.sku,
            unit_weight_kg=item.weight_kg, unit_volume_m3=item.volume_m3,
            unit_pallet_spaces=item.pallet_spaces,
        ))
    return out


def _priced(lines: Iterable[Any]) -> list[pricing.PricedLine]:
    return [pricing.PricedLine(unit_weight_kg=ln.unit_weight_kg, unit_volume_m3=ln.unit_volume_m3,
                               quantity=ln.quantity) for ln in lines]


async def _reload_order(session: AsyncSession, order_id: int) -> Order:
    """Fresh copy of an order with every relationship (re)loaded."""
    return await session.get(Order, order_id, populate_existing=True)


async def _own_order(session: AsyncSession, order_id: int, user: User) -> Order:
    return await _owned(session, Order, order_id, user, "Order")


async def _own_order_locked(session: AsyncSession, order_id: int, user: User) -> Order:
    """The customer's order with its row locked (FOR UPDATE) until commit, freshly
    loaded. Edit, submit and cancel take this lock, so an edit can't change the
    lines of an order that a concurrent submit has just priced."""
    order = (await session.exec(
        select(Order).where(Order.id == order_id, Order.company_id == user.company_id)
        .with_for_update().execution_options(populate_existing=True)
    )).first()
    if order is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Order not found.")
    return order


# ---- Items ------------------------------------------------------------------

async def _sku_taken(session: AsyncSession, user: User, sku: str, exclude_id: int | None = None) -> None:
    query = select(Item).where(Item.company_id == user.company_id, Item.sku == sku)
    if exclude_id is not None:
        query = query.where(Item.id != exclude_id)
    other = (await session.exec(query)).first()
    if other is not None:
        archived = " (archived)" if other.archived else ""
        raise HTTPException(status.HTTP_409_CONFLICT,
                            f"SKU {sku} is already used by \"{other.name}\"{archived}.")


async def _commit_item(session: AsyncSession, item: Item) -> None:
    """Commit; a unique-SKU race that slipped past the check is still a 409."""
    try:
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, f"SKU {item.sku} is already used.") from exc


@router.get("/items", response_model=list[ItemRead])
async def list_items(user: CustomerUser, session: Session, include_archived: bool = False):
    query = select(Item).where(Item.company_id == user.company_id)
    if not include_archived:
        query = query.where(Item.archived == False)  # noqa: E712
    return (await session.exec(query.order_by(Item.name, Item.id))).all()


@router.post("/items", response_model=ItemRead, status_code=status.HTTP_201_CREATED)
async def create_item(body: ItemCreate, user: CustomerUser, session: Session):
    """409 if the SKU is already used by this company."""
    data = body.model_dump()
    data["sku"], data["name"] = data["sku"].strip(), data["name"].strip()
    if not data["sku"] or not data["name"]:
        raise _unprocessable("SKU and name cannot be blank.")
    await _sku_taken(session, user, data["sku"])
    item = Item(company_id=user.company_id, **data)
    session.add(item)
    await _commit_item(session, item)
    return item


@router.get("/items/{item_id}", response_model=ItemRead)
async def get_item(item_id: int, user: CustomerUser, session: Session):
    return await _owned(session, Item, item_id, user, "Item")


@router.patch("/items/{item_id}", response_model=ItemRead)
async def update_item(item_id: int, body: ItemUpdate, user: CustomerUser, session: Session):
    item = await _owned(session, Item, item_id, user, "Item")
    changes = body.model_dump(exclude_unset=True)
    _no_nulls(changes, ("sku", "name", "weight_kg", "volume_m3", "pallet_spaces"))
    for key in ("sku", "name"):
        if key in changes:
            changes[key] = changes[key].strip()
            if not changes[key]:
                raise _unprocessable(f"'{key}' cannot be blank.")
    if "sku" in changes and changes["sku"] != item.sku:
        await _sku_taken(session, user, changes["sku"], exclude_id=item.id)
    for key, value in changes.items():
        setattr(item, key, value)
    await _commit_item(session, item)
    return item


@router.delete("/items/{item_id}", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
async def archive_item(item_id: int, user: CustomerUser, session: Session):
    """Archives (soft-deletes): existing orders keep their lines."""
    item = await _owned(session, Item, item_id, user, "Item")
    item.archived = True
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---- Addresses ----------------------------------------------------------------

@router.get("/addresses", response_model=list[AddressRead])
async def list_addresses(user: CustomerUser, session: Session, include_archived: bool = False):
    query = select(Address).where(Address.company_id == user.company_id)
    if not include_archived:
        query = query.where(Address.archived == False)  # noqa: E712
    return (await session.exec(query.order_by(Address.label, Address.id))).all()


@router.post("/addresses", response_model=AddressRead, status_code=status.HTTP_201_CREATED)
async def create_address(body: AddressCreate, user: CustomerUser, session: Session):
    # AddressCreate has no `zone` (extra fields are ignored), so it always starts unzoned.
    addr = Address(company_id=user.company_id, **body.model_dump())
    addr.country = addr.country.upper()
    session.add(addr)
    await session.commit()
    return addr


@router.get("/addresses/{address_id}", response_model=AddressRead)
async def get_address(address_id: int, user: CustomerUser, session: Session):
    return await _owned(session, Address, address_id, user, "Address")


@router.patch("/addresses/{address_id}", response_model=AddressRead)
async def update_address(address_id: int, body: AddressUpdate, user: CustomerUser, session: Session):
    """Customers cannot set `zone` (dispatchers do).

    Moving the address (any location field) clears its zone, so the dispatcher
    re-zones it and quotes use the right rate. It is refused with 409 while an order
    past draft uses the address: those orders were priced, planned or invoiced for
    the old location. The customer adds a new address instead."""
    addr = await _owned(session, Address, address_id, user, "Address")
    changes = body.model_dump(exclude_unset=True)  # AddressUpdate has no `zone` field
    _no_nulls(changes, ("label", "line1", "suburb", "state", "postcode", "country"))
    if "country" in changes:
        changes["country"] = changes["country"].upper()
    moved = any(getattr(addr, key) != changes[key] for key in _LOCATION_FIELDS if key in changes)
    if moved:
        in_use = (await session.exec(
            select(Order.id).where(
                (Order.pickup_address_id == addr.id) | (Order.delivery_address_id == addr.id),
                col(Order.status).not_in(_ADDRESS_EDITABLE_STATUSES),
            ).limit(1)
        )).first()
        if in_use is not None:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                "This address is used by orders that are already submitted, so its location "
                "can't change. Add a new address instead.",
            )
        addr.zone = None
    for key, value in changes.items():
        setattr(addr, key, value)
    await session.commit()
    return addr


_LOCATION_FIELDS = ("line1", "line2", "suburb", "state", "postcode", "country")
# Orders in these statuses don't hold on to their address's location.
_ADDRESS_EDITABLE_STATUSES = (OrderStatus.draft, OrderStatus.rejected, OrderStatus.cancelled)


@router.delete("/addresses/{address_id}", status_code=status.HTTP_204_NO_CONTENT,
               response_class=Response)
async def archive_address(address_id: int, user: CustomerUser, session: Session):
    addr = await _owned(session, Address, address_id, user, "Address")
    addr.archived = True
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---- Quotes ---------------------------------------------------------------------

@router.post("/quote-preview", response_model=QuoteRead)
async def quote_preview(body: QuotePreviewRequest, user: CustomerUser, session: Session):
    """Price for these lines to this delivery address. Not stored (id = null)."""
    delivery = await _usable_address(session, body.delivery_address_id, user, "delivery")
    items = await _usable_items(session, body.lines, user)
    quote = await pricing.quote_for_lines(
        session, company_id=user.company_id, delivery_address=delivery,
        lines=_priced(_make_lines(body.lines, items)),
    )
    return QuoteRead.model_validate(quote).model_copy(update={"id": None, "created_at": None})


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
    query = select(Order).where(Order.company_id == user.company_id)
    if status_:
        query = query.where(col(Order.status).in_(status_))
    if from_date is not None:
        query = query.where(Order.delivery_date >= from_date)
    if to_date is not None:
        query = query.where(Order.delivery_date <= to_date)
    query = query.order_by(col(Order.created_at).desc(), col(Order.id).desc()).limit(limit).offset(offset)
    return [order_summary(o) for o in (await session.exec(query)).all()]


@router.post("/orders", response_model=OrderRead, status_code=status.HTTP_201_CREATED)
async def create_order(body: OrderCreate, user: CustomerUser, session: Session):
    """Creates a draft (and its first event). Archived items/addresses are rejected (422)."""
    _check_delivery_date(body.delivery_date)
    await _usable_address(session, body.pickup_address_id, user, "pickup")
    await _usable_address(session, body.delivery_address_id, user, "delivery")
    items = await _usable_items(session, body.lines, user)

    now = utcnow()
    order = Order(
        company_id=user.company_id, created_by_id=user.id, status=OrderStatus.draft,
        **body.model_dump(exclude={"lines"}), created_at=now, updated_at=now,
    )
    order.lines = _make_lines(body.lines, items)
    session.add(order)
    await session.flush()
    session.add(lifecycle.record_created(order, user, now=now))
    await session.commit()
    return await order_read(session, await _reload_order(session, order.id), for_customer=True)


@router.get("/orders/{order_id}", response_model=OrderRead)
async def get_order(order_id: int, user: CustomerUser, session: Session):
    return await order_read(session, await _own_order(session, order_id, user), for_customer=True)


@router.patch("/orders/{order_id}", response_model=OrderRead)
async def update_order(order_id: int, body: OrderUpdate, user: CustomerUser, session: Session):
    """Draft orders only (409 otherwise)."""
    order = await _own_order_locked(session, order_id, user)
    if order.status != OrderStatus.draft:
        raise HTTPException(status.HTTP_409_CONFLICT,
                            f"Only draft orders can be edited; this one is {order.status.value}.")
    changes = body.model_dump(exclude_unset=True)
    _no_nulls(changes, ("pickup_address_id", "delivery_address_id", "delivery_date", "lines"))

    # Check the result of the merge, not just the fields that were sent.
    pickup_id = changes.get("pickup_address_id", order.pickup_address_id)
    delivery_id = changes.get("delivery_address_id", order.delivery_address_id)
    if pickup_id == delivery_id:
        raise _unprocessable("Pickup and delivery addresses must be different.")
    ws = changes.get("window_start", order.window_start)
    we = changes.get("window_end", order.window_end)
    if ws is not None and we is not None and ws >= we:
        raise _unprocessable("The delivery window must end after it starts.")
    if "delivery_date" in changes:
        _check_delivery_date(changes["delivery_date"])
    if "pickup_address_id" in changes:
        await _usable_address(session, pickup_id, user, "pickup")
    if "delivery_address_id" in changes:
        await _usable_address(session, delivery_id, user, "delivery")

    lines = changes.pop("lines", None)
    if lines is not None:
        line_models = body.lines  # validated OrderLineIn objects
        items = await _usable_items(session, line_models, user)
        order.lines = _make_lines(line_models, items)  # delete-orphan removes the old lines
    for key, value in changes.items():
        setattr(order, key, value)
    order.updated_at = utcnow()
    await session.commit()
    return await order_read(session, await _reload_order(session, order.id), for_customer=True)


@router.post("/orders/{order_id}/submit", response_model=OrderRead)
async def submit_order(order_id: int, user: CustomerUser, session: Session,
                       body: StatusNote | None = None):
    """draft → submitted. Prices the order (stores a Quote and links it)."""
    order = await _own_order_locked(session, order_id, user)
    lifecycle.check_transition(order.status, OrderStatus.submitted, user.role)  # 409 early
    _check_delivery_date(order.delivery_date)
    for addr, role in ((order.pickup_address, "pickup"), (order.delivery_address, "delivery")):
        if addr.archived:
            raise _unprocessable(f"The {role} address \"{addr.label}\" is archived. "
                                 "Choose another address before submitting.")
    if not order.lines:
        raise _unprocessable("Add at least one line before submitting.")

    quote = await pricing.quote_for_lines(
        session, company_id=user.company_id, delivery_address=order.delivery_address,
        lines=_priced(order.lines),
    )
    session.add(quote)
    await session.flush()
    order.quote_id = quote.id
    await lifecycle.transition(session, order, OrderStatus.submitted, user, body.note if body else None)
    await session.commit()
    return await order_read(session, await _reload_order(session, order.id), for_customer=True)


@router.post("/orders/{order_id}/cancel", response_model=OrderRead)
async def cancel_order(order_id: int, user: CustomerUser, session: Session,
                       body: StatusNote | None = None):
    """draft | submitted → cancelled."""
    order = await _own_order_locked(session, order_id, user)
    await lifecycle.transition(session, order, OrderStatus.cancelled, user, body.note if body else None)
    await session.commit()
    return await order_read(session, await _reload_order(session, order.id), for_customer=True)
