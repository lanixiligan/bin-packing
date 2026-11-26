"""
Demo data. Owner: Agent A.   Run:  make seed   (cd backend && python -m scripts.seed)

Wipes the database tables and creates (CONTRACT: the README and the e2e test
rely on these logins):

    Customer company "Acme Hardware Pty Ltd"
        alice@acme.example.com      customer
        bob@acme.example.com        customer
    dispatch@freightco.example.com  dispatcher
    driver1@freightco.example.com   driver
    driver2@freightco.example.com   driver
    Password for every seed user:   demo-pass-123

    Zones NORTH, SOUTH, WEST (different rates); ~15 addresses across them
    4 vehicles with different capacity mixes (weight / volume / pallets)
    ~20 items; ~30 orders in mixed statuses with consistent event histories

Every status change goes through app.lifecycle.transition() (with explicit
timestamps), so the event histories are valid by construction. Orders at
`planned` or later sit in LOCKED plans (with a succeeded solve Job whose
result is a simple first-fit packing), and both drivers have a run today.
"""

import asyncio
import math
import struct
import zlib
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta
from decimal import Decimal

from sqlalchemy import text
from sqlmodel.ext.asyncio.session import AsyncSession

from app import lifecycle, pricing
from app.auth import create_user
from app.config import settings
from app.db import SessionLocal, engine
from app.models import (
    Address,
    Company,
    Driver,
    Item,
    Job,
    JobKind,
    JobStatus,
    Load,
    LoadAssignment,
    Order,
    OrderLine,
    OrderStatus,
    Plan,
    PlanStatus,
    ProofOfDelivery,
    User,
    UserRole,
    Vehicle,
    Zone,
    utcnow,
)
from app.schemas import (
    Capacity,
    LowerBounds,
    MethodResult,
    PackedLoad,
    PackUnit,
    SolveJobPayload,
    SolveResult,
)
from app.solver import EPS, expand_lines, fill_percent, usage_of

SEED_PASSWORD = "demo-pass-123"
COMPANY_NAME = "Acme Hardware Pty Ltd"

S = OrderStatus

# ---------------------------------------------------------------------------
# Static data
# ---------------------------------------------------------------------------

USERS = [
    # (email, full name, role)
    ("alice@acme.example.com", "Alice Nguyen", UserRole.customer),
    ("bob@acme.example.com", "Bob Fraser", UserRole.customer),
    ("dispatch@freightco.example.com", "Dana Dispatch", UserRole.dispatcher),
    ("driver1@freightco.example.com", "Dave Kowalski", UserRole.driver),
    ("driver2@freightco.example.com", "Priya Singh", UserRole.driver),
]
DRIVER_DETAILS = {
    "driver1@freightco.example.com": ("0412 345 678", "NSW-HR-118822"),
    "driver2@freightco.example.com": ("0423 456 789", "NSW-HR-220931"),
}

ZONES = [("NORTH", "North Shore", "0.45"), ("SOUTH", "South & Bayside", "0.50"),
         ("WEST", "Western Sydney", "0.55")]

VEHICLES = [
    # (name, registration, max kg, max m³, max pallets)
    ("Van 1 (1 t)", "FRT-101", 1000, None, None),
    ("Truck 2 (2 t, 12 m³)", "FRT-202", 2000, 12, None),
    ("Truck 3 (3 t, 8 pallets)", "FRT-303", 3000, None, 8),
    ("Truck 4 (20 m³, 6 pallets)", "FRT-404", None, 20, 6),
]

