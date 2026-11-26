"""
Request and response models for the HTTP API (see docs/api.md).

This module is a SHARED CONTRACT: routers, the worker and the frontend's
generated client are all built against it. Do not change it without asking
the orchestrator.

Conventions
-----------
* `...Create` = POST body, `...Update` = PATCH body (all fields optional;
  only fields that were sent are applied: use `model_dump(exclude_unset=True)`),
  `...Read` = response.
* Money is serialised as a decimal STRING ("123.45"), see `MoneyOut`.
* Dates are ISO "YYYY-MM-DD", times "HH:MM[:SS]", timestamps ISO 8601 with offset.
* Capacity/usage values: weight in kg, volume in m³, pallets in pallet spaces.
  A capacity of None means "not limited in this dimension".
"""

import re
import uuid
from datetime import date, datetime, time
from decimal import Decimal
from typing import Annotated, Literal

from fastapi_users import schemas as fu_schemas
from pydantic import (
    BaseModel,
    ConfigDict,
    EmailStr,
    Field,
    PlainSerializer,
    WithJsonSchema,
    field_validator,
    model_validator,
)

from app.models import JobKind, JobStatus, OrderStatus, PlanStatus, UserRole

# Decimal money in responses, always a string with 2+ decimals: "12.50".
MoneyOut = Annotated[
    Decimal,
    PlainSerializer(lambda d: str(d), return_type=str, when_used="json"),
    WithJsonSchema({"type": "string", "pattern": r"^-?\d+(\.\d+)?$", "examples": ["12.50"]}),
]

ZONE_CODE_RE = re.compile(r"^[A-Z0-9_-]{1,32}$")
MONTH_PATTERN = r"^\d{4}-(0[1-9]|1[0-2])$"  # "2026-11"


class APIModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class ErrorDetail(BaseModel):
    """Body of every non-validation error response: {"detail": "..."}."""
    detail: str


# ---------------------------------------------------------------------------
# Auth and users
# ---------------------------------------------------------------------------

class UserRead(fu_schemas.BaseUser[uuid.UUID]):
    full_name: str
    role: UserRole
    company_id: int | None


class UserCreate(fu_schemas.BaseUserCreate):
    """Public sign-up. Always creates a NEW customer company with this user as
    its first customer user. `role`, `is_superuser` etc. cannot be chosen."""
    full_name: str = Field(min_length=1, max_length=200)
    company_name: str = Field(min_length=1, max_length=200)


class MeRead(UserRead):
    """GET /api/users/me."""
    company_name: str | None = None
    driver_id: int | None = None  # set for driver users


# ---------------------------------------------------------------------------
# Addresses
# ---------------------------------------------------------------------------

class AddressBase(BaseModel):
    label: str = Field(min_length=1, max_length=100)
    contact_name: str | None = Field(default=None, max_length=200)
    phone: str | None = Field(default=None, max_length=50)
    line1: str = Field(min_length=1, max_length=200)
    line2: str | None = Field(default=None, max_length=200)
    suburb: str = Field(min_length=1, max_length=100)
    state: str = Field(min_length=1, max_length=50)
    postcode: str = Field(min_length=3, max_length=10)
    country: str = Field(default="AU", min_length=2, max_length=2)
    notes: str | None = Field(default=None, max_length=1000)


class AddressCreate(AddressBase):
    pass


class AddressUpdate(BaseModel):
    label: str | None = Field(default=None, min_length=1, max_length=100)
    contact_name: str | None = Field(default=None, max_length=200)
    phone: str | None = Field(default=None, max_length=50)
    line1: str | None = Field(default=None, min_length=1, max_length=200)
    line2: str | None = Field(default=None, max_length=200)
    suburb: str | None = Field(default=None, min_length=1, max_length=100)
    state: str | None = Field(default=None, min_length=1, max_length=50)
    postcode: str | None = Field(default=None, min_length=3, max_length=10)
    country: str | None = Field(default=None, min_length=2, max_length=2)
    notes: str | None = Field(default=None, max_length=1000)


class AddressRead(AddressBase, APIModel):
    id: int
    company_id: int
    zone: str | None
    archived: bool
    created_at: datetime


class OpsAddressRead(AddressRead):
    company_name: str


