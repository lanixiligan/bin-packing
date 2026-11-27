"""
The load planner API.

GET  /api/reference  all reference data (pallets, containers, bodies, vehicles). The frontend
                     reads its options from here and keeps no copy of its own.
POST /api/plan       plan one load on one vehicle, or vehicle_id="suggest" for the smallest that fits.

Units: mm, kg, m³. Results are for planning only: not compliance with the NTC Load Restraint
Guide or with mass limits.
"""

from fastapi import APIRouter, HTTPException
from pydantic import ValidationError

from app.planner.base import run_plan
from app.planner.models import PlanRequest, PlanResult
from app.reference import ReferenceData, load_reference

router = APIRouter()


@router.get("/reference", response_model=ReferenceData, tags=["planner"])
def reference() -> ReferenceData:
    return load_reference()


@router.post("/plan", response_model=PlanResult, tags=["planner"])
def plan(req: PlanRequest) -> PlanResult:
    try:
        ref = load_reference(req.overrides)
    except (ValidationError, ValueError) as exc:
        raise HTTPException(400, f"Those overrides aren't valid: {exc}") from exc
    if req.vehicle_id != "suggest" and req.vehicle_id not in ref.vehicles:
        raise HTTPException(400, f"Unknown vehicle '{req.vehicle_id}'. Pick one from /api/reference.")
    if req.body_type is not None and req.body_type not in ref.bodies:
        raise HTTPException(400, f"Unknown body type '{req.body_type}'.")
    try:
        return run_plan(req, ref)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