ADDRESSES = [
    # key, label, line1, suburb, postcode, zone, contact, archived
    ("wh", "Main warehouse", "12 Distribution Dr", "Wetherill Park", "2164", "WEST", "Gary Holt", False),
    ("yard", "Botany yard", "4 Port Rd", "Botany", "2019", "SOUTH", "Mia Lopez", False),
    ("chats", "Chatswood store", "88 Victoria Ave", "Chatswood", "2067", "NORTH", "Ken Ito", False),
    ("hornsby", "Hornsby site", "3 Peats Ferry Rd", "Hornsby", "2077", "NORTH", "Lena Park", False),
    ("deewhy", "Dee Why project", "21 Pittwater Rd", "Dee Why", "2099", "NORTH", "Omar Aziz", False),
    ("ryde", "Old showroom, Ryde", "9 Church St", "Ryde", "2112", "NORTH", None, True),
    ("hurst", "Hurstville store", "140 Forest Rd", "Hurstville", "2220", "SOUTH", "Tess Moore", False),
    ("suth", "Sutherland builders", "6 Eton St", "Sutherland", "2232", "SOUTH", "Raj Patel", False),
    ("kog", "Kogarah renovation", "17 Railway Pde", "Kogarah", "2217", "SOUTH", "Ella Burke", False),
    ("parra", "Parramatta store", "200 Church St", "Parramatta", "2150", "WEST", "Sam Reid", False),
    ("penrith", "Penrith depot", "55 Mulgoa Rd", "Penrith", "2750", "WEST", "Joy Tran", False),
    ("black", "Blacktown site", "30 Main St", "Blacktown", "2148", "WEST", "Ben Clarke", False),
    ("liver", "Liverpool store", "73 Macquarie St", "Liverpool", "2170", "WEST", "Ava Wong", False),
    ("gosford", "Gosford new site", "2 Mann St", "Gosford", "2250", None, "Noah Hill", False),
    ("woll", "Wollongong job", "11 Crown St", "Wollongong", "2500", None, "Zoe King", False),
]

ITEMS = [
    # sku, name, kg, m³, pallet spaces, archived
    ("CEM-20", "Cement bag 20 kg", 20, 0.015, 0, False),
    ("CEM-PAL", "Cement pallet (60 bags)", 1200, 1.0, 1, False),
    ("BRK-PAL", "Brick pallet (400 bricks)", 1100, 0.8, 1, False),
    ("PAV-PAL", "Concrete paver pallet", 950, 0.7, 1, False),
    ("TILE-PAL", "Floor tile pallet", 900, 0.9, 1, False),
    ("TIM-9045", "Timber framing pack 90x45", 450, 0.9, 1, False),
    ("PNT-PAL", "Paint pallet (40 tins)", 540, 0.8, 1, False),
    ("MULCH-BB", "Garden mulch bulk bag", 400, 1.0, 1, False),
    ("PLB-10", "Plasterboard pack (10 sheets)", 280, 0.4, 1, False),
    ("ROOF-B", "Roof sheet bundle", 180, 0.6, 0, False),
    ("BENCH-3M", "Kitchen benchtop 3 m", 90, 0.15, 0, False),
    ("HWS-250", "Hot water system 250 L", 75, 0.6, 0, False),
    ("PVC-100", "PVC pipe bundle 100 mm x 6 m", 60, 0.35, 0, False),
    ("REO-SL82", "Reinforcing mesh sheet SL82", 41, 0.05, 0, False),
    ("TOOL-BOX", "Steel toolbox", 35, 0.1, 0, False),
    ("DOOR-SC", "Solid core door", 32, 0.08, 0, False),
    ("TILE-CTN", "Floor tile carton", 25, 0.02, 0, False),
    ("WB-100", "Wheelbarrow", 18, 0.2, 0, False),
    ("PNT-10L", "Paint tin 10 L", 13, 0.012, 0, False),
    ("INS-R2", "Insulation batts bale R2.0", 12, 0.45, 0, False),
    ("FEN-OLD", "Fence panel (discontinued)", 28, 0.12, 0, True),
]

PATHS: dict[OrderStatus, list[OrderStatus]] = {
    S.draft: [S.draft],
    S.submitted: [S.draft, S.submitted],
    S.accepted: [S.draft, S.submitted, S.accepted],
    S.rejected: [S.draft, S.submitted, S.rejected],
    S.cancelled: [S.draft, S.submitted, S.cancelled],
    S.planned: [S.draft, S.submitted, S.accepted, S.planned],
    S.picked_up: [S.draft, S.submitted, S.accepted, S.planned, S.picked_up],
    S.in_transit: [S.draft, S.submitted, S.accepted, S.planned, S.picked_up, S.in_transit],
    S.delivered: [S.draft, S.submitted, S.accepted, S.planned, S.picked_up, S.in_transit, S.delivered],
    S.exception: [S.draft, S.submitted, S.accepted, S.planned, S.picked_up, S.exception],
}