class AddressZoneUpdate(BaseModel):
    """PATCH /api/ops/addresses/{id}: set or clear (null) the zone."""
    zone: str | None


# ---------------------------------------------------------------------------
# Items
# ---------------------------------------------------------------------------

class ItemCreate(BaseModel):
    sku: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=1000)
    weight_kg: float = Field(gt=0, le=100_000)
    volume_m3: float = Field(default=0, ge=0, le=1_000)
    pallet_spaces: float = Field(default=0, ge=0, le=100)


class ItemUpdate(BaseModel):
    sku: str | None = Field(default=None, min_length=1, max_length=64)
    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=1000)
    weight_kg: float | None = Field(default=None, gt=0, le=100_000)
    volume_m3: float | None = Field(default=None, ge=0, le=1_000)
    pallet_spaces: float | None = Field(default=None, ge=0, le=100)


class ItemRead(APIModel):
    id: int
    company_id: int
    sku: str
    name: str
    description: str | None
    weight_kg: float
    volume_m3: float
    pallet_spaces: float
    archived: bool
    created_at: datetime


# ---------------------------------------------------------------------------
# Quotes
# ---------------------------------------------------------------------------

class QuoteRead(APIModel):
    """`id` and `created_at` are null for a preview that was not stored."""
    id: int | None = None
    zone_code: str | None
    total_weight_kg: float
    total_volume_m3: float
    cubic_weight_kg: float
    rate_per_kg: MoneyOut
    amount: MoneyOut
    provisional: bool
    created_at: datetime | None = None


# ---------------------------------------------------------------------------
# Orders
# ---------------------------------------------------------------------------

class OrderLineIn(BaseModel):
    item_id: int
    quantity: int = Field(ge=1, le=10_000)


class _OrderFields(BaseModel):
    @model_validator(mode="after")
    def _check(self):
        p, d = getattr(self, "pickup_address_id", None), getattr(self, "delivery_address_id", None)
        if p is not None and d is not None and p == d:
            raise ValueError("Pickup and delivery addresses must be different.")
        ws, we = getattr(self, "window_start", None), getattr(self, "window_end", None)
        if ws is not None and we is not None and ws >= we:
            raise ValueError("The delivery window must end after it starts.")
        lines = getattr(self, "lines", None)
        if lines is not None and len({ln.item_id for ln in lines}) != len(lines):
            raise ValueError("Each item may appear only once per order; combine the quantities.")
        return self


class OrderCreate(_OrderFields):
    """Creates a DRAFT order. Items and addresses must belong to the caller's company."""
    pickup_address_id: int
    delivery_address_id: int
    delivery_date: date
    window_start: time | None = None
    window_end: time | None = None
    customer_reference: str | None = Field(default=None, max_length=64)
    notes: str | None = Field(default=None, max_length=1000)
    lines: list[OrderLineIn] = Field(min_length=1, max_length=100)


class OrderUpdate(_OrderFields):
    """Draft orders only. When `lines` is sent it REPLACES all lines."""
    pickup_address_id: int | None = None
    delivery_address_id: int | None = None
    delivery_date: date | None = None
    window_start: time | None = None
    window_end: time | None = None
    customer_reference: str | None = Field(default=None, max_length=64)
    notes: str | None = Field(default=None, max_length=1000)
    lines: list[OrderLineIn] | None = Field(default=None, min_length=1, max_length=100)


class StatusNote(BaseModel):
    """Body of submit / cancel / accept: an optional note for the event log."""
    note: str | None = Field(default=None, max_length=1000)


class RejectBody(BaseModel):
    note: str = Field(min_length=1, max_length=1000, description="Reason, shown to the customer.")


class QuotePreviewRequest(BaseModel):
    delivery_address_id: int
    lines: list[OrderLineIn] = Field(min_length=1, max_length=100)


class OrderLineRead(APIModel):
    id: int
    item_id: int
    item_name: str
    item_sku: str
    quantity: int
    unit_weight_kg: float
    unit_volume_m3: float
    unit_pallet_spaces: float


class OrderEventRead(APIModel):
    id: int
    from_status: OrderStatus | None
    to_status: OrderStatus
    actor_id: uuid.UUID | None
    actor_name: str | None = None   # filled in by app.serializers
    actor_role: UserRole | None = None
    note: str | None
    created_at: datetime


