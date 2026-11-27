"""'Suggest the smallest vehicle that fits'."""

from app.planner.base import LoadPlanner
from app.planner.models import PlanRequest, PlanResult, VehicleTried
from app.reference.schemas import ReferenceData, VehicleConfig


def candidates(ref: ReferenceData) -> list[VehicleConfig]:
    """Vehicles to try, smallest first: fixed (not configurable), general-access ones only."""
    pool = [v for v in ref.vehicles.values() if not v.configurable and not v.route_restricted]
    return sorted(pool, key=lambda v: (v.pallet_spaces, v.max_payload_kg))


def suggest_vehicle(req: PlanRequest, ref: ReferenceData, planner: LoadPlanner) -> PlanResult:
    """Try every non-configurable, non-route-restricted vehicle smallest first (pallet spaces, then
    payload). Return the first plan that fits, with `tried` filled in. If none fit, return the
    largest vehicle's plan."""
    vehicles = candidates(ref)
    if not vehicles:
        raise ValueError("There are no vehicles to suggest from.")

    tried: list[VehicleTried] = []
    result: PlanResult | None = None
    for v in vehicles:
        body = req.body_type if req.body_type in v.allowed_bodies else None
        result = planner.plan(req.model_copy(update={"vehicle_id": v.id, "body_type": body}), ref)
        tried.append(VehicleTried(vehicle_id=v.id, fits=result.fits,
                                  reason=result.reasons[0] if result.reasons else ""))
        if result.fits:
            break
    assert result is not None
    return result.model_copy(update={"tried": tried})
