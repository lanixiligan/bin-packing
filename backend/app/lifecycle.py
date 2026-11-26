"""
Order lifecycle: the ONLY place that changes Order.status.

    draft ──► submitted ──► accepted ──► planned ──► picked_up ──► in_transit ──► delivered
      │           │    └──► rejected        │             │               └──► exception
      └──► cancelled ◄┘                     └──► exception └──► exception

Every change writes one OrderEvent (timestamp, actor, optional note).
Callers commit the session; `transition()` only stages the changes.

Owner: Agent A. Other modules call `transition()`, `can_transition()` and
`next_statuses()`; they never assign `order.status` directly.
"""

from datetime import datetime

from sqlalchemy import update
from sqlmodel.ext.asyncio.session import AsyncSession

from app.models import Order, OrderEvent, OrderStatus, User, UserRole, utcnow

S = OrderStatus
R = UserRole

# (from, to) -> roles allowed to make that change.
TRANSITIONS: dict[tuple[OrderStatus, OrderStatus], frozenset[UserRole]] = {
    (S.draft, S.submitted): frozenset({R.customer}),
    (S.draft, S.cancelled): frozenset({R.customer}),
    (S.submitted, S.cancelled): frozenset({R.customer}),
    (S.submitted, S.accepted): frozenset({R.dispatcher}),
    (S.submitted, S.rejected): frozenset({R.dispatcher}),
    (S.accepted, S.planned): frozenset({R.dispatcher}),      # plan locked
    (S.planned, S.picked_up): frozenset({R.driver}),
    (S.planned, S.exception): frozenset({R.driver}),         # pickup failed
    (S.picked_up, S.in_transit): frozenset({R.driver}),
    (S.picked_up, S.exception): frozenset({R.driver}),
    (S.in_transit, S.delivered): frozenset({R.driver}),      # via POD upload
    (S.in_transit, S.exception): frozenset({R.driver}),
}

TERMINAL: frozenset[OrderStatus] = frozenset({S.rejected, S.cancelled, S.delivered, S.exception})


class TransitionError(Exception):
    """Raised for a change that is not allowed. main.py maps it to HTTP 409."""

    def __init__(self, message: str, *, from_status: OrderStatus | None = None,
                 to_status: OrderStatus | None = None):
        super().__init__(message)
        self.message = message
        self.from_status = from_status
        self.to_status = to_status


def can_transition(from_status: OrderStatus, to_status: OrderStatus, role: UserRole) -> bool:
    return role in TRANSITIONS.get((from_status, to_status), frozenset())


def next_statuses(status: OrderStatus, role: UserRole) -> list[OrderStatus]:
    """Statuses `role` may move an order in `status` to, in lifecycle order."""
    return [to for (frm, to), roles in TRANSITIONS.items() if frm == status and role in roles]


def _label(s: OrderStatus) -> str:
    return s.value.replace("_", " ")


async def transition(
    session: AsyncSession,
    order: Order,
    to_status: OrderStatus,
    actor: User,
    note: str | None = None,
    *,
    now: datetime | None = None,
) -> OrderEvent:
    """
    Move `order` to `to_status` on behalf of `actor` and stage an OrderEvent.

    The status is changed with a conditional UPDATE (… WHERE status = <the
    status we checked>), so two concurrent requests can't both succeed: the
    loser gets a TransitionError. Does not commit.
    """
    from_status = order.status
    if (from_status, to_status) not in TRANSITIONS:
        raise TransitionError(
            f"An order that is {_label(from_status)} cannot become {_label(to_status)}.",
            from_status=from_status, to_status=to_status,
        )
    if actor.role not in TRANSITIONS[(from_status, to_status)]:
        raise TransitionError(
            f"A {actor.role.value} cannot change an order from {_label(from_status)} "
            f"to {_label(to_status)}.",
            from_status=from_status, to_status=to_status,
        )

    now = now or utcnow()
    values: dict = {"status": to_status, "updated_at": now}
    if to_status == S.submitted:
        values["submitted_at"] = now
    if to_status == S.delivered:
        values["delivered_at"] = now

    result = await session.execute(
        update(Order)
        .where(Order.id == order.id, Order.status == from_status)
        .values(**values)
        .execution_options(synchronize_session=False)
    )
    if result.rowcount != 1:
        raise TransitionError(
            "The order was changed by someone else just now. Reload and try again.",
            from_status=from_status, to_status=to_status,
        )
    for key, value in values.items():
        setattr(order, key, value)

    event = OrderEvent(
        order_id=order.id, from_status=from_status, to_status=to_status,
        actor_id=actor.id, note=(note.strip() or None) if note else None, created_at=now,
    )
    session.add(event)
    return event


def record_created(order: Order, actor: User, *, now: datetime | None = None) -> OrderEvent:
    """The first event of a new draft order (from_status = None). Call after the
    order has an id (flush), then add the returned event to the session."""
    return OrderEvent(
        order_id=order.id, from_status=None, to_status=order.status,
        actor_id=actor.id, note=None, created_at=now or utcnow(),
    )