class PodRead(APIModel):
    id: int
    order_id: int
    signed_by: str
    note: str | None
    created_at: datetime
    driver_name: str | None = None
    photo_url: str  # GET this path (with the bearer token) for the image


class OrderSummary(APIModel):
    """One row of an order list (portal and ops)."""
    id: int
    reference: str
    status: OrderStatus
    company_id: int
    company_name: str
    delivery_date: date
    window_start: time | None
    window_end: time | None
    customer_reference: str | None
    pickup_label: str
    delivery_label: str
    delivery_suburb: str
    zone: str | None           # the delivery address's zone
    line_count: int
    total_units: int
    total_weight_kg: float
    total_volume_m3: float
    total_pallet_spaces: float
    amount: MoneyOut | None    # quoted price, once submitted
    plan_id: int | None
    created_at: datetime
    updated_at: datetime


class OrderRead(OrderSummary):
    """Order detail with lines, timeline, quote and proof of delivery."""
    pickup_address: AddressRead
    delivery_address: AddressRead
    notes: str | None
    lines: list[OrderLineRead]
    events: list[OrderEventRead]  # oldest first
    quote: QuoteRead | None
    pods: list[PodRead]
    submitted_at: datetime | None
    delivered_at: datetime | None


# ---------------------------------------------------------------------------
# Zones and batches (ops)
# ---------------------------------------------------------------------------

class ZoneCreate(BaseModel):
    code: str = Field(description="Uppercase letters, digits, '_' or '-', up to 32 chars.")
    name: str = Field(min_length=1, max_length=100)
    rate_per_kg: Decimal = Field(gt=0, max_digits=10, decimal_places=4)

    @field_validator("code")
    @classmethod
    def _code(cls, v: str) -> str:
        v = v.strip().upper()
        if not ZONE_CODE_RE.match(v):
            raise ValueError("Zone code must be 1-32 characters: A-Z, 0-9, '_' or '-'.")
        return v


class ZoneUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    rate_per_kg: Decimal | None = Field(default=None, gt=0, max_digits=10, decimal_places=4)
    active: bool | None = None


class ZoneRead(APIModel):
    code: str
    name: str
    rate_per_kg: MoneyOut
    active: bool
    created_at: datetime


class BatchSummary(BaseModel):
    """Accepted orders grouped by delivery date + zone (zone null = address not zoned yet)."""
    delivery_date: date
    zone: str | None
    zone_name: str | None
    unplanned_orders: int        # accepted and not reserved by a plan
    planned_orders: int          # reserved by a plan (draft or locked)
    total_weight_kg: float       # of the unplanned orders
    total_volume_m3: float
    total_pallet_spaces: float
    plan_ids: list[int]


# ---------------------------------------------------------------------------
# Fleet (ops)
# ---------------------------------------------------------------------------

class VehicleCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    registration: str = Field(min_length=1, max_length=20)
    max_weight_kg: float | None = Field(default=None, gt=0, le=100_000)
    max_volume_m3: float | None = Field(default=None, gt=0, le=1_000)
    max_pallets: int | None = Field(default=None, gt=0, le=100)
    active: bool = True

    @model_validator(mode="after")
    def _some_capacity(self):
        if self.max_weight_kg is None and self.max_volume_m3 is None and self.max_pallets is None:
            raise ValueError("Set at least one capacity: weight, volume or pallets.")
        return self


class VehicleUpdate(BaseModel):
    """The server re-checks that at least one capacity remains set."""
    name: str | None = Field(default=None, min_length=1, max_length=100)
    registration: str | None = Field(default=None, min_length=1, max_length=20)
    max_weight_kg: float | None = Field(default=None, gt=0, le=100_000)
    max_volume_m3: float | None = Field(default=None, gt=0, le=1_000)
    max_pallets: int | None = Field(default=None, gt=0, le=100)
    active: bool | None = None


class VehicleRead(APIModel):
    id: int
    name: str
    registration: str
    max_weight_kg: float | None
    max_volume_m3: float | None
    max_pallets: int | None
    active: bool
    created_at: datetime