# Time between the previous step and this one.
GAPS = {
    S.submitted: timedelta(hours=2), S.accepted: timedelta(hours=5), S.rejected: timedelta(hours=4),
    S.cancelled: timedelta(hours=3), S.planned: timedelta(hours=18),
    S.in_transit: timedelta(minutes=40), S.delivered: timedelta(minutes=90),
    S.exception: timedelta(minutes=55),
}

NOTES = {
    S.rejected: "We don't deliver to this area on that date. Please choose a later date.",
    S.cancelled: "Customer postponed the job.",
    S.exception: "Site closed on arrival, no one to receive the goods. Returned to depot.",
}


@dataclass
class Spec:
    """One demo order: delivery `day` (offset from today, or a date), delivery address key,
    final status and lines (sku, quantity)."""
    day: int | date
    to: str
    status: OrderStatus
    lines: list[tuple[str, int]]
    frm: str = "wh"
    by: int = 0  # 0 = alice, 1 = bob
    ref: str | None = None
    window: tuple[int, int] | None = None
    notes: str | None = None
    submit_note: str | None = None


def _orders(today: date) -> list[Spec]:
    first_this_month = today.replace(day=1)
    prev = (first_this_month - timedelta(days=1)).replace(day=1)
    d10, d17 = prev.replace(day=10), prev.replace(day=17)
    D, P, T, IT = S.delivered, S.planned, S.picked_up, S.in_transit
    return [
        # Previous month: delivered (invoice data)
        Spec(d10, "chats", D, [("CEM-PAL", 1), ("CEM-20", 10)], ref="PO-7701"),
        Spec(d10, "hornsby", D, [("TIM-9045", 2), ("PLB-10", 2)], ref="PO-7702", by=1),
        Spec(d17, "parra", D, [("BRK-PAL", 1), ("PAV-PAL", 1)], ref="PO-7740"),
        Spec(d17, "black", D, [("TILE-PAL", 1), ("TILE-CTN", 12)], ref="PO-7741", frm="yard"),
        Spec(d17, "kog", D, [("HWS-250", 2), ("BENCH-3M", 1)], ref="PO-7745", by=1),
        # Yesterday
        Spec(-1, "chats", D, [("PNT-PAL", 1), ("PNT-10L", 6)], ref="PO-7810", window=(8, 12)),
        Spec(-1, "deewhy", D, [("ROOF-B", 4), ("REO-SL82", 10)], ref="PO-7811"),
        Spec(-1, "hurst", D, [("DOOR-SC", 6), ("TOOL-BOX", 2)], ref="PO-7812", by=1),
        Spec(-1, "suth", S.exception, [("MULCH-BB", 2)], ref="PO-7813"),
        # Today, in locked plans (driver 1: NORTH, driver 2: SOUTH)
        Spec(0, "chats", D, [("CEM-20", 25), ("WB-100", 2)], ref="PO-7900", window=(7, 10)),
        Spec(0, "hornsby", IT, [("TIM-9045", 2), ("PVC-100", 4)], ref="PO-7901"),
        Spec(0, "deewhy", P, [("TILE-PAL", 1), ("TILE-CTN", 8)], ref="PO-7902", window=(12, 16)),
        Spec(0, "hurst", T, [("PLB-10", 3), ("INS-R2", 6)], ref="PO-7903", by=1),
        Spec(0, "suth", P, [("PAV-PAL", 2)], ref="PO-7904"),
        Spec(0, "kog", P, [("HWS-250", 1), ("BENCH-3M", 2), ("DOOR-SC", 3)], ref="PO-7905",
             frm="yard"),
        # Today, accepted and not planned yet (run the optimiser on these)
        Spec(0, "hornsby", S.accepted, [("BRK-PAL", 1), ("CEM-20", 20)], ref="PO-7920"),
        Spec(0, "chats", S.accepted, [("PNT-PAL", 1), ("ROOF-B", 2)], ref="PO-7921", by=1),
        Spec(0, "kog", S.accepted, [("CEM-PAL", 1)], ref="PO-7922"),
        Spec(0, "hurst", S.accepted, [("TIM-9045", 3)], ref="PO-7923"),
        Spec(0, "parra", S.accepted, [("BRK-PAL", 2), ("PAV-PAL", 1)], ref="PO-7924", window=(9, 13)),
        Spec(0, "penrith", S.accepted, [("MULCH-BB", 3), ("WB-100", 4)], ref="PO-7925", by=1),
        Spec(0, "liver", S.accepted, [("TILE-PAL", 2), ("TILE-CTN", 20)], ref="PO-7926"),
        # Tomorrow
        Spec(1, "deewhy", S.accepted, [("CEM-PAL", 1), ("REO-SL82", 12)], ref="PO-8000"),
        Spec(1, "hornsby", S.accepted, [("PLB-10", 4), ("INS-R2", 10)], ref="PO-8001", by=1),
        Spec(1, "suth", S.accepted, [("BRK-PAL", 1), ("PAV-PAL", 1)], ref="PO-8002"),
        Spec(1, "hurst", S.accepted, [("HWS-250", 3), ("PVC-100", 6)], ref="PO-8003"),
        Spec(1, "black", S.accepted, [("TIM-9045", 4), ("ROOF-B", 3)], ref="PO-8004"),
        Spec(1, "liver", S.accepted, [("CEM-PAL", 2)], ref="PO-8005", by=1),
        Spec(1, "chats", S.submitted, [("TOOL-BOX", 4), ("DOOR-SC", 2)], ref="PO-8006",
             submit_note="Please call Ken 30 minutes before arrival."),
        Spec(1, "penrith", S.submitted, [("PNT-PAL", 2)], ref="PO-8007"),
        # In two days
        Spec(2, "kog", S.submitted, [("TILE-CTN", 30), ("CEM-20", 15)], ref="PO-8100", by=1),
        Spec(2, "gosford", S.submitted, [("TIM-9045", 2), ("PLB-10", 2)], ref="PO-8101"),
        Spec(2, "parra", S.draft, [("BENCH-3M", 2), ("HWS-250", 1)], notes="Back entrance via the lane."),
        Spec(2, "woll", S.draft, [("MULCH-BB", 1)], by=1),
        Spec(2, "black", S.rejected, [("BRK-PAL", 3)], ref="PO-8102"),
        Spec(2, "suth", S.cancelled, [("WB-100", 6)], ref="PO-8103", by=1),
    ]


