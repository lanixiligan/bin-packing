"""
The stateless truck loading demo: POST /api/solve (public). New request
fields stay optional and new response fields are only added, so older
clients keep working.

Dangerous goods: a shipment may carry a `dg_class` (or "food" / "fire_risk")
and, with a class, up to 4 `subsidiary` hazards; incompatible shipments (ADG
Table 9.1, app/dg.py, which also pairs subsidiary hazards) never share a truck. With
`rule_set: "northline"`, classes Northline never accepts are rejected (400).

It packs with Google OR-Tools CP-SAT (app/solver.py) and returns the fewest
trucks it finds, with whether that is proven optimal.

Pallets (optional): each shipment may take `pallets` spaces and the request
may set `max_pallets` per truck, which then limits the pallet dimension too.
Both are echoed only when given, so older requests get the same response.
"""

import threading
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, field_validator, model_validator

from app import dg as dgrules
from app.solver import Capacity, Unit
from app.solver import solve as solve_units

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

    pallets: int = Field(default=0, ge=0, le=100, description="Pallet spaces taken (0 = loose freight)")

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
    max_pallets: int | None = Field(default=None, gt=0, le=100,
                                    description="Pallet spaces per truck (null = not limited)")
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

    if req.max_pallets is not None:
        too_big = [s for s in req.shipments if s.pallets > req.max_pallets]
        if too_big:
            names = ", ".join(f"'{s.name}' ({s.pallets} pallets)" for s in too_big)
            raise HTTPException(
                400,
                f"These shipments take more pallet spaces than a truck has "
                f"({req.max_pallets}) and can never fit: {names}",
            )

    dgs = [demo_dg(s.dg_class, s.subsidiary) for s in req.shipments]
    if req.rule_set == "northline":
        refused = [f"'{s.name}' ({dgrules.label(d)})" for s, d in zip(req.shipments, dgs, strict=True)
                   if dgrules.northline_prohibited(d)]
        if refused:
            raise HTTPException(400, "Northline does not accept these shipments: " + ", ".join(refused))

    # Give each shipment an id so the frontend can track it in the views.
    shipments = [
        {"id": i, "name": s.name, "weight": s.weight, "dg_class": s.dg_class, "subsidiary": s.subsidiary,
         **({"pallets": s.pallets} if s.pallets else {})}
        for i, s in enumerate(req.shipments)
    ]
    units = [Unit(id=s["id"], name=s["name"], weight_kg=s["weight"], pallets=s.get("pallets", 0), dg=d)
             for s, d in zip(shipments, dgs, strict=True)]
    segregated = any(c.status == "incompatible" for c in dgrules.check_all(list({
        d.key(): d for d in dgs if not dgrules.is_general(d)}.values())))

    # ---- OR-Tools CP-SAT ------------------------------------------------
    if not _solve_slots.acquire(blocking=False):
        raise HTTPException(429, "The solver is busy with other requests. Try again in a few seconds.")
    try:
        result = solve_units(units, Capacity(weight_kg=req.capacity, pallets=req.max_pallets),
                             TIME_LIMIT_SECONDS)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(500, str(exc)) from exc
    finally:
        _solve_slots.release()

    return {
        "capacity": req.capacity,
        **({"max_pallets": req.max_pallets} if req.max_pallets is not None else {}),
        "total_weight": sum(s["weight"] for s in shipments),
        "total_pallets": sum(s.get("pallets", 0) for s in shipments),
        # No packing can use fewer trucks: the max over dimensions of ceil(total / capacity).
        "lower_bound": result.lower_bound,
        "lower_bounds": result.lower_bounds,
        # True when some shipments must travel apart (the lower bound ignores that).
        "segregated": segregated,
        "num_trucks": len(result.loads),
        "trucks": build_result(result.loads, shipments, req.capacity),
        "solve_time_ms": result.solve_time_ms,
        "optimal": result.optimal,
        "status": result.status,
        "time_limit_s": TIME_LIMIT_SECONDS,
        # Truck by truck, the order the shipments drop in (animation).
        "drop_order": [i for truck in result.loads for i in truck],
    }
