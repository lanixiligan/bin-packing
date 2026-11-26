"""
Test data builders that write straight to the database (no HTTP).
Orchestrator-owned. `make_order(status=...)` sets the status DIRECTLY for
test setup; production code must use app.lifecycle.transition().
"""

from datetime import date, timedelta
from decimal import Decimal

from sqlmodel.ext.asyncio.session import AsyncSession

from app.models import (
    Address,
    Company,
    Item,
    Order,
    OrderEvent,
    OrderLine,
    OrderStatus,
    Quote,
    User,
    Vehicle,
    Zone,
)


def tomorrow() -> date:
    return date.today() + timedelta(days=1)


async def make_zone(session: AsyncSession, code: str = "NORTH", rate: str = "0.50",
                    name: str | None = None) -> Zone:
    zone = Zone(code=code, name=name or code.title(), rate_per_kg=Decimal(rate))
    session.add(zone)
    await session.commit()
    return zone


async def make_address(session: AsyncSession, company: Company, *, label: str = "Warehouse",
                       zone: str | None = None, suburb: str = "Parramatta") -> Address:
    addr = Address(company_id=company.id, label=label, line1="1 Test St", suburb=suburb,
                   state="NSW", postcode="2150", zone=zone, contact_name="Sam", phone="0400 111 222")
    session.add(addr)
    await session.commit()
    return addr


async def make_item(session: AsyncSession, company: Company, *, sku: str = "BOX-1",
                    name: str | None = None, weight_kg: float = 100, volume_m3: float = 0.5,
                    pallet_spaces: float = 0, dg: dict | None = None) -> Item:
    """`dg`: DG data as a dict (e.g. {"dg_class": "3"}), normalised like the API stores it."""
    from app import dg as dgrules
    item = Item(company_id=company.id, sku=sku, name=name or f"Item {sku}", weight_kg=weight_kg,
                volume_m3=volume_m3, pallet_spaces=pallet_spaces,
                dg=dgrules.to_json(dgrules.parse(dg)))
    session.add(item)
    await session.commit()
    return item


async def make_vehicle(session: AsyncSession, *, name: str = "Truck 1", registration: str = "TRK001",
                       max_weight_kg: float | None = 1000, max_volume_m3: float | None = None,
                       max_pallets: int | None = None) -> Vehicle:
    v = Vehicle(name=name, registration=registration, max_weight_kg=max_weight_kg,
                max_volume_m3=max_volume_m3, max_pallets=max_pallets)
    session.add(v)
    await session.commit()
    return v


async def make_order(
    session: AsyncSession,
    *,
    company: Company,
    created_by: User,
    pickup: Address,
    delivery: Address,
    lines: list[tuple[Item, int]],
    status: OrderStatus = OrderStatus.draft,
    delivery_date: date | None = None,
    with_quote: bool = True,
) -> Order:
    """An order with lines (item snapshot copied), one 'created' event, and a
    quote if the status is past draft."""
    order = Order(company_id=company.id, created_by_id=created_by.id, status=status,
                  pickup_address_id=pickup.id, delivery_address_id=delivery.id,
                  delivery_date=delivery_date or tomorrow())
    for item, qty in lines:
        order.lines.append(OrderLine(
            item_id=item.id, quantity=qty, item_name=item.name, item_sku=item.sku,
            unit_weight_kg=item.weight_kg, unit_volume_m3=item.volume_m3,
            unit_pallet_spaces=item.pallet_spaces, dg=item.dg,
        ))
    if with_quote and status != OrderStatus.draft:
        w = sum(i.weight_kg * q for i, q in lines)
        quote = Quote(company_id=company.id, zone_code=delivery.zone, total_weight_kg=w,
                      total_volume_m3=sum(i.volume_m3 * q for i, q in lines),
                      cubic_weight_kg=w, rate_per_kg=Decimal("0.50"),
                      amount=(Decimal(str(w)) * Decimal("0.50")).quantize(Decimal("0.01")))
        session.add(quote)
        await session.flush()
        order.quote_id = quote.id
    session.add(order)
    await session.flush()
    session.add(OrderEvent(order_id=order.id, from_status=None, to_status=status,
                           actor_id=created_by.id, note="factory"))
    await session.commit()
    return await session.get(Order, order.id, populate_existing=True)