# Locked plans: (day, zone) -> (vehicle index, driver index or None)
def _plan_setup(spec_day: date, zone: str, today: date) -> tuple[int, int]:
    if spec_day == today:
        return (2, 0) if zone == "NORTH" else (2, 1)
    if zone == "NORTH":
        return 2, 0
    if zone == "SOUTH":
        return 1, 1
    return 2, 0


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def tiny_png() -> bytes:
    """A valid 1x1 PNG (a single brown pixel), built by hand."""
    def chunk(kind: bytes, data: bytes) -> bytes:
        return (struct.pack(">I", len(data)) + kind + data
                + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF))
    ihdr = struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0)  # 1x1, 8-bit RGB
    idat = zlib.compress(b"\x00\x8b\x5a\x2b")
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b"")


def _local(d: date, hour: int, minute: int = 0) -> datetime:
    return datetime.combine(d, time(hour, minute), tzinfo=settings.tz)


def _capacity(v: Vehicle) -> Capacity:
    return Capacity(weight_kg=v.max_weight_kg, volume_m3=v.max_volume_m3,
                    pallets=float(v.max_pallets) if v.max_pallets is not None else None)


def _fits(units: list[PackUnit], cap: Capacity) -> bool:
    use = usage_of(units)
    return all(c is None or u <= c + EPS for u, c in (
        (use.weight_kg, cap.weight_kg), (use.volume_m3, cap.volume_m3), (use.pallets, cap.pallets)))


def first_fit(units: list[PackUnit], cap: Capacity) -> list[list[PackUnit]]:
    """Simple first-fit decreasing (by weight) into loads of `cap`."""
    loads: list[list[PackUnit]] = []
    for u in sorted(units, key=lambda u: (-u.weight_kg, -u.volume_m3, u.id)):
        for load in loads:
            if _fits([*load, u], cap):
                load.append(u)
                break
        else:
            if not _fits([u], cap):
                raise ValueError(f"Seed data error: {u.item_sku} doesn't fit the plan vehicle.")
            loads.append([u])
    return loads


