"""
The original stateless 1D bin packing demo: POST /api/solve (public).
Owner: Agent B. Keep its request and response unchanged.

It runs on the multi-dimension solver (app/solver/multi.py) with weight as
the only limited dimension, so the demo and load planning share one model.
"""

import threading

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.schemas import Capacity, PackUnit
from app.solver.multi import solve as solve_units

TIME_LIMIT_SECONDS = 10.0
MAX_SHIPMENTS = 200
# The endpoint is public and each solve can use 8 solver threads for up to
# TIME_LIMIT_SECONDS, so only this many run at once; the rest get 429.
MAX_CONCURRENT_SOLVES = 2
_solve_slots = threading.BoundedSemaphore(MAX_CONCURRENT_SOLVES)

router = APIRouter()


class Shipment(BaseModel):
    name: str = Field(min_length=1, max_length=50)
    weight: int = Field(gt=0, description="Weight in kg (whole number)")


class SolveRequest(BaseModel):
    capacity: int = Field(gt=0, description="Truck max capacity in kg")
    shipments: list[Shipment]


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

    # Give each shipment an id so the frontend can track it across panels.
    shipments = [
        {"id": i, "name": s.name, "weight": s.weight}
        for i, s in enumerate(req.shipments)
    ]
    weights = [s["weight"] for s in shipments]
    units = [
        PackUnit(id=s["id"], order_id=0, order_reference="", order_line_id=s["id"],
                 item_name=s["name"], item_sku="", weight_kg=s["weight"], volume_m3=0, pallets=0)
        for s in shipments
    ]

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
