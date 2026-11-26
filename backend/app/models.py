"""
Database tables (SQLModel on SQLAlchemy 2, Postgres).

This module is a SHARED CONTRACT. Do not change it without asking the
orchestrator; changes need a new Alembic migration.

Conventions
-----------
* Table names are plural snake_case (set with __tablename__).
* Integer primary keys, except User.id and Job.id (UUID).
* Every timestamp is timezone-aware UTC (TIMESTAMPTZ), set with `utcnow()`.
* Enums are stored as native Postgres enums using their lowercase *values*.
* Money is Decimal (NUMERIC); weights are kg, volumes are m³, pallets are
  pallet spaces. All three are floats.
* Customer-owned rows (Address, Item, Order, Quote) carry `company_id`.
  Every customer-facing query MUST filter on the caller's company_id.
* Relationships load with lazy="selectin", so they are safe to read in async
  code after the object was loaded by a query. Relationships are not loaded
  on objects you just created with `session.add()` until you refresh or
  re-query them (use `await session.refresh(obj, ["lines"])`).
"""

import uuid
from datetime import UTC, date, datetime, time
from decimal import Decimal
from enum import Enum, StrEnum
from typing import Any

from sqlalchemy import CheckConstraint, Column, DateTime, Index, Text, UniqueConstraint
from sqlalchemy import Enum as SAEnum
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, Relationship, SQLModel


def utcnow() -> datetime:
    return datetime.now(UTC)


def _pg_enum(enum_cls: type[Enum], name: str) -> SAEnum:
    """Native Postgres enum that stores the member *values* ("picked_up")."""
    return SAEnum(enum_cls, name=name, values_callable=lambda e: [m.value for m in e])


def _ts(**kw: Any) -> Any:
    """A TIMESTAMPTZ column. Pass default_factory=utcnow for NOT NULL ones."""
    if "default_factory" in kw:
        return Field(sa_type=DateTime(timezone=True), nullable=False, **kw)
    return Field(default=None, sa_type=DateTime(timezone=True), nullable=True, **kw)


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------

class UserRole(StrEnum):
    customer = "customer"
    dispatcher = "dispatcher"
    driver = "driver"


class OrderStatus(StrEnum):
    """
    draft → submitted → accepted | rejected → planned → picked_up → in_transit
    → delivered | exception. Also `cancelled` (customer, from draft or
    submitted). The allowed transitions live in app/lifecycle.py only.
    """
    draft = "draft"
    submitted = "submitted"
    accepted = "accepted"
    rejected = "rejected"
    cancelled = "cancelled"
    planned = "planned"
    picked_up = "picked_up"
    in_transit = "in_transit"
    delivered = "delivered"
    exception = "exception"


class PlanStatus(StrEnum):
    draft = "draft"      # loads (if any) can still be edited
    locked = "locked"    # loads frozen; orders moved to `planned`


class JobStatus(StrEnum):
    queued = "queued"
    running = "running"
    succeeded = "succeeded"
    failed = "failed"


class JobKind(StrEnum):
    solve = "solve"


UserRoleType = _pg_enum(UserRole, "user_role")
OrderStatusType = _pg_enum(OrderStatus, "order_status")
PlanStatusType = _pg_enum(PlanStatus, "plan_status")
JobStatusType = _pg_enum(JobStatus, "job_status")
JobKindType = _pg_enum(JobKind, "job_kind")


# ---------------------------------------------------------------------------
# Companies, zones and users
# ---------------------------------------------------------------------------

class Company(SQLModel, table=True):
    """A customer company. Customer users belong to exactly one."""
    __tablename__ = "companies"

    id: int | None = Field(default=None, primary_key=True)
    name: str = Field(max_length=200, unique=True)
    created_at: datetime = _ts(default_factory=utcnow)


class Zone(SQLModel, table=True):
    """A delivery area, managed by dispatchers. Orders are batched by date + zone."""
    __tablename__ = "zones"

    code: str = Field(primary_key=True, max_length=32)  # e.g. "NORTH"; uppercase
    name: str = Field(max_length=100)
    rate_per_kg: Decimal = Field(max_digits=10, decimal_places=4)  # price per cubic kg
    active: bool = Field(default=True)
    created_at: datetime = _ts(default_factory=utcnow)


