"""
The original stateless 1D bin packing demo: POST /api/solve (public).
Owner: Agent B. Keep its request and response backward compatible (new fields
are optional in the request and only added to the response).

Dangerous goods: a shipment may carry a `dg_class` (or "food" / "fire_risk")
and, with a class, up to 4 `subsidiary` hazards; incompatible shipments (ADG
Table 9.1, app/dg.py, which also pairs subsidiary hazards) never share a truck. With
`rule_set: "northline"`, classes Northline never accepts are rejected (400).

It runs on the multi-dimension solver (app/solver/multi.py) with weight as
the only limited dimension, so the demo and load planning share one model.
"""

import threading
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, field_validator, model_validator

from app import dg as dgrules
from app.schemas import Capacity, PackUnit
from app.solver.multi import solve as solve_units

TIME_LIMIT_SECONDS = 10.0
MAX_SHIPMENTS = 200
# The endpoint is public and each solve can use 8 solver threads for up to
# TIME_LIMIT_SECONDS, so only this many run at once; the rest get 429.
MAX_CONCURRENT_SOLVES = 2
_solve_slots = threading.BoundedSemaphore(MAX_CONCURRENT_SOLVES)

router = APIRouter()


DemoDg = Literal["1", "2.1", "2.2", "2.3", "3", "4.1", "4.2", "4.3", "5.1", "5.2", "6.1", "6.2",
                 "7", "8", "9", "food", "fire_risk"]
# Class 1 in the demo means small arms ammunition (1.4S), the only explosive with wide acceptance.
DEMO_EXPLOSIVE = "1.4S"


class Shipment(BaseModel):
    name: str = Field(min_length=1, max_length=50)
    weight: int = Field(gt=0, le=1_000_000, description="Weight in kg (whole number)")
    dg_class: DemoDg | None = Field(default=None, description="DG class, 'food', 'fire_risk', or "
                                                              "null for general freight")
    subsidiary: list[dgrules.Subsidiary] = Field(
        default_factory=list, max_length=4,
        description="Subsidiary hazards (only with a DG class, never the class itself)")

    @field_validator("subsidiary")
    @classmethod
    def _sorted_unique(cls, v: list[str]) -> list[str]:
        return sorted(set(v))

    @model_validator(mode="after")
    def _subsidiary_needs_class(self) -> "Shipment":
        if self.subsidiary:
            if self.dg_class in (None, "food", "fire_risk"):
                raise ValueError("Subsidiary hazards need a DG class.")
            if self.dg_class in self.subsidiary:
                raise ValueError(f"A subsidiary hazard can't be the same as the class ({self.dg_class}).")
        return self


class SolveRequest(BaseModel):
    capacity: int = Field(gt=0, le=1_000_000, description="Truck max capacity in kg")
    shipments: list[Shipment]
    rule_set: dgrules.RuleSet = "adg"


def demo_dg(value: str | None, subsidiary: list[str] | tuple[str, ...] = ()) -> dgrules.DgInfo | None:
    """DgInfo for a demo shipment's class and subsidiary hazards (Table 9.2 answered 'none of these')."""
    if value is None:
        return None
    if value == "food":
        return dgrules.DgInfo(food=True)
    if value == "fire_risk":
        return dgrules.DgInfo(fire_risk=True)
    return dgrules.DgInfo(dg_class=value, subsidiary=list(subsidiary), t92=[],
                          explosive_code=DEMO_EXPLOSIVE if value == "1" else None)


def build_result(trucks, shipments, capacity):
    """Turn lists of shipment indices into a friendly JSON structure."""
    out = []
    for t, idxs in enumerate(trucks):
        load = sum(shipments[i]["weight"] for i in idxs)
        out.append({
            "truck": t + 1,
            "shipments": [shipments[i] for i in idxs],
            "load": load,
            "empty": capacity - load,
            "fill_percent": round(100 * load / capacity, 1),
        })
    return out


@router.post("/solve", tags=["demo"])
def solve(req: SolveRequest):
    # ---- Validation -------------------------------------------------------
    if not req.shipments:
        raise HTTPException(400, "Add at least one shipment.")
    if len(req.shipments) > MAX_SHIPMENTS:
        raise HTTPException(400, f"Too many shipments (max {MAX_SHIPMENTS}).")

    too_heavy = [s for s in req.shipments if s.weight > req.capacity]
    if too_heavy:
        names = ", ".join(f"'{s.name}' ({s.weight} kg)" for s in too_heavy)
        raise HTTPException(
            400,
            f"These shipments are heavier than the truck capacity "
            f"({req.capacity} kg) and can never fit: {names}",
        )

    dgs = [demo_dg(s.dg_class, s.subsidiary) for s in req.shipments]
    if req.rule_set == "northline":
        refused = [f"'{s.name}' ({dgrules.label(d)})" for s, d in zip(req.shipments, dgs, strict=True)
                   if dgrules.northline_prohibited(d)]
        if refused:
            raise HTTPException(400, "Northline does not accept these shipments: " + ", ".join(refused))

    # Give each shipment an id so the frontend can track it across panels.
    shipments = [
        {"id": i, "name": s.name, "weight": s.weight, "dg_class": s.dg_class, "subsidiary": s.subsidiary}
        for i, s in enumerate(req.shipments)
    ]
    weights = [s["weight"] for s in shipments]
    units = [
        PackUnit(id=s["id"], order_id=0, order_reference="", order_line_id=s["id"],
                 item_name=s["name"], item_sku="", weight_kg=s["weight"], volume_m3=0, pallets=0,
                 dg=d)
        for s, d in zip(shipments, dgs, strict=True)
    ]
    segregated = any(c.status == "incompatible" for c in dgrules.check_all(list({
        d.key(): d for d in dgs if not dgrules.is_general(d)}.values())))

    # ---- FFD, then CP-SAT warm-started with the FFD answer ---------------
    if not _solve_slots.acquire(blocking=False):
        raise HTTPException(429, "The solver is busy with other requests. Try again in a few seconds.")
    try:
        result, status = solve_units(units, Capacity(weight_kg=req.capacity), TIME_LIMIT_SECONDS)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    finally:
        _solve_slots.release()
    if result.ortools is None:
        raise HTTPException(500, f"Solver did not find a solution (status: {status}).")
    lb = result.lower_bound
    ffd_trucks = [load.unit_ids for load in result.ffd.loads]
    cp_trucks = [load.unit_ids for load in result.ortools.loads]

    return {
        "capacity": req.capacity,
        "total_weight": sum(weights),
        "lower_bound": lb,
        # True when some shipments must travel apart (the lower bound ignores that).
        "segregated": segregated,
        "ffd": {
            "num_trucks": len(ffd_trucks),
            "trucks": build_result(ffd_trucks, shipments, req.capacity),
            "solve_time_ms": round(result.ffd.solve_time_ms, 3),
            # FFD can't prove anything by itself, but if it hits the lower
            # bound, nobody can do better -> it is optimal.
            "hits_lower_bound": len(ffd_trucks) == lb,
            # Order FFD actually loaded shipments (heaviest first) -> animation.
            "drop_order": result.ffd.drop_order,
        },
        "ortools": {
            "num_trucks": len(cp_trucks),
            "trucks": build_result(cp_trucks, shipments, req.capacity),
            "solve_time_ms": round(result.ortools.solve_time_ms, 1),
            "optimal": result.ortools.optimal,
            "status": result.ortools.status,
            "time_limit_s": TIME_LIMIT_SECONDS,
            "drop_order": [i for truck in cp_trucks for i in truck],
        },
    }
