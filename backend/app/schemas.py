"""
Solver input and output models (app/solver).

Capacity/usage values: weight in kg, volume in m³, pallets in pallet spaces.
A capacity of None means "not limited in this dimension". The demo endpoint
(app/routers/demo.py) limits weight, and pallets when a pallet limit is set.
"""

from typing import Literal

from pydantic import BaseModel

from app.dg import DgInfo


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


class PackUnit(BaseModel):
    """One unit to pack. `id` = index in SolveResult.units."""
    id: int
    order_id: int
    order_reference: str
    order_line_id: int
    item_name: str
    item_sku: str
    weight_kg: float
    volume_m3: float
    pallets: float
    dg: DgInfo | None = None   # incompatible units are never packed on the same load


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
    """A unit that is bigger than the capacity in some dimension."""
    order_id: int
    order_reference: str
    order_line_id: int
    item_name: str
    item_sku: str
    dimensions: list[Literal["weight", "volume", "pallets"]]
    message: str   # e.g. "Pallet jack (SKU PJ-1): 1200 kg > 1000 kg capacity"