class User(SQLModel, table=True):
    """
    Login account (fastapi-users). The first six columns are the ones
    fastapi-users expects. `company_id` is set for customers only.
    """
    __tablename__ = "users"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    email: str = Field(max_length=320, unique=True, index=True)
    hashed_password: str = Field(max_length=1024)
    is_active: bool = Field(default=True)
    is_superuser: bool = Field(default=False)
    is_verified: bool = Field(default=False)

    full_name: str = Field(default="", max_length=200)
    role: UserRole = Field(sa_type=UserRoleType, nullable=False, index=True)
    company_id: int | None = Field(default=None, foreign_key="companies.id", index=True)
    created_at: datetime = _ts(default_factory=utcnow)

    __table_args__ = (
        CheckConstraint(
            "(role = 'customer') = (company_id IS NOT NULL)",
            name="ck_users_company_iff_customer",
        ),
    )


# ---------------------------------------------------------------------------
# Customer catalogue
# ---------------------------------------------------------------------------

class Address(SQLModel, table=True):
    """A saved pickup or delivery address of a customer. `zone` is set by dispatchers."""
    __tablename__ = "addresses"

    id: int | None = Field(default=None, primary_key=True)
    company_id: int = Field(foreign_key="companies.id", index=True)
    label: str = Field(max_length=100)                    # "Main warehouse"
    contact_name: str | None = Field(default=None, max_length=200)
    phone: str | None = Field(default=None, max_length=50)
    line1: str = Field(max_length=200)
    line2: str | None = Field(default=None, max_length=200)
    suburb: str = Field(max_length=100)
    state: str = Field(max_length=50)
    postcode: str = Field(max_length=10)
    country: str = Field(default="AU", max_length=2)
    notes: str | None = Field(default=None, max_length=1000)
    zone: str | None = Field(default=None, foreign_key="zones.code", index=True)
    # Archived instead of deleted, because orders keep pointing at it.
    archived: bool = Field(default=False)
    created_at: datetime = _ts(default_factory=utcnow)


class Item(SQLModel, table=True):
    """A catalogue item of a customer. Values are per unit."""
    __tablename__ = "items"

    id: int | None = Field(default=None, primary_key=True)
    company_id: int = Field(foreign_key="companies.id", index=True)
    sku: str = Field(max_length=64)
    name: str = Field(max_length=200)
    description: str | None = Field(default=None, max_length=1000)
    weight_kg: float
    volume_m3: float = Field(default=0)
    pallet_spaces: float = Field(default=0)  # 0 = does not use a pallet space
    archived: bool = Field(default=False)
    created_at: datetime = _ts(default_factory=utcnow)

    __table_args__ = (
        UniqueConstraint("company_id", "sku", name="uq_items_company_sku"),
        CheckConstraint("weight_kg > 0", name="ck_items_weight_positive"),
        CheckConstraint("volume_m3 >= 0", name="ck_items_volume_nonneg"),
        CheckConstraint("pallet_spaces >= 0", name="ck_items_pallets_nonneg"),
    )


# ---------------------------------------------------------------------------
# Pricing
# ---------------------------------------------------------------------------

class Quote(SQLModel, table=True):
    """
    A price for an order, fixed when the order is submitted.
    cubic_weight_kg = max(total_weight_kg, total_volume_m3 * CUBIC_FACTOR)
    amount = cubic_weight_kg * rate_per_kg, rounded to cents.
    """
    __tablename__ = "quotes"

    id: int | None = Field(default=None, primary_key=True)
    company_id: int = Field(foreign_key="companies.id", index=True)
    zone_code: str | None = Field(default=None, max_length=32)
    total_weight_kg: float
    total_volume_m3: float
    cubic_weight_kg: float
    rate_per_kg: Decimal = Field(max_digits=10, decimal_places=4)
    amount: Decimal = Field(max_digits=12, decimal_places=2)
    # True when the delivery address had no zone yet (DEFAULT_RATE_PER_KG used).
    provisional: bool = Field(default=False)
    created_at: datetime = _ts(default_factory=utcnow)


