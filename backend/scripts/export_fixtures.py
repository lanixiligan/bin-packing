"""
Write sample API responses for the frontend's component tests to frontend/src/__fixtures__/.

    cd backend && .venv/bin/python -m scripts.export_fixtures      (or: make fixtures)

The fixtures come from the real planner and reference data, so re-run this after changing either.
"""

import json
from pathlib import Path

from app.planner.base import run_plan
from app.planner.models import PlanRequest
from app.reference import load_reference

OUT = Path(__file__).resolve().parents[2] / "frontend" / "src" / "__fixtures__"


def pallet(qty, weight, *, id, type_id="AU_STD", height=1200, label="", **kw):
    return {"id": id, "label": label, "kind": "pallet", "type_id": type_id, "quantity": qty,
            "gross_weight_kg": weight, "height_mm": height, **kw}


def container(type_id, weight, *, id, label=""):
    return {"id": id, "label": label, "kind": "container", "type_id": type_id, "quantity": 1,
            "gross_weight_kg": weight}


PLANS = {
    # Three drops with mixed pallet types and a stackable line: the everyday case.
    "plan-multidrop": {"vehicle_id": "SEMI_TRAILER", "items": [
        pallet(6, 820, id="bev", label="Beverages", stop=3),
        pallet(6, 410, id="dry", label="Dry goods", stop=2, stackable=True, height=900),
        pallet(4, 600, id="euro", label="Euro imports", type_id="EURO", stop=2),
        pallet(5, 950, id="hw", label="Hardware", stop=1),
    ]},
    # Heavy freight at the rear: the trailer tri-axle goes over its limit.
    # Steel coil is over the default 1.5 t per-pallet cap, so the carrier's 2 t limit is an override.
    "plan-axle-overload": {"vehicle_id": "SEMI_TRAILER",
                           "overrides": {"pallet_defaults": {"max_gross_kg": 2000}}, "items": [
        pallet(12, 1800, id="steel", label="Steel coil", stop=1),
        pallet(10, 50, id="foam", label="Foam", stop=2),
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
    # Suggest the smallest vehicle.
    "plan-suggest": {"vehicle_id": "suggest", "items": [pallet(7, 500, id="p", label="Retail")]},
}


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    ref = load_reference()
    (OUT / "reference.json").write_text(json.dumps(ref.model_dump(mode="json"), indent=1) + "\n")
    for name, body in PLANS.items():
        req = PlanRequest.model_validate(body)
        result = run_plan(req, load_reference(req.overrides) if req.overrides else ref)
        data = {"request": req.model_dump(mode="json", exclude_none=True),
                "result": result.model_dump(mode="json")}
        (OUT / f"{name}.json").write_text(json.dumps(data, indent=1) + "\n")
        print(f"{name}: fits={result.fits} warnings={[w.code for w in result.warnings]}")


if __name__ == "__main__":
    main()
