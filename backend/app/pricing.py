"""
Pricing: cubic weight × zone rate.

    cubic_weight_kg = max(total_weight_kg, total_volume_m3 × CUBIC_FACTOR)
    amount          = cubic_weight_kg × rate_per_kg   (rounded half-up to cents)

The rate comes from the delivery address's zone. While the address has no
zone yet, DEFAULT_RATE_PER_KG is used and the quote is marked provisional.

Owner: Agent C. The portal router (Agent A) calls `quote_for_lines()` for
quote previews and on submit. Invoice building also lives here (Agent C).
"""

import csv
import io
import re
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import ROUND_HALF_UP, Decimal

from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from app.config import settings
from app.models import Address, Company, Order, OrderStatus, Quote, Zone
from app.schemas import Invoice, InvoiceLine, InvoiceSummary

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


# ---------------------------------------------------------------------------
# Invoices
# ---------------------------------------------------------------------------

INVOICE_CSV_COLUMNS = (
    "reference", "customer_reference", "delivered_at", "delivery_suburb", "zone",
    "weight_kg", "volume_m3", "cubic_weight_kg", "rate_per_kg", "amount",
)


def month_bounds(month: str) -> tuple[datetime, datetime]:
    """[start, end) of calendar month "YYYY-MM" in the business timezone, as UTC datetimes."""
    year, mon = (int(part) for part in month.split("-"))
    start = datetime(year, mon, 1, tzinfo=settings.tz)
    end = datetime(year + (mon == 12), mon % 12 + 1, 1, tzinfo=settings.tz)
    return start.astimezone(UTC), end.astimezone(UTC)


async def _delivered_orders(session: AsyncSession, month: str,
                            company_id: int | None = None) -> list[Order]:
    start, end = month_bounds(month)
    query = (
        select(Order)
        .where(Order.status == OrderStatus.delivered,
               Order.delivered_at >= start, Order.delivered_at < end)
        .order_by(Order.delivered_at, Order.id)
    )
    if company_id is not None:
        query = query.where(Order.company_id == company_id)
    return list((await session.exec(query)).all())


async def _quote_of(session: AsyncSession, order: Order) -> Quote:
    """The order's stored quote. Orders always get one on submit; for an order
    that somehow has none, price it now (not stored)."""
    if order.quote is not None:
        return order.quote
    return await quote_for_lines(
        session, company_id=order.company_id, delivery_address=order.delivery_address,
        lines=[PricedLine(ln.unit_weight_kg, ln.unit_volume_m3, ln.quantity) for ln in order.lines],
    )


async def build_invoice(session: AsyncSession, company: Company, month: str) -> Invoice:
    """The company's orders delivered in `month` (business timezone), priced from their quotes."""
    lines: list[InvoiceLine] = []
    for order in await _delivered_orders(session, month, company.id):
        quote = await _quote_of(session, order)
        lines.append(InvoiceLine(
            order_id=order.id,
            reference=order.reference,
            customer_reference=order.customer_reference,
            delivered_at=order.delivered_at,
            delivery_suburb=order.delivery_address.suburb,
            zone_code=quote.zone_code,
            total_weight_kg=quote.total_weight_kg,
            total_volume_m3=quote.total_volume_m3,
            cubic_weight_kg=quote.cubic_weight_kg,
            rate_per_kg=Decimal(quote.rate_per_kg),
            amount=Decimal(quote.amount),
        ))
    return Invoice(
        company_id=company.id,
        company_name=company.name,
        month=month,
        lines=lines,
        order_count=len(lines),
        total_amount=sum((ln.amount for ln in lines), Decimal("0.00")).quantize(CENT),
    )


async def invoice_summaries(session: AsyncSession, month: str) -> list[InvoiceSummary]:
    """One row per company with orders delivered in `month`, sorted by company name."""
    totals: dict[int, tuple[Company, int, Decimal]] = {}
    for order in await _delivered_orders(session, month):
        quote = await _quote_of(session, order)
        company, count, amount = totals.get(order.company_id, (order.company, 0, Decimal("0.00")))
        totals[order.company_id] = (company, count + 1, amount + Decimal(quote.amount))
    return [
        InvoiceSummary(company_id=company.id, company_name=company.name, month=month,
                       order_count=count, total_amount=amount.quantize(CENT))
        for company, count, amount in sorted(totals.values(), key=lambda t: (t[0].name, t[0].id))
    ]


def company_slug(company: Company) -> str:
    """"Acme Hardware Pty Ltd" -> "acme-hardware-pty-ltd" (for file names)."""
    slug = re.sub(r"[^a-z0-9]+", "-", company.name.lower()).strip("-")
    return slug or f"company-{company.id}"


def invoice_filename(invoice: Invoice, company: Company) -> str:
    return f"invoice-{company_slug(company)}-{invoice.month}.csv"


def _num(value: float) -> str:
    """1250.0 -> "1250", 0.125 -> "0.125" (up to 4 decimals, no exponent)."""
    return f"{value:.4f}".rstrip("0").rstrip(".") or "0"


_FORMULA_PREFIXES = ("=", "+", "-", "@", "\t", "\r")


def csv_text(value: str) -> str:
    """Customer-entered text for a CSV cell. A leading = + - @ tab or CR would make
    Excel or LibreOffice treat it as a formula, so it gets a leading apostrophe."""
    return "'" + value if value.startswith(_FORMULA_PREFIXES) else value


def invoice_csv(invoice: Invoice) -> str:
    """The invoice as CSV: one row per order, then a TOTAL row. Delivery times are
    shown in the business timezone."""
    buf = io.StringIO()
    writer = csv.writer(buf, lineterminator="\r\n")
    writer.writerow(INVOICE_CSV_COLUMNS)
    for ln in invoice.lines:
        writer.writerow([
            ln.reference,
            csv_text(ln.customer_reference or ""),
            ln.delivered_at.astimezone(settings.tz).isoformat(timespec="seconds"),
            csv_text(ln.delivery_suburb),
            ln.zone_code or "",
            _num(ln.total_weight_kg),
            _num(ln.total_volume_m3),
            _num(ln.cubic_weight_kg),
            str(ln.rate_per_kg),
            str(ln.amount),
        ])
    writer.writerow(["TOTAL", "", "", "", "", "", "", "", "", str(invoice.total_amount)])
    return buf.getvalue()
