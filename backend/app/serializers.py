"""
Shared ORM → response conversions for orders (used by the portal and ops
routers). Orchestrator-owned: ask before changing.
"""

from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from app.models import Driver as DriverRow
from app.models import Order, ProofOfDelivery, User
from app.schemas import (
    AddressRead,
    OrderEventRead,
    OrderLineRead,
    OrderRead,
    OrderSummary,
    PodRead,
    QuoteRead,
)


def pod_photo_url(pod_id: int) -> str:
    return f"/api/pods/{pod_id}/photo"


def order_summary(order: Order) -> OrderSummary:
    """Needs order.lines, .pickup_address, .delivery_address, .quote, .company (all selectin)."""
    lines = order.lines
    return OrderSummary(
        id=order.id,
        reference=order.reference,
        status=order.status,
        company_id=order.company_id,
        company_name=order.company.name,
        delivery_date=order.delivery_date,
        window_start=order.window_start,
        window_end=order.window_end,
        customer_reference=order.customer_reference,
        pickup_label=order.pickup_address.label,
        delivery_label=order.delivery_address.label,
        delivery_suburb=order.delivery_address.suburb,
        zone=order.delivery_address.zone,
        line_count=len(lines),
        total_units=sum(ln.quantity for ln in lines),
        total_weight_kg=round(sum(ln.unit_weight_kg * ln.quantity for ln in lines), 3),
        total_volume_m3=round(sum(ln.unit_volume_m3 * ln.quantity for ln in lines), 4),
        total_pallet_spaces=round(sum(ln.unit_pallet_spaces * ln.quantity for ln in lines), 3),
        amount=order.quote.amount if order.quote else None,
        plan_id=order.plan_id,
        created_at=order.created_at,
        updated_at=order.updated_at,
    )


async def pods_for(session: AsyncSession, order_id: int) -> list[PodRead]:
    rows = (await session.exec(
        select(ProofOfDelivery, DriverRow.name)
        .join(DriverRow, DriverRow.id == ProofOfDelivery.driver_id)
        .where(ProofOfDelivery.order_id == order_id)
        .order_by(ProofOfDelivery.id)
    )).all()
    return [
        PodRead(id=p.id, order_id=p.order_id, signed_by=p.signed_by, note=p.note,
                created_at=p.created_at, driver_name=name, photo_url=pod_photo_url(p.id))
        for p, name in rows
    ]


async def order_read(session: AsyncSession, order: Order) -> OrderRead:
    """Full order detail. Looks up event actors' names and the PODs."""
    actor_ids = {e.actor_id for e in order.events if e.actor_id is not None}
    actors: dict = {}
    if actor_ids:
        for u in (await session.exec(select(User).where(User.id.in_(actor_ids)))).all():
            actors[u.id] = u
    events = []
    for e in order.events:
        ev = OrderEventRead.model_validate(e)
        if e.actor_id in actors:
            ev.actor_name = actors[e.actor_id].full_name or actors[e.actor_id].email
            ev.actor_role = actors[e.actor_id].role
        events.append(ev)
    return OrderRead(
        **order_summary(order).model_dump(),
        pickup_address=AddressRead.model_validate(order.pickup_address),
        delivery_address=AddressRead.model_validate(order.delivery_address),
        notes=order.notes,
        lines=[OrderLineRead.model_validate(ln) for ln in order.lines],
        events=events,
        quote=QuoteRead.model_validate(order.quote) if order.quote else None,
        pods=await pods_for(session, order.id),
        submitted_at=order.submitted_at,
        delivered_at=order.delivered_at,
    )
