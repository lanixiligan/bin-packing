"""
Rule checks shared by every planner (A-rules step fills these in). Pure functions.

`precheck` runs before placement on the requested freight. `postcheck` runs on the finished
placement. Both return warnings, and severity "error" means the load does not fit.
"""

from dataclasses import dataclass, field

from app.planner.models import AxleLoad, FreightItem, Placement, PlanWarning
from app.reference.schemas import BodyType, MassScheme, ReferenceData, VehicleConfig


@dataclass
class CheckResult:
    warnings: list[PlanWarning] = field(default_factory=list)


def resolve_body(vehicle: VehicleConfig, body_type: str | None, ref: ReferenceData) -> BodyType:
    """The requested body (or the vehicle's default). Raises ValueError for an unknown id."""
    raise NotImplementedError


def precheck(items: list[FreightItem], vehicle: VehicleConfig, body: BodyType,
             ref: ReferenceData) -> CheckResult:
    """Unknown types, mixed freight, body/vehicle compatibility, out-of-scope bodies, reefer items,
    per-item height (max stack, internal, overall limit), container gross vs max gross,
    route-restricted vehicles."""
    raise NotImplementedError


def postcheck(placements: list[Placement], vehicle: VehicleConfig, body: BodyType,
              axle_loads: list[AxleLoad], total_weight_kg: float, mass_scheme: MassScheme,
              ref: ReferenceData) -> CheckResult:
    """Payload, overall height of the placed load, axle near/over limit (with suggestions)."""
    raise NotImplementedError
