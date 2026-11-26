"""The order lifecycle (app/lifecycle.py): transition table, events, conflicts, HTTP mapping."""

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

import pytest
from sqlmodel import select

from app import lifecycle
from app.db import SessionLocal
from app.lifecycle import TRANSITIONS, TransitionError, check_transition, next_statuses, transition
from app.models import Order, OrderEvent, OrderStatus, User, UserRole, utcnow
from tests.factories import make_address, make_item, make_order

S = OrderStatus
R = UserRole

# The documented table (docs/api.md), written out independently of the module.
DOCUMENTED = {
    (S.draft, S.submitted): {R.customer},
    (S.draft, S.cancelled): {R.customer},
    (S.submitted, S.cancelled): {R.customer},
    (S.submitted, S.accepted): {R.dispatcher},
    (S.submitted, S.rejected): {R.dispatcher},
    (S.accepted, S.planned): {R.dispatcher},
    (S.planned, S.picked_up): {R.driver},
    (S.picked_up, S.in_transit): {R.driver},
    (S.in_transit, S.delivered): {R.driver},
    (S.planned, S.exception): {R.driver},
    (S.picked_up, S.exception): {R.driver},
    (S.in_transit, S.exception): {R.driver},
}
ALLOWED = [(frm, to, role) for (frm, to), roles in sorted(DOCUMENTED.items()) for role in sorted(roles)]


@dataclass
class Env:
    actors: dict[UserRole, User]
    company: object
    pickup: object
    delivery: object
    item: object

    async def order(self, session, status: OrderStatus) -> Order:
        return await make_order(session, company=self.company, created_by=self.actors[R.customer],
                                pickup=self.pickup, delivery=self.delivery, lines=[(self.item, 1)],
                                status=status)


@pytest.fixture
async def env(session, customer, dispatcher, driver) -> Env:
    return Env(
        actors={R.customer: customer.user, R.dispatcher: dispatcher.user, R.driver: driver.user},
        company=customer.company,
        pickup=await make_address(session, customer.company, label="Warehouse"),
        delivery=await make_address(session, customer.company, label="Site"),
        item=await make_item(session, customer.company),
    )


async def _events(session, order_id: int) -> list[OrderEvent]:
    return list((await session.exec(
        select(OrderEvent).where(OrderEvent.order_id == order_id).order_by(OrderEvent.id))).all())


# ---- The table --------------------------------------------------------------------

def test_table_matches_the_documented_lifecycle():
    assert {k: set(v) for k, v in TRANSITIONS.items()} == DOCUMENTED


def test_terminal_statuses_have_no_way_out():
    assert lifecycle.TERMINAL == {S.rejected, S.cancelled, S.delivered, S.exception}
    for status in lifecycle.TERMINAL:
        assert all(frm != status for frm, _ in TRANSITIONS)
        assert all(next_statuses(status, role) == [] for role in R)


@pytest.mark.parametrize("role", list(R))
@pytest.mark.parametrize("status", list(S))
def test_next_statuses_matches_the_table(status, role):
    expected = [to for (frm, to), roles in DOCUMENTED.items() if frm == status and role in roles]
    got = next_statuses(status, role)
    assert set(got) == set(expected) and len(got) == len(expected)
    for to in S:
        assert lifecycle.can_transition(status, to, role) == (to in expected)


def test_next_statuses_examples():
    assert next_statuses(S.planned, R.driver) == [S.picked_up, S.exception]
    assert next_statuses(S.in_transit, R.driver) == [S.delivered, S.exception]
    assert next_statuses(S.submitted, R.dispatcher) == [S.accepted, S.rejected]
    assert next_statuses(S.submitted, R.customer) == [S.cancelled]
    assert next_statuses(S.draft, R.customer) == [S.submitted, S.cancelled]
    assert next_statuses(S.planned, R.customer) == []


def test_check_transition_messages():
    with pytest.raises(TransitionError) as e:
        check_transition(S.delivered, S.cancelled, R.customer)
    assert e.value.message == "An order that is delivered cannot become cancelled."
    assert (e.value.from_status, e.value.to_status) == (S.delivered, S.cancelled)
    with pytest.raises(TransitionError) as e:
        check_transition(S.submitted, S.accepted, R.customer)
    assert e.value.message == "A customer cannot change an order from submitted to accepted."
    with pytest.raises(TransitionError) as e:
        check_transition(S.picked_up, S.in_transit, R.dispatcher)
    assert "picked up" in e.value.message and "in transit" in e.value.message
    check_transition(S.draft, S.submitted, R.customer)  # allowed: no error


# ---- transition() -----------------------------------------------------------------