def solve_result(units: list[PackUnit], loads: list[list[PackUnit]], cap: Capacity) -> SolveResult:
    totals = usage_of(units)

    def lb(total: float, c: float | None) -> int | None:
        return None if c is None else max(1, math.ceil(total / c - EPS))

    bounds = LowerBounds(weight=lb(totals.weight_kg, cap.weight_kg),
                         volume=lb(totals.volume_m3, cap.volume_m3),
                         pallets=lb(totals.pallets, cap.pallets))
    lower = max(b for b in (bounds.weight, bounds.volume, bounds.pallets) if b is not None)
    packed = [PackedLoad(number=i + 1, unit_ids=[u.id for u in load], usage=usage_of(load),
                         fill_percent=fill_percent(usage_of(load), cap))
              for i, load in enumerate(loads)]
    ffd = MethodResult(num_loads=len(loads), loads=packed, solve_time_ms=0.2,
                       drop_order=[u.id for load in loads for u in load],
                       optimal=len(loads) == lower, status="HEURISTIC")
    return SolveResult(capacity=cap, totals=totals, lower_bound=lower, lower_bounds=bounds,
                       units=units, ffd=ffd, ortools=None, recommended="ffd",
                       time_limit_s=settings.SOLVER_TIME_LIMIT_S)


def _timeline(path: list[OrderStatus], *, last: datetime | None = None,
              lock: datetime | None = None, pickup: datetime | None = None,
              jitter: int = 0) -> dict[OrderStatus, datetime]:
    """Timestamps per step of `path`, strictly increasing.

    Plain orders end at `last`. Orders that reach `planned` are planned at
    `lock`, and any delivery-day steps start with the pickup at `pickup`."""
    jit = timedelta(minutes=jitter)
    times: dict[OrderStatus, datetime] = {}
    if S.planned in path:
        k = path.index(S.planned)
        times[S.planned] = lock
        if k + 1 < len(path):
            times[path[k + 1]] = pickup
            for i in range(k + 2, len(path)):
                times[path[i]] = times[path[i - 1]] + GAPS[path[i]] + jit
        end = k
    else:
        end = len(path) - 1
        times[path[end]] = last
    for i in range(end, 0, -1):
        times[path[i - 1]] = times[path[i]] - GAPS[path[i]] - jit
    return times


# ---------------------------------------------------------------------------
# Seeding
# ---------------------------------------------------------------------------

async def truncate_all(session: AsyncSession) -> None:
    tables = (await session.exec(text(
        "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'alembic_version'"
    ))).scalars().all()
    if tables:
        await session.exec(text(
            "TRUNCATE " + ", ".join(f'"{t}"' for t in tables) + " RESTART IDENTITY CASCADE"))


@dataclass
class _Run:
    spec: Spec
    order: Order
    times: dict[OrderStatus, datetime] = field(default_factory=dict)


