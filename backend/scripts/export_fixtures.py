"""
Write sample API responses for the frontend's component tests to frontend/src/__fixtures__/.

    cd backend && .venv/bin/python -m scripts.export_fixtures      (or: make fixtures)
    cd backend && .venv/bin/python -m scripts.export_fixtures fleet-real      (only these files)

The fixtures come from the real planner and reference data, so re-run this after changing either.
fleet-sample.json is hand-made (the contract the split page was first built against) and is never
written here; fleet-real.json is the real answer to a similar request.
"""

import json
import sys
from pathlib import Path

from app.planner.base import run_plan
from app.planner.fleet import plan_fleet
from app.planner.models import PlanRequest
from app.reference import load_reference

OUT = Path(__file__).resolve().parents[2] / "frontend" / "src" / "__fixtures__"


def pallet(qty, weight, *, id, type_id="AU_STD", height=1200, label="", **kw):
    return {"id": id, "label": label, "kind": "pallet", "type_id": type_id, "quantity": qty,
            "gross_weight_kg": weight, "height_mm": height, **kw}


def loose(qty, weight, length, width, height, *, id, label="", **kw):
    return {"id": id, "label": label, "kind": "loose", "length_mm": length, "width_mm": width,
            "quantity": qty, "gross_weight_kg": weight, "height_mm": height, **kw}


def container(type_id, weight, *, id, label=""):
    return {"id": id, "label": label, "kind": "container", "type_id": type_id, "quantity": 1,
            "gross_weight_kg": weight}


PLANS = {
    # Mixed pallet types and a stackable line: the everyday case.
    "plan-multidrop": {"vehicle_id": "SEMI_TRAILER", "items": [
        pallet(6, 820, id="bev", label="Beverages"),
        pallet(6, 410, id="dry", label="Dry goods", stackable=True, height=900),
        pallet(4, 600, id="euro", label="Euro imports", type_id="EURO"),
        pallet(5, 950, id="hw", label="Hardware"),
    ]},
    # A B-double's lead trailer fills first: its tri-axle goes over its limit.
    "plan-axle-overload": {"vehicle_id": "B_DOUBLE", "items": [
        pallet(14, 1300, id="steel", label="Steel"),
        pallet(8, 1300, id="cement", label="Cement"),
    ]},
    # One pallet too many, plus a reefer line on a tautliner.
    "plan-over-capacity": {"vehicle_id": "SEMI_TRAILER", "items": [
        pallet(20, 700, id="gen", label="General"),
        pallet(3, 500, id="chill", label="Chilled", temp_controlled=True),
    ]},
    # A container combination on a B-double.
    "plan-bdouble-containers": {"vehicle_id": "B_DOUBLE", "body_type": "SKELETAL", "items": [
        container("GP20", 12000, id="c20", label="MSKU 20'"),
        container("HC40", 20000, id="c40", label="TGHU 40' HC"),
    ]},
    # Dangerous goods: paint (Class 3) can't travel with pool chlorine (Class 5.1); acid (Class 8) can.
    "plan-dg-conflict": {"vehicle_id": "SEMI_TRAILER", "items": [
        pallet(4, 600, id="paint", label="Paint", dg={"dg_class": "3", "t92": []}),
        pallet(3, 450, id="chlorine", label="Pool chlorine", dg={"dg_class": "5.1", "t92": []}),
        pallet(2, 700, id="acid", label="Battery acid", dg={"dg_class": "8", "t92": []}),
        pallet(6, 500, id="gen", label="General freight"),
    ]},
    # Suggest the smallest vehicle.
    "plan-suggest": {"vehicle_id": "suggest", "items": [pallet(7, 500, id="p", label="Retail")]},
}


# POST /api/plan/fleet: the same {request, result} shape, the result a FleetResult.
FLEETS = {
    # Split across medium rigids: paint (Class 3) and pool chlorine (Class 5.1) can't share a truck,
    # the steel is heavy enough for the axle groups to matter, the cartons stack and the pipes are
    # loose items with their own size.
    "fleet-real": {"vehicle_id": "RIGID_MEDIUM", "items": [
        pallet(4, 450, id="paint", label="Paint", stackable=True, dg={"dg_class": "3", "t92": []}),
        pallet(3, 600, id="chlor", label="Pool chlorine", height=1100, dg={"dg_class": "5.1", "t92": []}),
        pallet(6, 1000, id="steel", label="Steel", height=600),
        pallet(6, 300, id="cartons", label="Cartons", height=800, stackable=True),
        loose(3, 250, 4500, 300, 300, id="pipes", label="Pipes"),
    ]},
}


def main(only: list[str]) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    ref = load_reference()

    def write(name: str, data: dict) -> bool:
        if only and name not in only:
            return False
        (OUT / f"{name}.json").write_text(json.dumps(data, indent=1) + "\n")
        return True

    write("reference", ref.model_dump(mode="json"))
    for name, body in PLANS.items():
        req = PlanRequest.model_validate(body)
        result = run_plan(req, load_reference(req.overrides) if req.overrides else ref)
        data = {"request": req.model_dump(mode="json", exclude_none=True),
                "result": result.model_dump(mode="json")}
        if write(name, data):
            print(f"{name}: fits={result.fits} warnings={[w.code for w in result.warnings]}")
    for name, body in FLEETS.items():
        if only and name not in only:
            continue
        req = PlanRequest.model_validate(body)
        result = plan_fleet(req, load_reference(req.overrides) if req.overrides else ref)
        # The solve time differs run to run: keep the file stable.
        result = result.model_copy(update={"solve_time_ms": 0.0})
        write(name, {"request": req.model_dump(mode="json", exclude_none=True),
                     "result": result.model_dump(mode="json")})
        print(f"{name}: fits={result.fits} trucks={result.num_trucks} bound={result.lower_bound} "
              f"{result.method} {result.status}")


if __name__ == "__main__":
    main(sys.argv[1:])