@pytest.mark.parametrize(("frm", "to", "role"), ALLOWED)
async def test_allowed_transition_writes_one_event(session, env, frm, to, role):
    order = await env.order(session, frm)
    before = utcnow()
    event = await transition(session, order, to, env.actors[role], f"  note for {to.value}  ")
    assert order.status == to  # the object reflects the change straight away
    await session.commit()

    fresh = await session.get(Order, order.id, populate_existing=True)
    assert fresh.status == to
    assert fresh.updated_at >= before
    assert (fresh.submitted_at is not None) == (to == S.submitted)
    assert (fresh.delivered_at is not None) == (to == S.delivered)
    events = await _events(session, order.id)
    assert len(events) == 2 and events[-1].id == event.id
    ev = events[-1]
    assert (ev.from_status, ev.to_status) == (frm, to)
    assert ev.actor_id == env.actors[role].id
    assert ev.note == f"note for {to.value}"
    assert ev.created_at >= before and ev.created_at == fresh.updated_at
    if to == S.submitted:
        assert fresh.submitted_at == ev.created_at
    if to == S.delivered:
        assert fresh.delivered_at == ev.created_at


async def test_every_other_combination_is_rejected(session, env):
    orders = {status: await env.order(session, status) for status in S}
    tried = 0
    for frm in S:
        for to in S:
            for role in R:
                if role in DOCUMENTED.get((frm, to), set()):
                    continue
                with pytest.raises(TransitionError):
                    await transition(session, orders[frm], to, env.actors[role], "nope")
                tried += 1
    assert tried == len(S) * len(S) * len(R) - len(ALLOWED)
    await session.commit()
    for status, order in orders.items():
        fresh = await session.get(Order, order.id, populate_existing=True)
        assert fresh.status == status
        assert len(await _events(session, order.id)) == 1  # only the factory's "created" event


async def test_explicit_timestamp_and_blank_note(session, env):
    order = await env.order(session, S.in_transit)
    at = datetime(2026, 1, 15, 3, 30, tzinfo=UTC)
    await transition(session, order, S.delivered, env.actors[R.driver], "   ", now=at)
    await session.commit()
    fresh = await session.get(Order, order.id, populate_existing=True)
    assert fresh.delivered_at == at and fresh.updated_at == at
    ev = (await _events(session, order.id))[-1]
    assert ev.created_at == at and ev.note is None


async def test_chain_of_transitions_has_increasing_timestamps(session, env):
    order = await env.order(session, S.draft)
    path = [(S.submitted, R.customer), (S.accepted, R.dispatcher), (S.planned, R.dispatcher),
            (S.picked_up, R.driver), (S.in_transit, R.driver), (S.delivered, R.driver)]
    for to, role in path:
        await transition(session, order, to, env.actors[role])
    await session.commit()
    events = await _events(session, order.id)
    assert [e.to_status for e in events] == [S.draft] + [to for to, _ in path]
    assert [e.from_status for e in events[1:]] == [e.to_status for e in events[:-1]]
    assert [e.actor_id for e in events[1:]] == [env.actors[role].id for _, role in path]
    stamps = [e.created_at for e in events]
    assert stamps == sorted(stamps)


async def test_stale_object_raises_conflict_and_writes_no_event(session, env):
    order = await env.order(session, S.submitted)
    order_id = order.id
    async with SessionLocal() as other:  # someone else accepts it first
        theirs = await other.get(Order, order_id)
        await transition(other, theirs, S.accepted, env.actors[R.dispatcher])
        await other.commit()

    assert order.status == S.submitted  # our copy is stale
    with pytest.raises(TransitionError) as e:
        await transition(session, order, S.cancelled, env.actors[R.customer], "too late")
    assert "changed by someone else" in e.value.message
    await session.rollback()  # expires `order`; use the saved id from here on

    fresh = await session.get(Order, order_id, populate_existing=True)
    assert fresh.status == S.accepted
    events = await _events(session, order_id)
    assert [e.to_status for e in events] == [S.submitted, S.accepted]
    assert all(e.note != "too late" for e in events)


async def test_concurrent_changes_only_one_wins(env, session):
    order = await env.order(session, S.submitted)
    async with SessionLocal() as s1, SessionLocal() as s2:
        # Both load the order before either changes it.
        o1, o2 = await s1.get(Order, order.id), await s2.get(Order, order.id)
        await transition(s1, o1, S.accepted, env.actors[R.dispatcher])
        await s1.commit()
        with pytest.raises(TransitionError):
            await transition(s2, o2, S.rejected, env.actors[R.dispatcher], "no")
        await s2.rollback()
    assert [e.to_status for e in await _events(session, order.id)] == [S.submitted, S.accepted]


async def test_unsaved_order_is_a_programming_error(env):
    with pytest.raises(ValueError):
        await transition(None, Order(status=S.draft), S.submitted, env.actors[R.customer])


async def test_record_created(session, env):
    order = await env.order(session, S.draft)
    at = utcnow() - timedelta(hours=1)
    ev = lifecycle.record_created(order, env.actors[R.customer], now=at)
    assert (ev.order_id, ev.from_status, ev.to_status, ev.created_at) == (order.id, None, S.draft, at)
    assert ev.actor_id == env.actors[R.customer].id and ev.note is None


# ---- HTTP mapping -------------------------------------------------------------------

async def test_http_layer_maps_transition_errors_to_409(client, session, env, customer):
    order = await env.order(session, S.delivered)
    r = await client.post(f"/api/portal/orders/{order.id}/cancel", json={"note": "please"},
                          headers=customer.headers)
    assert r.status_code == 409
    assert r.json() == {"detail": "An order that is delivered cannot become cancelled."}
    assert len(await _events(session, order.id)) == 1
