"""Pricing: cubic weight, rounding, zone rates and month boundaries."""

from datetime import UTC, datetime
from decimal import Decimal

from app import pricing
from app.models import Address
from app.pricing import PricedLine, cubic_weight, price, quote_for_lines, rate_for_zone
from tests.factories import make_zone


def test_cubic_weight_is_the_larger_of_weight_and_volume_times_250():
    assert cubic_weight(100, 0.5) == Decimal("125.00")   # volume wins
    assert cubic_weight(200, 0.5) == Decimal("200.00")   # weight wins
    assert cubic_weight(0.5, 0) == Decimal("0.50")
    assert cubic_weight(10.005, 0) == Decimal("10.01")   # half-up
    assert cubic_weight(1, 1 / 3) == Decimal("83.33")


def test_price_rounds_half_up_to_cents():
    assert price(Decimal("1.00"), Decimal("0.125")) == Decimal("0.13")
    assert price(Decimal("33.33"), Decimal("0.3333")) == Decimal("11.11")
    assert price(Decimal("125.00"), Decimal("0.50")) == Decimal("62.50")


async def test_quote_uses_the_zone_rate(session):
    await make_zone(session, "NORTH", rate="0.4500")
    quote = await quote_for_lines(
        session, company_id=1, delivery_address=Address(zone="NORTH"),
        lines=[PricedLine(100, 0.5, 2), PricedLine(10, 0.01, 3)],
    )
    assert quote.total_weight_kg == 230 and quote.total_volume_m3 == 1.03
    assert quote.cubic_weight_kg == 257.5        # 1.03 m³ × 250
    assert quote.rate_per_kg == Decimal("0.4500") and quote.amount == Decimal("115.88")
    assert quote.zone_code == "NORTH" and quote.provisional is False


async def test_unzoned_address_gets_a_provisional_default_rate(session):
    quote = await quote_for_lines(session, company_id=1, delivery_address=Address(zone=None),
                                  lines=[PricedLine(100, 0, 1)])
    assert quote.provisional is True and quote.zone_code is None
    assert quote.rate_per_kg == Decimal("0.60") and quote.amount == Decimal("60.00")


async def test_inactive_or_unknown_zone_falls_back_to_the_default(session):
    zone = await make_zone(session, "OLD", rate="2.00")
    zone.active = False
    session.add(zone)
    await session.commit()
    assert await rate_for_zone(session, "OLD") == (Decimal("0.60"), True)
    assert await rate_for_zone(session, "NOPE") == (Decimal("0.60"), True)
    quote = await quote_for_lines(session, company_id=1, delivery_address=Address(zone="OLD"),
                                  lines=[PricedLine(10, 0, 1)])
    assert quote.provisional is True and quote.zone_code is None and quote.amount == Decimal("6.00")


def test_month_bounds_are_in_the_business_timezone():
    # Australia/Sydney: AEDT (+11) in November, AEST (+10) from April 5, 2026.
    assert pricing.month_bounds("2026-11") == (datetime(2026, 10, 31, 13, tzinfo=UTC),
                                               datetime(2026, 11, 30, 13, tzinfo=UTC))
    assert pricing.month_bounds("2026-04") == (datetime(2026, 3, 31, 13, tzinfo=UTC),
                                               datetime(2026, 4, 30, 14, tzinfo=UTC))
    assert pricing.month_bounds("2026-12") == (datetime(2026, 11, 30, 13, tzinfo=UTC),
                                               datetime(2026, 12, 31, 13, tzinfo=UTC))
