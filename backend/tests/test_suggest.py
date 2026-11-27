import pytest

from app.planner.base import run_plan
from app.planner.models import PlanRequest, PlanResult, PlanWarning, Usage, Utilisation
from app.planner.suggest import suggest_vehicle
from app.reference.schemas import ReferenceData
from tests.factories import SEMI, pallets, reference, request


class FakePlanner:
    """Fits when the vehicle has at least as many pallet spaces as the total quantity."""
    name = "fake"

    def __init__(self) -> None:
        self.calls: list[PlanRequest] = []

    def plan(self, req: PlanRequest, ref: ReferenceData) -> PlanResult:
        self.calls.append(req)
        v = ref.vehicles[req.vehicle_id]
        qty = sum(it.quantity for it in req.items)
        fits = v.pallet_spaces >= qty
        warnings = [] if fits else [PlanWarning(code="OVER_CAPACITY", severity="error",
                                                message=f"{qty - v.pallet_spaces} pallets don't fit.")]
        zero = Usage(used=0, available=0, pct=0)
        usage = Utilisation(pallet_spaces=zero, teu=zero, payload_kg=zero, volume_m3=zero)
        return PlanResult(fits=fits, reasons=[w.message for w in warnings], warnings=warnings,
                          vehicle_id=v.id, vehicle_name=v.name, body_type=req.body_type or v.default_body,
                          mass_scheme=req.mass_scheme, placements=[],
                          utilisation=usage,
                          axle_loads=[], total_weight_kg=0, max_load_height_mm=0, planner=self.name)


REF = reference()


def suggest(qty: int, ref: ReferenceData = REF, **kw) -> tuple[PlanResult, FakePlanner]:
    planner = FakePlanner()
    return suggest_vehicle(request(pallets(qty), vehicle="suggest", **kw), ref, planner), planner


def test_small_load_gets_the_rigid():
    result, _ = suggest(7)
    assert result.fits and result.vehicle_id == "RIGID"
    assert [(t.vehicle_id, t.fits) for t in result.tried] == [("RIGID", True)]


def test_30_pallets_get_the_bdouble():
    result, _ = suggest(30)
    assert result.fits and result.vehicle_id == "BDOUBLE"
    assert [t.vehicle_id for t in result.tried] == ["RIGID", "SEMI", "BDOUBLE"]
    assert [t.fits for t in result.tried] == [False, False, True]
    assert result.tried[0].reason == "22 pallets don't fit."
    assert result.tried[2].reason == ""


def test_nothing_fits_returns_the_largest():
    result, _ = suggest(100)
    assert not result.fits
    assert result.vehicle_id == "BDOUBLE"
    assert [t.vehicle_id for t in result.tried] == ["RIGID", "SEMI", "BDOUBLE"]
    assert not any(t.fits for t in result.tried)
    assert [w.code for w in result.warnings] == ["OVER_CAPACITY"]  # nothing added beyond the planner's


def test_configurable_and_route_restricted_vehicles_are_skipped():
    big = SEMI.model_copy(update={"id": "SUPER_B", "pallet_spaces": 200, "configurable": True})
    train = SEMI.model_copy(update={"id": "TRAIN", "pallet_spaces": 150, "route_restricted": True})
    result, planner = suggest(100, reference(SUPER_B=big, TRAIN=train))
    assert {c.vehicle_id for c in planner.calls} == {"RIGID", "SEMI", "BDOUBLE"}
    assert result.vehicle_id == "BDOUBLE"


def test_body_is_kept_only_where_allowed():
    _, planner = suggest(30, body="SKELETAL")
    assert [(c.vehicle_id, c.body_type) for c in planner.calls] == [
        ("RIGID", None), ("SEMI", "SKELETAL"), ("BDOUBLE", "SKELETAL")]


def test_run_plan_routes_suggest():
    result = run_plan(request(pallets(7), vehicle="suggest"), REF, FakePlanner())
    assert result.vehicle_id == "RIGID" and result.tried is not None


def test_no_candidates_is_an_error():
    configurable = SEMI.model_copy(update={"id": "X", "configurable": True})
    only = REF.model_copy(update={"vehicles": {"X": configurable}})
    with pytest.raises(ValueError):
        suggest(1, only)
