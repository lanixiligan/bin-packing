"""
Shared ORM → response conversions for orders (used by the portal and ops
routers). Orchestrator-owned: ask before changing.
"""

from collections.abc import Sequence

from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from app import dg as dgrules
from app.models import Driver as DriverRow
from app.models import Order, OrderLine, ProofOfDelivery, User, UserRole
from app.schemas import (
    AddressRead,
    DgConflict,
    OrderEventRead,
    OrderLineRead,
    OrderRead,
    OrderSummary,
    PodRead,
    QuoteRead,
)


def dg_item_label(name: str, dg: dgrules.DgInfo | None) -> str:
    """'Pool chlorine (Class 5.1)'; general freight keeps its bare name."""
    return name if dgrules.is_general(dg) else f"{name} ({dgrules.label(dg)})"


def dg_conflicts(lines: Sequence[OrderLine]) -> list[DgConflict]:
    """Pairs of `lines` that are incompatible, or need a Table 9.2 check (ADG Code)."""
    dgs = [dgrules.parse(ln.dg) for ln in lines]
    out = []
    for c in dgrules.check_all(dgs):
        a, b = lines[c.a], lines[c.b]
        items = [dg_item_label(a.item_name, dgs[c.a]), dg_item_label(b.item_name, dgs[c.b])]
        if c.status == "incompatible":
            message = f"{items[0]} and {items[1]} can't travel on the same vehicle. " + " ".join(c.reasons)
        else:
            message = f"Check {items[0]} with {items[1]}: " + " ".join(c.reasons)
        out.append(DgConflict(status=c.status, order_line_ids=[a.id, b.id], items=items, message=message))
    return out


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


async def order_read(session: AsyncSession, order: Order, *, for_customer: bool = False) -> OrderRead:
    """Full order detail. Looks up event actors' names and the PODs.

    `for_customer` hides staff identities: dispatcher and driver events keep their
    role and display name, but not the user id or the e-mail address."""
    actor_ids = {e.actor_id for e in order.events if e.actor_id is not None}
    actors: dict = {}
    if actor_ids:
        for u in (await session.exec(select(User).where(User.id.in_(actor_ids)))).all():
            actors[u.id] = u
    events = []
    for e in order.events:
        ev = OrderEventRead.model_validate(e)
        actor = actors.get(e.actor_id)
        if actor is not None:
            ev.actor_role = actor.role
            if for_customer and actor.role != UserRole.customer:
                ev.actor_id = None
                ev.actor_name = actor.full_name or None
            else:
                ev.actor_name = actor.full_name or actor.email
        events.append(ev)
    return OrderRead(
        **order_summary(order).model_dump(),
        pickup_address=AddressRead.model_validate(order.pickup_address),
        delivery_address=AddressRead.model_validate(order.delivery_address),
        notes=order.notes,
        lines=[OrderLineRead.model_validate(ln) for ln in order.lines],
        dg_conflicts=dg_conflicts(order.lines),
        events=events,
        quote=QuoteRead.model_validate(order.quote) if order.quote else None,
        pods=await pods_for(session, order.id),
        submitted_at=order.submitted_at,
        delivered_at=order.delivered_at,
    )