# ---------------------------------------------------------------------------
# Orders
# ---------------------------------------------------------------------------

class Order(SQLModel, table=True):
    __tablename__ = "orders"

    id: int | None = Field(default=None, primary_key=True)
    company_id: int = Field(foreign_key="companies.id", index=True)
    created_by_id: uuid.UUID = Field(foreign_key="users.id")
    status: OrderStatus = Field(
        default=OrderStatus.draft, sa_type=OrderStatusType, nullable=False, index=True
    )
    pickup_address_id: int = Field(foreign_key="addresses.id")
    delivery_address_id: int = Field(foreign_key="addresses.id", index=True)
    delivery_date: date = Field(index=True)
    window_start: time | None = None  # delivery time window on delivery_date
    window_end: time | None = None
    customer_reference: str | None = Field(default=None, max_length=64)  # e.g. PO number
    notes: str | None = Field(default=None, max_length=1000)

    quote_id: int | None = Field(default=None, foreign_key="quotes.id")
    # The plan that has reserved this order (set when a plan is created for
    # its date + zone, cleared if that draft plan is discarded).
    plan_id: int | None = Field(default=None, foreign_key="plans.id", index=True)

    created_at: datetime = _ts(default_factory=utcnow)
    updated_at: datetime = _ts(default_factory=utcnow)
    submitted_at: datetime | None = _ts()
    delivered_at: datetime | None = _ts()  # set by lifecycle; invoices use it

    lines: list["OrderLine"] = Relationship(
        back_populates="order",
        sa_relationship_kwargs={
            "lazy": "selectin",
            "cascade": "all, delete-orphan",
            "order_by": "OrderLine.id",
        },
    )
    events: list["OrderEvent"] = Relationship(
        back_populates="order",
        sa_relationship_kwargs={
            "lazy": "selectin",
            "cascade": "all, delete-orphan",
            "order_by": "OrderEvent.id",
        },
    )
    pickup_address: Address = Relationship(
        sa_relationship_kwargs={"lazy": "selectin", "foreign_keys": "[Order.pickup_address_id]"}
    )
    delivery_address: Address = Relationship(
        sa_relationship_kwargs={"lazy": "selectin", "foreign_keys": "[Order.delivery_address_id]"}
    )
    quote: Quote | None = Relationship(sa_relationship_kwargs={"lazy": "selectin"})
    company: Company = Relationship(sa_relationship_kwargs={"lazy": "selectin"})

    __table_args__ = (
        Index("ix_orders_status_delivery_date", "status", "delivery_date"),
        CheckConstraint(
            "window_start IS NULL OR window_end IS NULL OR window_start < window_end",
            name="ck_orders_window_order",
        ),
    )

    @property
    def reference(self) -> str:
        """Human-readable order number, e.g. ORD-000042."""
        return f"ORD-{self.id:06d}" if self.id is not None else "ORD-NEW"


class OrderLine(SQLModel, table=True):
    """
    An item and quantity on an order. The item's name, SKU and per-unit
    weight/volume/pallets are copied here when the line is created, so
    later catalogue edits don't change existing orders or plans.
    """
    __tablename__ = "order_lines"

    id: int | None = Field(default=None, primary_key=True)
    order_id: int = Field(foreign_key="orders.id", index=True, ondelete="CASCADE")
    item_id: int = Field(foreign_key="items.id")
    quantity: int
    item_name: str = Field(max_length=200)
    item_sku: str = Field(max_length=64)
    unit_weight_kg: float
    unit_volume_m3: float
    unit_pallet_spaces: float

    order: Order = Relationship(back_populates="lines", sa_relationship_kwargs={"lazy": "selectin"})

    __table_args__ = (CheckConstraint("quantity > 0", name="ck_order_lines_quantity_positive"),)


