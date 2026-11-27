"""
The load planner interface. Any solver that implements `LoadPlanner` can replace the heuristic:
register it in `_REGISTRY` and pick it by name.
"""

from typing import Protocol

from app.planner.models import SUGGEST, PlanRequest, PlanResult
from app.reference.schemas import ReferenceData


class LoadPlanner(Protocol):
    name: str

    def plan(self, req: PlanRequest, ref: ReferenceData) -> PlanResult:
        """Plan `req.items` on vehicle `req.vehicle_id` (never "suggest": see `run_plan`)."""
        ...


def get_planner(name: str = "heuristic") -> LoadPlanner:
    if name == "heuristic":
        from app.planner.heuristic import HeuristicPlanner
        return HeuristicPlanner()
    raise ValueError(f"Unknown planner '{name}'.")


def run_plan(req: PlanRequest, ref: ReferenceData, planner: LoadPlanner | None = None) -> PlanResult:
    """Plan on the requested vehicle, or try vehicles smallest first for vehicle_id='suggest'."""
    planner = planner or get_planner()
    if req.vehicle_id == SUGGEST:
        from app.planner.suggest import suggest_vehicle
        return suggest_vehicle(req, ref, planner)
    return planner.plan(req, ref)
