"""
Axle group load estimate (A-rules step fills this in). Static beam model, described in
app/reference/schemas.py. An estimate for planning, not a weighbridge reading.
"""

from app.planner.models import AxleLoad, Placement
from app.reference.schemas import MassScheme, VehicleConfig

NEAR_RATIO = 0.9  # "near" from 90 % of the limit


def estimate_axle_loads(vehicle: VehicleConfig, placements: list[Placement],
                        mass_scheme: MassScheme = "GML") -> list[AxleLoad]:
    """Estimated load per axle group (tare + cargo), in vehicle.axle_groups order."""
    raise NotImplementedError