class OrderEvent(SQLModel, table=True):
    """One row per status change. Written only by app/lifecycle.py."""
    __tablename__ = "order_events"

    id: int | None = Field(default=None, primary_key=True)
    order_id: int = Field(foreign_key="orders.id", index=True, ondelete="CASCADE")
    from_status: OrderStatus | None = Field(default=None, sa_type=OrderStatusType, nullable=True)
    to_status: OrderStatus = Field(sa_type=OrderStatusType, nullable=False)
    actor_id: uuid.UUID | None = Field(default=None, foreign_key="users.id")  # None = system
    note: str | None = Field(default=None, max_length=1000)
    created_at: datetime = _ts(default_factory=utcnow, index=True)

    order: Order = Relationship(back_populates="events")


# ---------------------------------------------------------------------------
# Fleet
# ---------------------------------------------------------------------------

class Vehicle(SQLModel, table=True):
    """A truck. Each capacity is optional (None = not limited), but at least one is set."""
    __tablename__ = "vehicles"

    id: int | None = Field(default=None, primary_key=True)
    name: str = Field(max_length=100, unique=True)          # "Truck 3 (8 pallet)"
    registration: str = Field(max_length=20, unique=True)   # number plate
    max_weight_kg: float | None = None
    max_volume_m3: float | None = None
    max_pallets: int | None = None
    active: bool = Field(default=True)
    created_at: datetime = _ts(default_factory=utcnow)

    __table_args__ = (
        CheckConstraint(
            "max_weight_kg IS NOT NULL OR max_volume_m3 IS NOT NULL OR max_pallets IS NOT NULL",
            name="ck_vehicles_some_capacity",
        ),
        CheckConstraint("max_weight_kg IS NULL OR max_weight_kg > 0", name="ck_vehicles_weight_pos"),
        CheckConstraint("max_volume_m3 IS NULL OR max_volume_m3 > 0", name="ck_vehicles_volume_pos"),
        CheckConstraint("max_pallets IS NULL OR max_pallets > 0", name="ck_vehicles_pallets_pos"),
    )


class Driver(SQLModel, table=True):
    """Driver profile, one per driver user."""
    __tablename__ = "drivers"

    id: int | None = Field(default=None, primary_key=True)
    user_id: uuid.UUID = Field(foreign_key="users.id", unique=True)
    name: str = Field(max_length=200)
    phone: str | None = Field(default=None, max_length=50)
    licence_number: str | None = Field(default=None, max_length=50)
    active: bool = Field(default=True)
    created_at: datetime = _ts(default_factory=utcnow)

    user: User = Relationship(sa_relationship_kwargs={"lazy": "selectin"})


# ---------------------------------------------------------------------------
# Background jobs
# ---------------------------------------------------------------------------

class Job(SQLModel, table=True):
    """
    A background job run by the arq worker. For kind=solve, `payload` is a
    schemas.SolveJobPayload and `result` a schemas.SolveResult (both as JSON).
    """
    __tablename__ = "jobs"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    kind: JobKind = Field(sa_type=JobKindType, nullable=False)
    status: JobStatus = Field(default=JobStatus.queued, sa_type=JobStatusType, nullable=False, index=True)
    payload: dict[str, Any] = Field(default_factory=dict, sa_type=JSONB, nullable=False)
    result: dict[str, Any] | None = Field(default=None, sa_type=JSONB, nullable=True)
    error: str | None = Field(default=None, sa_column=Column(Text, nullable=True))
    created_by_id: uuid.UUID | None = Field(default=None, foreign_key="users.id")
    created_at: datetime = _ts(default_factory=utcnow)
    started_at: datetime | None = _ts()
    finished_at: datetime | None = _ts()


# ---------------------------------------------------------------------------
# Plans and loads
# ---------------------------------------------------------------------------

