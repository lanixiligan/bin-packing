"""'Suggest the smallest vehicle that fits' (A-rules step fills this in)."""

from app.planner.base import LoadPlanner
from app.planner.models import PlanRequest, PlanResult
from app.reference.schemas import ReferenceData


def suggest_vehicle(req: PlanRequest, ref: ReferenceData, planner: LoadPlanner) -> PlanResult:
    """Try every non-configurable, non-route-restricted vehicle smallest first (pallet spaces, then
    payload). Return the first plan that fits, with `tried` filled in. If none fit, return the
    largest vehicle's plan."""
    raise NotImplementedError