class DriverCreate(BaseModel):
    """Creates a driver login (role=driver) and its driver profile."""
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    name: str = Field(min_length=1, max_length=200)
    phone: str | None = Field(default=None, max_length=50)
    licence_number: str | None = Field(default=None, max_length=50)


class DriverUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    phone: str | None = Field(default=None, max_length=50)
    licence_number: str | None = Field(default=None, max_length=50)
    active: bool | None = None  # inactive drivers also cannot log in


class DriverRead(APIModel):
    id: int
    user_id: uuid.UUID
    email: str
    name: str
    phone: str | None
    licence_number: str | None
    active: bool
    created_at: datetime


# ---------------------------------------------------------------------------
# Solver input/output (job payload and result)
# ---------------------------------------------------------------------------

class Capacity(BaseModel):
    """Per-load limits. None = not limited. At least one is set."""
    weight_kg: float | None = None
    volume_m3: float | None = None
    pallets: float | None = None


class Usage(BaseModel):
    weight_kg: float
    volume_m3: float
    pallets: float


class FillPercent(BaseModel):
    """Usage as % of capacity, per limited dimension (None where not limited)."""
    weight: float | None = None
    volume: float | None = None
    pallets: float | None = None


class LowerBounds(BaseModel):
    """ceil(total / capacity) per limited dimension."""
    weight: int | None = None
    volume: int | None = None
    pallets: int | None = None


class SolveJobPayload(BaseModel):
    """Job.payload for kind=solve. Written by POST /api/ops/plans."""
    plan_id: int
    order_ids: list[int]
    capacity: Capacity
    time_limit_s: float


class PackUnit(BaseModel):
    """One unit (1 of an order line's quantity). `id` = index in SolveResult.units."""
    id: int
    order_id: int
    order_reference: str
    order_line_id: int
    item_name: str
    item_sku: str
    weight_kg: float
    volume_m3: float
    pallets: float


class PackedLoad(BaseModel):
    number: int             # 1-based
    unit_ids: list[int]     # in loading order
    usage: Usage
    fill_percent: FillPercent


class MethodResult(BaseModel):
    num_loads: int
    loads: list[PackedLoad]
    solve_time_ms: float
    drop_order: list[int]   # unit ids in the order the method placed them (animation)
    optimal: bool           # FFD: hits the lower bound; CP-SAT: proven optimal or hits the bound
    status: str             # FFD: "HEURISTIC"; CP-SAT: "OPTIMAL", "FEASIBLE", ...


class SolveResult(BaseModel):
    """Job.result for kind=solve; GET /api/jobs/{id}/result."""
    capacity: Capacity
    totals: Usage
    lower_bound: int                # max over the dimensions
    lower_bounds: LowerBounds
    units: list[PackUnit]
    ffd: MethodResult
    ortools: MethodResult | None    # None if CP-SAT found no solution in time
    recommended: Literal["ortools", "ffd"]
    time_limit_s: float


class UnitMisfit(BaseModel):
    """A unit that is bigger than the vehicle capacity in some dimension."""
    order_id: int
    order_reference: str
    order_line_id: int
    item_name: str
    item_sku: str
    dimensions: list[Literal["weight", "volume", "pallets"]]
    message: str   # e.g. "Pallet jack (SKU PJ-1): 1200 kg > 1000 kg capacity"


class InfeasibleDetail(BaseModel):
    """`detail` of a 422 from POST /api/ops/plans when some units can never fit."""
    message: str
    misfits: list[UnitMisfit]


# ---------------------------------------------------------------------------
# Plans and loads (ops)
# ---------------------------------------------------------------------------

class PlanCreate(BaseModel):
    delivery_date: date
    zone: str
    vehicle_id: int = Field(description="Capacity profile to pack against.")


class PlanSaveDraft(BaseModel):
    """Write the loads of one method's solution. Replaces existing loads of a draft plan."""
    method: Literal["ortools", "ffd"] = "ortools"


class LineMove(BaseModel):
    """
    Move `quantity` units of an order line from one load to another load of
    the same plan (to_load_id null = into a new load). quantity null = all
    units of that line on from_load. 422 if the target would exceed capacity.
    """
    order_line_id: int
    from_load_id: int
    to_load_id: int | None = None
    quantity: int | None = Field(default=None, ge=1)


