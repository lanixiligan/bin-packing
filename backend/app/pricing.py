"""
Pricing: cubic weight × zone rate.

    cubic_weight_kg = max(total_weight_kg, total_volume_m3 × CUBIC_FACTOR)
    amount          = cubic_weight_kg × rate_per_kg   (rounded half-up to cents)

The rate comes from the delivery address's zone. While the address has no
zone yet, DEFAULT_RATE_PER_KG is used and the quote is marked provisional.

Owner: Agent C. The portal router (Agent A) calls `quote_for_lines()` for
quote previews and on submit. Invoice building also lives here (Agent C).
"""

from collections.abc import Iterable
from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal

from sqlmodel.ext.asyncio.session import AsyncSession

from app.config import settings
from app.models import Address, Quote, Zone

CENT = Decimal("0.01")


@dataclass(frozen=True)
class PricedLine:
    """Per-unit values and the quantity of one order line."""
    unit_weight_kg: float
    unit_volume_m3: float
    quantity: int


def cubic_weight(weight_kg: float, volume_m3: float) -> Decimal:
    w = Decimal(str(weight_kg))
    v = Decimal(str(volume_m3)) * settings.CUBIC_FACTOR
    return max(w, v).quantize(CENT, rounding=ROUND_HALF_UP)


def price(cubic_weight_kg: Decimal, rate_per_kg: Decimal) -> Decimal:
    return (cubic_weight_kg * rate_per_kg).quantize(CENT, rounding=ROUND_HALF_UP)


async def rate_for_zone(session: AsyncSession, zone_code: str | None) -> tuple[Decimal, bool]:
    """(rate_per_kg, provisional). Unknown or inactive zones also fall back to the default."""
    if zone_code:
        zone = await session.get(Zone, zone_code)
        if zone is not None and zone.active:
            return Decimal(zone.rate_per_kg), False
    return settings.DEFAULT_RATE_PER_KG, True


async def quote_for_lines(
    session: AsyncSession,
    *,
    company_id: int,
    delivery_address: Address,
    lines: Iterable[PricedLine],
) -> Quote:
    """Build an UNSAVED Quote. To store it: session.add(quote) and link order.quote_id."""
    lines = list(lines)
    weight = round(sum(ln.unit_weight_kg * ln.quantity for ln in lines), 3)
    volume = round(sum(ln.unit_volume_m3 * ln.quantity for ln in lines), 4)
    cubic = cubic_weight(weight, volume)
    rate, provisional = await rate_for_zone(session, delivery_address.zone)
    return Quote(
        company_id=company_id,
        zone_code=delivery_address.zone if not provisional else None,
        total_weight_kg=weight,
        total_volume_m3=volume,
        cubic_weight_kg=float(cubic),
        rate_per_kg=rate,
        amount=price(cubic, rate),
        provisional=provisional,
    )