async def seed(session: AsyncSession) -> dict[str, int]:
    """Wipe every table and insert the demo data. Commits. Returns row counts."""
    await truncate_all(session)
    today = settings.today()
    now = utcnow()

    # Users, company, drivers
    company = Company(name=COMPANY_NAME, created_at=now - timedelta(days=90))
    session.add(company)
    await session.flush()
    users: dict[str, User] = {}
    for email, name, role in USERS:
        users[email] = await create_user(
            session, email=email, password=SEED_PASSWORD, role=role, full_name=name,
            company_id=company.id if role == UserRole.customer else None)
        users[email].is_verified = True
    customers = [users["alice@acme.example.com"], users["bob@acme.example.com"]]
    dispatcher = users["dispatch@freightco.example.com"]
    drivers: list[tuple[User, Driver]] = []
    for email, (phone, licence) in DRIVER_DETAILS.items():
        drv = Driver(user_id=users[email].id, name=users[email].full_name, phone=phone,
                     licence_number=licence)
        session.add(drv)
        drivers.append((users[email], drv))

    # Zones, vehicles, addresses, items
    for code, name, rate in ZONES:
        session.add(Zone(code=code, name=name, rate_per_kg=Decimal(rate)))
    vehicles = [Vehicle(name=n, registration=r, max_weight_kg=w, max_volume_m3=v, max_pallets=p)
                for n, r, w, v, p in VEHICLES]
    session.add_all(vehicles)
    await session.flush()
    addresses: dict[str, Address] = {}
    for key, label, line1, suburb, postcode, zone, contact, archived in ADDRESSES:
        addresses[key] = Address(
            company_id=company.id, label=label, contact_name=contact,
            phone="02 9000 " + postcode, line1=line1, suburb=suburb, state="NSW", postcode=postcode,
            zone=zone, archived=archived)
    items: dict[str, Item] = {}
    for sku, name, kg, m3, pallets, archived in ITEMS:
        items[sku] = Item(company_id=company.id, sku=sku, name=name, weight_kg=kg, volume_m3=m3,
                          pallet_spaces=pallets, archived=archived)
    session.add_all([*addresses.values(), *items.values()])
    await session.flush()

    # Orders up to `accepted` (or their final status if they never get planned)
    runs: list[_Run] = []
    groups: dict[tuple[date, str], list[_Run]] = {}
    for i, spec in enumerate(_orders(today)):
        dd = spec.day if isinstance(spec.day, date) else today + timedelta(days=spec.day)
        path = PATHS[spec.status]
        if S.planned in path:
            zone = addresses[spec.to].zone
            assert zone, "planned orders need a zoned delivery address"
            key = (dd, zone)
            lock = _local(dd - timedelta(days=1), 16, 0).astimezone(now.tzinfo)
            pickup = _local(dd, 7, 30) + timedelta(minutes=12 * len(groups.get(key, [])))
            after = sum((GAPS[s] for s in path[path.index(S.planned) + 2:]), timedelta())
            pickup = min(pickup, now - after - timedelta(minutes=5 + 3 * i))
            times = _timeline(path, lock=lock, pickup=pickup, jitter=i % 5)
        else:
            times = _timeline(path, last=now - timedelta(minutes=25 + 19 * i), jitter=i % 7)
        creator = customers[spec.by]
        order = Order(
            company_id=company.id, created_by_id=creator.id, status=S.draft,
            pickup_address_id=addresses[spec.frm].id, delivery_address_id=addresses[spec.to].id,
            delivery_date=dd, customer_reference=spec.ref, notes=spec.notes,
            window_start=time(spec.window[0]) if spec.window else None,
            window_end=time(spec.window[1]) if spec.window else None,
            created_at=times[S.draft], updated_at=times[S.draft],
        )
        order.lines = [OrderLine(
            item_id=items[sku].id, quantity=qty, item_name=items[sku].name, item_sku=sku,
            unit_weight_kg=items[sku].weight_kg, unit_volume_m3=items[sku].volume_m3,
            unit_pallet_spaces=items[sku].pallet_spaces) for sku, qty in spec.lines]
        session.add(order)
        await session.flush()
        session.add(lifecycle.record_created(order, creator, now=times[S.draft]))
        run = _Run(spec, order, times)
        runs.append(run)
        for step in path[1:]:
            if step == S.planned:
                groups.setdefault(key, []).append(run)
                break
            await _step(session, run, step, creator, dispatcher, addresses)

    # Locked plans with loads for every planned-or-later order, then the delivery-day steps
    png = tiny_png()
    pod_dir = settings.upload_dir / "pod"
    pod_dir.mkdir(parents=True, exist_ok=True)
    for old in pod_dir.glob("seed-*.png"):
        old.unlink()
    for (dd, zone), members in sorted(groups.items()):
        vehicle_idx, driver_idx = _plan_setup(dd, zone, today)
        vehicle = vehicles[vehicle_idx]
        drv_user, drv = drivers[driver_idx]
        lock = members[0].times[S.planned]
        load_of_order = await _make_plan(session, dd, zone, vehicle, drv, dispatcher, members, lock)
        for run in members:
            await lifecycle.transition(session, run.order, S.planned, dispatcher, now=lock)
            path = PATHS[run.spec.status]
            for step in path[path.index(S.planned) + 1:]:
                await _step(session, run, step, drv_user, dispatcher, addresses)
            if run.order.status == S.delivered:
                rel = f"pod/seed-{run.order.id}.png"
                (settings.upload_dir / rel).write_bytes(png)
                contact = addresses[run.spec.to].contact_name or "Site manager"
                session.add(ProofOfDelivery(
                    order_id=run.order.id, load_id=load_of_order[run.order.id], driver_id=drv.id,
                    signed_by=contact, photo_path=rel, photo_content_type="image/png",
                    note="Left at the loading dock." if run.order.id % 2 else None,
                    created_at=run.times[S.delivered]))

    await session.commit()
    counts = {}
    for name in ("companies", "users", "drivers", "zones", "vehicles", "addresses", "items",
                 "orders", "order_events", "quotes", "plans", "loads", "jobs", "proofs_of_delivery"):
        counts[name] = (await session.exec(text(f'SELECT count(*) FROM "{name}"'))).scalar_one()
    return counts