class LoadUpdate(BaseModel):
    """Assign (or clear with null) a vehicle and/or driver. Only sent fields change.
    Changing the vehicle re-validates the load against its capacity (422)."""
    vehicle_id: int | None = None
    driver_id: int | None = None


class LoadLineRead(BaseModel):
    assignment_id: int
    order_line_id: int
    order_id: int
    order_reference: str
    company_name: str
    item_name: str
    item_sku: str
    quantity: int           # units on this load
    line_quantity: int      # units on the whole line
    unit_weight_kg: float
    unit_volume_m3: float
    unit_pallet_spaces: float


class LoadRead(BaseModel):
    id: int
    number: int
    vehicle: VehicleRead | None
    driver: DriverRead | None
    capacity: Capacity      # of the assigned vehicle, else the plan's profile vehicle
    usage: Usage
    fill_percent: FillPercent
    over_capacity: bool
    lines: list[LoadLineRead]


class PlanSummary(BaseModel):
    id: int
    delivery_date: date
    zone: str
    status: PlanStatus
    job_id: uuid.UUID
    job_status: JobStatus
    method: str | None
    order_count: int
    load_count: int
    created_at: datetime
    locked_at: datetime | None


class PlanRead(PlanSummary):
    vehicle: VehicleRead     # capacity profile
    order_ids: list[int]
    loads: list[LoadRead]


# ---------------------------------------------------------------------------
# Jobs
# ---------------------------------------------------------------------------

class JobRead(APIModel):
    id: uuid.UUID
    kind: JobKind
    status: JobStatus
    error: str | None
    created_at: datetime
    started_at: datetime | None
    finished_at: datetime | None
    time_limit_s: float | None = None   # from the payload, for progress bars
    plan_id: int | None = None


# ---------------------------------------------------------------------------
# Driver
# ---------------------------------------------------------------------------

class DriverLine(BaseModel):
    item_name: str
    item_sku: str
    quantity: int   # units of this line on the driver's load


class DriverOrder(BaseModel):
    """One order on a driver's load: pickup at pickup_address, drop at delivery_address."""
    order_id: int
    reference: str
    status: OrderStatus
    load_id: int
    company_name: str
    delivery_date: date
    window_start: time | None
    window_end: time | None
    pickup_address: AddressRead
    delivery_address: AddressRead
    notes: str | None
    lines: list[DriverLine]
    total_weight_kg: float          # on this load
    next_statuses: list[OrderStatus]  # what the driver may set next (from app.lifecycle)
    pods: list[PodRead]


class DriverRunLoad(BaseModel):
    load_id: int
    number: int
    plan_id: int
    zone: str
    delivery_date: date
    vehicle: VehicleRead | None
    orders: list[DriverOrder]


class DriverRun(BaseModel):
    """GET /api/driver/run: the driver's loads in LOCKED plans for one date."""
    date: date
    driver: DriverRead
    loads: list[DriverRunLoad]


class DriverStatusUpdate(BaseModel):
    """`delivered` is not allowed here: use the POD upload. `exception` needs a note."""
    status: Literal[OrderStatus.picked_up, OrderStatus.in_transit, OrderStatus.exception]
    note: str | None = Field(default=None, max_length=1000)

    @model_validator(mode="after")
    def _note_for_exception(self):
        if self.status == OrderStatus.exception and not (self.note and self.note.strip()):
            raise ValueError("Describe the problem in the note when reporting an exception.")
        return self


# ---------------------------------------------------------------------------
# Invoices (ops)
# ---------------------------------------------------------------------------

class InvoiceSummary(BaseModel):
    company_id: int
    company_name: str
    month: str               # "2026-11"
    order_count: int
    total_amount: MoneyOut


class InvoiceLine(BaseModel):
    order_id: int
    reference: str
    customer_reference: str | None
    delivered_at: datetime
    delivery_suburb: str
    zone_code: str | None
    total_weight_kg: float
    total_volume_m3: float
    cubic_weight_kg: float
    rate_per_kg: MoneyOut
    amount: MoneyOut


class Invoice(BaseModel):
    company_id: int
    company_name: str
    month: str
    lines: list[InvoiceLine]  # sorted by delivered_at
    order_count: int
    total_amount: MoneyOut
