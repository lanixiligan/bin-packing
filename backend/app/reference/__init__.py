"""
Reference data, the single source of truth for pallets, containers, bodies and vehicles.

The frontend reads it from GET /api/reference and never keeps its own copy.
All values are typical industry values: override them with `load_reference(overrides)`.
"""

from app.reference.schemas import ReferenceData, ReferenceOverrides


def load_reference(overrides: ReferenceOverrides | None = None) -> ReferenceData:
    """The default reference data, with `overrides` deep-merged and re-validated."""
    raise NotImplementedError("Reference data is filled in by the A-ref step.")


__all__ = ["ReferenceData", "ReferenceOverrides", "load_reference"]
