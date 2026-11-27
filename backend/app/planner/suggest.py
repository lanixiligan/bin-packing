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
    largest vehicle's plan. A requested body_type is kept: vehicles without it are skipped."""
    vehicles = candidates(ref)
    if not vehicles:
        raise ValueError("There are no vehicles to suggest from.")

    tried: list[VehicleTried] = []
    result: PlanResult | None = None
    for v in vehicles:
        # A body the user asked for is a requirement: skip vehicles that don't offer it rather than
        # quietly planning on their default body.
        if req.body_type is not None and req.body_type not in v.allowed_bodies:
            body_name = ref.bodies[req.body_type].name if req.body_type in ref.bodies else req.body_type
            tried.append(VehicleTried(vehicle_id=v.id, fits=False,
                                      reason=f"The {v.name} doesn't come with a {body_name.lower()} body."))
            continue
        result = planner.plan(req.model_copy(update={"vehicle_id": v.id}), ref)
        tried.append(VehicleTried(vehicle_id=v.id, fits=result.fits,
                                  reason=result.reasons[0] if result.reasons else ""))
        if result.fits:
            break
    if result is None:
        raise ValueError(f"No vehicle to suggest offers a '{req.body_type}' body. "
                         "Choose another body type, or pick a vehicle yourself.")
    return result.model_copy(update={"tried": tried})