async def _step(session: AsyncSession, run: _Run, step: OrderStatus, actor: User,
                dispatcher: User, addresses: dict[str, Address]) -> None:
    """One lifecycle step of a seed order (actor = customer or driver; dispatcher for ops steps)."""
    at = run.times[step]
    order = run.order
    note = NOTES.get(step)
    if step == S.submitted:
        quote = await pricing.quote_for_lines(
            session, company_id=order.company_id, delivery_address=addresses[run.spec.to],
            lines=[pricing.PricedLine(ln.unit_weight_kg, ln.unit_volume_m3, ln.quantity)
                   for ln in order.lines])
        quote.created_at = at
        session.add(quote)
        await session.flush()
        order.quote_id = quote.id
        note = run.spec.submit_note
    if step in (S.accepted, S.rejected):
        actor = dispatcher
    await lifecycle.transition(session, order, step, actor, note, now=at)


async def _make_plan(session: AsyncSession, dd: date, zone: str, vehicle: Vehicle, drv: Driver,
                     dispatcher: User, members: list[_Run], lock: datetime) -> dict[int, int]:
    """A locked plan (and its succeeded job) for `members`. Returns order id -> first load id."""
    cap = _capacity(vehicle)
    created = lock - timedelta(minutes=30)
    job = Job(kind=JobKind.solve, status=JobStatus.succeeded, payload={}, created_by_id=dispatcher.id,
              created_at=created, started_at=created + timedelta(seconds=1),
              finished_at=created + timedelta(seconds=2))
    session.add(job)
    await session.flush()
    plan = Plan(delivery_date=dd, zone=zone, status=PlanStatus.locked, vehicle_id=vehicle.id,
                job_id=job.id, method="ffd", created_by_id=dispatcher.id, created_at=created,
                locked_at=lock)
    session.add(plan)
    await session.flush()
    for run in members:
        run.order.plan_id = plan.id
    await session.flush()

    units = expand_lines([ln for run in members for ln in run.order.lines])
    packed = first_fit(units, cap)
    job.payload = SolveJobPayload(plan_id=plan.id, order_ids=[r.order.id for r in members],
                                  capacity=cap, time_limit_s=settings.SOLVER_TIME_LIMIT_S).model_dump(
                                      mode="json")
    job.result = solve_result(units, packed, cap).model_dump(mode="json")

    first_load: dict[int, int] = {}
    for number, load_units in enumerate(packed, start=1):
        load = Load(plan_id=plan.id, number=number, vehicle_id=vehicle.id, driver_id=drv.id,
                    created_at=created)
        session.add(load)
        await session.flush()
        per_line: dict[int, int] = {}
        for u in load_units:
            per_line[u.order_line_id] = per_line.get(u.order_line_id, 0) + 1
            first_load.setdefault(u.order_id, load.id)
        session.add_all([LoadAssignment(load_id=load.id, order_line_id=line_id, quantity=qty)
                         for line_id, qty in per_line.items()])
    await session.flush()
    return first_load


async def run() -> dict[str, int]:
    async with SessionLocal() as session:
        return await seed(session)


def main() -> None:
    async def _main() -> dict[str, int]:
        try:
            return await run()
        finally:
            await engine.dispose()

    counts = asyncio.run(_main())
    print("Seeded: " + ", ".join(f"{v} {k}" for k, v in counts.items()))
    print(f"\nLogins (password for all: {SEED_PASSWORD})")
    for email, name, role in USERS:
        extra = f" ({COMPANY_NAME})" if role == UserRole.customer else ""
        print(f"  {role.value:<10}  {email:<34} {name}{extra}")


if __name__ == "__main__":
    main()