class Plan(SQLModel, table=True):
    """
    A load plan for one delivery_date + zone. Created together with a solve
    Job. Its loads are written when the dispatcher saves the job's result as
    a draft, can be edited while draft, and are frozen when locked.
    """
    __tablename__ = "plans"

    id: int | None = Field(default=None, primary_key=True)
    delivery_date: date
    zone: str = Field(foreign_key="zones.code")
    status: PlanStatus = Field(default=PlanStatus.draft, sa_type=PlanStatusType, nullable=False, index=True)
    # Capacity profile the solver packed against (every load starts with it).
    vehicle_id: int = Field(foreign_key="vehicles.id")
    job_id: uuid.UUID = Field(foreign_key="jobs.id", unique=True)
    method: str | None = Field(default=None, max_length=16)  # "ortools" | "ffd" once saved
    created_by_id: uuid.UUID | None = Field(default=None, foreign_key="users.id")
    created_at: datetime = _ts(default_factory=utcnow)
    locked_at: datetime | None = _ts()

    loads: list["Load"] = Relationship(
        back_populates="plan",
        sa_relationship_kwargs={
            "lazy": "selectin",
            "cascade": "all, delete-orphan",
            "order_by": "Load.number",
        },
    )
    vehicle: Vehicle = Relationship(sa_relationship_kwargs={"lazy": "selectin"})

    __table_args__ = (Index("ix_plans_date_zone", "delivery_date", "zone"),)


class Load(SQLModel, table=True):
    """One truckload within a plan."""
    __tablename__ = "loads"

    id: int | None = Field(default=None, primary_key=True)
    plan_id: int = Field(foreign_key="plans.id", index=True, ondelete="CASCADE")
    number: int  # 1..n within the plan
    vehicle_id: int | None = Field(default=None, foreign_key="vehicles.id")
    driver_id: int | None = Field(default=None, foreign_key="drivers.id", index=True)
    created_at: datetime = _ts(default_factory=utcnow)

    plan: Plan = Relationship(back_populates="loads", sa_relationship_kwargs={"lazy": "selectin"})
    assignments: list["LoadAssignment"] = Relationship(
        back_populates="load",
        sa_relationship_kwargs={
            "lazy": "selectin",
            "cascade": "all, delete-orphan",
            "order_by": "LoadAssignment.id",
        },
    )
    vehicle: Vehicle | None = Relationship(sa_relationship_kwargs={"lazy": "selectin"})
    driver: Driver | None = Relationship(sa_relationship_kwargs={"lazy": "selectin"})

    __table_args__ = (UniqueConstraint("plan_id", "number", name="uq_loads_plan_number"),)


class LoadAssignment(SQLModel, table=True):
    """
    `quantity` units of an order line are on a load. A line's units may be
    split over several loads; the quantities of a line across a plan's
    loads always add up to the line's quantity.
    """
    __tablename__ = "load_assignments"

    id: int | None = Field(default=None, primary_key=True)
    load_id: int = Field(foreign_key="loads.id", index=True, ondelete="CASCADE")
    order_line_id: int = Field(foreign_key="order_lines.id", index=True)
    quantity: int

    load: Load = Relationship(back_populates="assignments")
    order_line: OrderLine = Relationship(sa_relationship_kwargs={"lazy": "selectin"})

    __table_args__ = (
        UniqueConstraint("load_id", "order_line_id", name="uq_load_assignments_load_line"),
        CheckConstraint("quantity > 0", name="ck_load_assignments_quantity_positive"),
    )


# ---------------------------------------------------------------------------
# Proof of delivery
# ---------------------------------------------------------------------------

class ProofOfDelivery(SQLModel, table=True):
    """Recorded by the driver at delivery. The photo is a file under UPLOAD_DIR."""
    __tablename__ = "proofs_of_delivery"

    id: int | None = Field(default=None, primary_key=True)
    order_id: int = Field(foreign_key="orders.id", index=True)
    load_id: int | None = Field(default=None, foreign_key="loads.id")
    driver_id: int = Field(foreign_key="drivers.id")
    signed_by: str = Field(max_length=200)
    photo_path: str = Field(max_length=500)          # relative to UPLOAD_DIR, server-generated
    photo_content_type: str = Field(max_length=50)   # image/jpeg | image/png | image/webp
    note: str | None = Field(default=None, max_length=1000)
    created_at: datetime = _ts(default_factory=utcnow)
