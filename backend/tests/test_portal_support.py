"""Shared builders for the portal tests (no tests in here)."""

from dataclasses import dataclass
from datetime import date, timedelta
from typing import Any

from sqlmodel.ext.asyncio.session import AsyncSession

from app.config import settings
from app.models import Address, Item, Zone
from tests.factories import make_address, make_item, make_zone


def today() -> date:
    return settings.today()


def in_days(n: int) -> str:
    return (settings.today() + timedelta(days=n)).isoformat()


@dataclass
class Catalog:
    """A company's addresses and items for building orders."""
    pickup: Address
    delivery: Address      # zoned
    unzoned: Address
    item: Item             # 100 kg, 0.5 m³
    bulky: Item            # 10 kg, 1.0 m³ (cubic weight 250 kg)
    zone: Zone | None = None


async def make_catalog(session: AsyncSession, company, *, zone: Zone | None = None,
                       sku_prefix: str = "") -> Catalog:
    code = zone.code if zone else None
    return Catalog(
        pickup=await make_address(session, company, label="Warehouse", suburb="Wetherill Park"),
        delivery=await make_address(session, company, label="Site A", zone=code, suburb="Chatswood"),
        unzoned=await make_address(session, company, label="Site B", suburb="Gosford"),
        item=await make_item(session, company, sku=f"{sku_prefix}BOX-1", weight_kg=100, volume_m3=0.5),
        bulky=await make_item(session, company, sku=f"{sku_prefix}BATTS", weight_kg=10, volume_m3=1.0),
        zone=zone,
    )


async def zone_north(session: AsyncSession) -> Zone:
    return await make_zone(session, "NORTH", "0.45")


def order_body(cat: Catalog, **overrides: Any) -> dict[str, Any]:
    body: dict[str, Any] = {
        "pickup_address_id": cat.pickup.id,
        "delivery_address_id": cat.delivery.id,
        "delivery_date": in_days(1),
        "customer_reference": "PO-1",
        "lines": [{"item_id": cat.item.id, "quantity": 3}],
    }
    body.update(overrides)
    return body


async def create_order(client, actor, cat: Catalog, **overrides: Any) -> dict[str, Any]:
    r = await client.post("/api/portal/orders", json=order_body(cat, **overrides), headers=actor.headers)
    assert r.status_code == 201, r.text
    return r.json()


async def submitted_order(client, actor, cat: Catalog, **overrides: Any) -> dict[str, Any]:
    order = await create_order(client, actor, cat, **overrides)
    r = await client.post(f"/api/portal/orders/{order['id']}/submit", headers=actor.headers)
    assert r.status_code == 200, r.text
    return r.json()
