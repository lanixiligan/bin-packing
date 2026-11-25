"""
FastAPI backend for the truck-loading (1D bin packing) demo.

Run with:  uvicorn main:app --reload --port 8000
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from solver import ffd, lower_bound, solve_cpsat

TIME_LIMIT_SECONDS = 10.0
MAX_SHIPMENTS = 200

app = FastAPI(title="Truck Loading - Bin Packing Demo")

# Allow the Vite dev server to call us directly (it also proxies, but this
# makes it work either way).
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


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


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/solve")
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
    lb = lower_bound(weights, req.capacity)

    # ---- 1. First-Fit Decreasing ----------------------------------------
    ffd_trucks, ffd_order, ffd_time = ffd(shipments, req.capacity)

    # ---- 2. OR-Tools CP-SAT (warm-started with the FFD answer) ----------
    cp_trucks, optimal, cp_time, status = solve_cpsat(
        shipments, req.capacity, TIME_LIMIT_SECONDS, hint=ffd_trucks
    )
    if cp_trucks is None:
        raise HTTPException(500, f"Solver did not find a solution (status: {status}).")

    return {
        "capacity": req.capacity,
        "total_weight": sum(weights),
        "lower_bound": lb,
        "ffd": {
            "num_trucks": len(ffd_trucks),
            "trucks": build_result(ffd_trucks, shipments, req.capacity),
            "solve_time_ms": round(ffd_time * 1000, 3),
            # FFD can't prove anything by itself, but if it hits the lower
            # bound, nobody can do better -> it is optimal.
            "hits_lower_bound": len(ffd_trucks) == lb,
            # Order FFD actually loaded shipments (heaviest first) -> animation.
            "drop_order": ffd_order,
        },
        "ortools": {
            "num_trucks": len(cp_trucks),
            "trucks": build_result(cp_trucks, shipments, req.capacity),
            "solve_time_ms": round(cp_time * 1000, 1),
            "optimal": optimal,
            "status": status,
            "time_limit_s": TIME_LIMIT_SECONDS,
            "drop_order": [i for truck in cp_trucks for i in truck],
        },
    }
