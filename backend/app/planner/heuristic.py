"""The default heuristic planner (A-place step fills this in)."""

from app.planner.models import PlanRequest, PlanResult
from app.reference.schemas import ReferenceData


class HeuristicPlanner:
    name = "heuristic"

    def plan(self, req: PlanRequest, ref: ReferenceData) -> PlanResult:
        raise NotImplementedError
