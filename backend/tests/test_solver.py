"""OR-Tools packing (app.solver) and the demo endpoint (POST /api/solve)."""

import math
import random
import time

import pytest
from ortools.sat.python import cp_model

from app import dg as dgrules
from app.dg import DgInfo
from app.routers import demo
from app.solver import Capacity, Solution, Unit, solve

CLASSIC = [560, 490, 440, 370, 360, 340, 190, 150]


def unit(i: int, weight: float = 1.0, pallets: float = 0.0, dg: str | dict | None = None) -> Unit:
    """`dg`: a DG class ("3") or DgInfo fields."""
    info = DgInfo.model_validate({"dg_class": dg, "t92": []} if isinstance(dg, str) else dg) if dg else None
    return Unit(id=i, name=f"Item {i}", weight_kg=weight, pallets=pallets, dg=info)


def units_1d(weights) -> list[Unit]:
    return [unit(i, w) for i, w in enumerate(weights)]


def assert_valid(result: Solution, units: list[Unit], capacity: Capacity) -> None:
    """Every unit exactly once, every truck within every limit and segregated, never below the bound."""
    assert sorted(uid for load in result.loads for uid in load) == sorted(u.id for u in units)
    assert len(result.loads) >= result.lower_bound == max(result.lower_bounds.values())
    by_id = {u.id: u for u in units}
    for load in result.loads:
        if capacity.weight_kg is not None:
            assert sum(by_id[i].weight_kg for i in load) <= capacity.weight_kg + 1e-9
        if capacity.pallets is not None:
            assert sum(by_id[i].pallets for i in load) <= capacity.pallets + 1e-9
        on_load = [by_id[i].dg for i in load]
        assert not [c for c in dgrules.check_all(on_load) if c.status == "incompatible"]


# ---------------------------------------------------------------------------
# Solver
# ---------------------------------------------------------------------------

def test_classic_case_is_packed_optimally():
    # First-fit decreasing needs 4 trucks here; CP-SAT finds 3 (= the bound) and proves it.
    result = solve(units_1d(CLASSIC), Capacity(weight_kg=1000), 10)
    assert result.lower_bound == 3 and result.lower_bounds == {"weight": 3}
    assert len(result.loads) == 3 and result.optimal and result.status == "OPTIMAL"
    for load in result.loads:  # heaviest first inside a truck
        weights = [CLASSIC[i] for i in load]
        assert weights == sorted(weights, reverse=True)
    assert_valid(result, units_1d(CLASSIC), Capacity(weight_kg=1000))


def test_pallets_bind_when_weight_does_not():
    units = [unit(i, 50, pallets=p) for i, p in enumerate([3, 3, 2, 2, 2, 2, 1, 1])]
    capacity = Capacity(weight_kg=10_000, pallets=8)
    result = solve(units, capacity, 5)
    assert result.lower_bounds == {"weight": 1, "pallets": 2}
    assert len(result.loads) == 2 and result.optimal
    assert_valid(result, units, capacity)


def test_thirds_of_a_pallet_fit_one_truck():
    """Three units of 0.333 pallet share one 1-pallet truck (CP-SAT rounds sizes up, so this
    once came out infeasible)."""
    result = solve([unit(k, 1, pallets=0.333) for k in range(3)], Capacity(weight_kg=10, pallets=1), 5)
    assert len(result.loads) == 1


def test_float_capacity_fits_exactly():
    # 0.1 + 0.2 is 0.30000000000000004 in floats; still one truck.
    result = solve([unit(0, 1, pallets=0.1), unit(1, 1, pallets=0.2)], Capacity(weight_kg=10, pallets=0.3), 5)
    assert len(result.loads) == 1 and result.lower_bound == 1


def test_loose_freight_is_placed_under_a_pallet_limit():
    units = [unit(i, 10) for i in range(4)] + [unit(4, 10, pallets=1)]
    result = solve(units, Capacity(weight_kg=1000, pallets=1), 5)
    assert len(result.loads) == 1


@pytest.mark.parametrize("seed", range(5))
def test_random_instances_are_valid_and_never_below_the_bound(seed):
    rng = random.Random(100 + seed)
    units = [unit(i, rng.randint(20, 400), rng.choice([0, 0, 1, 2])) for i in range(rng.randint(10, 40))]
    capacity = rng.choice([Capacity(weight_kg=1000), Capacity(weight_kg=1500, pallets=4)])
    result = solve(units, capacity, 3)
    assert_valid(result, units, capacity)
    assert result.lower_bounds["weight"] == math.ceil(sum(u.weight_kg for u in units) / capacity.weight_kg)


def test_invalid_input_is_an_error():
    with pytest.raises(ValueError, match="no units"):
        solve([], Capacity(weight_kg=1000), 5)
    with pytest.raises(ValueError, match="capacity"):
        solve([unit(0)], Capacity(), 5)
    with pytest.raises(ValueError, match="'Item 1' can never fit a truck \\(weight, pallets\\)"):
        solve([unit(0, 300), unit(1, 1200, pallets=3)], Capacity(weight_kg=1000, pallets=2), 5)


def test_time_limit_is_honoured():
    rng = random.Random(7)
    units = [unit(i, rng.randint(201, 500)) for i in range(100)]
    start = time.perf_counter()
    result = solve(units, Capacity(weight_kg=1000), 1.0)
    assert time.perf_counter() - start < 6
    # On a busy machine CP-SAT may find nothing in 1 s: then its starting packing comes back.
    assert result.solve_time_ms < 2500 and result.status in ("OPTIMAL", "FEASIBLE", "UNKNOWN")
    assert_valid(result, units, Capacity(weight_kg=1000))


def test_no_cpsat_answer_returns_the_starting_packing(monkeypatch):
    monkeypatch.setattr(cp_model.CpSolver, "solve", lambda self, model: cp_model.UNKNOWN)
    result = solve(units_1d(CLASSIC), Capacity(weight_kg=1000), 5)
    assert result.status == "UNKNOWN" and not result.optimal
    assert len(result.loads) == 4  # first-fit decreasing
    assert_valid(result, units_1d(CLASSIC), Capacity(weight_kg=1000))


def test_unit_ids_are_reported_not_positions():
    units = [unit(10 + i, w) for i, w in enumerate([600, 500, 400])]
    result = solve(units, Capacity(weight_kg=1000), 5)
    assert sorted(uid for load in result.loads for uid in load) == [10, 11, 12]


# ---------------------------------------------------------------------------
# Dangerous goods segregation
# ---------------------------------------------------------------------------

def test_incompatible_goods_get_separate_trucks():
    # Everything fits one truck by weight, but Class 3 and Class 5.1 can't travel together.
    units = [unit(0, 10, dg="3"), unit(1, 10, dg="5.1"), unit(2, 10),
             unit(3, 10, dg="3"), unit(4, 10, dg="5.1")]
    capacity = Capacity(weight_kg=1000)
    result = solve(units, capacity, 5)
    assert_valid(result, units, capacity)
    assert result.lower_bound == 1 and len(result.loads) == 2 and result.status == "OPTIMAL"


def test_three_mutually_incompatible_classes_need_three_trucks():
    # 3 x 5.1, 5.1 x 4.2 and 3 x 4.2 are all "N" in Table 9.1.
    units = [unit(i, 5, dg=c) for i, c in enumerate(["3", "5.1", "4.2", "3", "5.1", "4.2"])]
    capacity = Capacity(weight_kg=1000)
    result = solve(units, capacity, 5)
    assert_valid(result, units, capacity)
    assert len(result.loads) == 3


def test_compatible_classes_and_exceptions_share_a_truck():
    units = [unit(0, 5, dg="3"), unit(1, 5, dg="8"), unit(2, 5, dg={"food": True}),
             unit(3, 5, dg={"dg_class": "2.1", "container": "aerosol"})]
    capacity = Capacity(weight_kg=1000)
    result = solve(units, capacity, 5)
    assert_valid(result, units, capacity)
    assert len(result.loads) == 2  # food can't go with Class 8 (exception 8), everything else can


def test_segregation_with_tight_weights_is_optimal():
    # First-fit decreasing needs 4 trucks here; CP-SAT finds 3 (= the weight bound).
    weights = [50, 20, 50, 50, 60, 20]
    classes = ["5.1", "3", "3", "5.1", None, "5.1"]
    units = [unit(i, w, dg=c) for i, (w, c) in enumerate(zip(weights, classes, strict=True))]
    capacity = Capacity(weight_kg=100)
    result = solve(units, capacity, 5)
    assert_valid(result, units, capacity)
    assert len(result.loads) == 3 and result.optimal


@pytest.mark.parametrize("seed", range(6))
def test_random_dg_packings_are_valid(seed):
    rng = random.Random(seed)
    classes = [None, None, "3", "5.1", "8", "6.1", {"food": True}, "2.1", "9"]
    units = [unit(i, rng.uniform(20, 400), rng.choice([0, 1]), dg=rng.choice(classes)) for i in range(25)]
    capacity = Capacity(weight_kg=1500, pallets=6)
    assert_valid(solve(units, capacity, 3), units, capacity)


# ---------------------------------------------------------------------------
# POST /api/solve
# ---------------------------------------------------------------------------

async def test_demo_endpoint_response(client):
    body = {"capacity": 1000, "shipments": [{"name": f"S{i}", "weight": w} for i, w in enumerate(CLASSIC)]}
    r = await client.post("/api/solve", json=body)
    assert r.status_code == 200, r.text
    data = r.json()
    assert set(data) == {"capacity", "total_weight", "total_pallets", "lower_bound", "lower_bounds",
                         "segregated", "num_trucks", "trucks", "solve_time_ms", "optimal", "status",
                         "time_limit_s", "drop_order"}
    assert data["capacity"] == 1000 and data["total_weight"] == sum(CLASSIC) and data["total_pallets"] == 0
    assert data["lower_bound"] == 3 and data["lower_bounds"] == {"weight": 3} and data["segregated"] is False
    assert data["num_trucks"] == 3 and data["optimal"] is True and data["status"] == "OPTIMAL"
    assert data["time_limit_s"] == 10.0
    assert data["drop_order"] == [s["id"] for t in data["trucks"] for s in t["shipments"]]
    truck = data["trucks"][0]
    assert set(truck) == {"truck", "shipments", "load", "empty", "fill_percent"}
    assert truck["truck"] == 1
    assert truck["shipments"][0] == {"id": 0, "name": "S0", "weight": 560, "dg_class": None, "subsidiary": []}
    for t in data["trucks"]:
        assert t["load"] == sum(s["weight"] for s in t["shipments"]) <= 1000
        assert t["empty"] == 1000 - t["load"]


async def test_demo_endpoint_validation(client):
    r = await client.post("/api/solve", json={"capacity": 100, "shipments": []})
    assert r.status_code == 400 and r.json()["detail"] == "Add at least one shipment."
    r = await client.post("/api/solve", json={"capacity": 100, "shipments": [{"name": "Big", "weight": 101}]})
    assert r.status_code == 400 and "'Big' (101 kg)" in r.json()["detail"]


async def test_demo_endpoint_pallets(client):
    # Light shipments: weight never binds, 8 pallet spaces per truck do.
    pallets = [3, 3, 2, 2, 2, 2, 1, 1]
    body = {"capacity": 10_000, "max_pallets": 8,
            "shipments": [{"name": f"P{i}", "weight": 50, "pallets": p} for i, p in enumerate(pallets)]}
    r = await client.post("/api/solve", json=body)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["max_pallets"] == 8 and data["total_pallets"] == 16
    assert data["lower_bound"] == 2 and data["lower_bounds"] == {"weight": 1, "pallets": 2}
    assert data["num_trucks"] == 2
    for t in data["trucks"]:
        assert sum(s["pallets"] for s in t["shipments"]) <= 8

    # Without a pallet limit the pallets ride along but don't constrain.
    body.pop("max_pallets")
    data = (await client.post("/api/solve", json=body)).json()
    assert "max_pallets" not in data and data["num_trucks"] == 1
    assert data["lower_bounds"] == {"weight": 1}
    assert data["trucks"][0]["shipments"][0]["pallets"] == 3


async def test_demo_endpoint_pallet_validation(client):
    body = {"capacity": 1000, "max_pallets": 4, "shipments": [{"name": "Huge", "weight": 10, "pallets": 5}]}
    r = await client.post("/api/solve", json=body)
    assert r.status_code == 400 and "'Huge' (5 pallets)" in r.json()["detail"]
    bad = {"capacity": 1000, "shipments": [{"name": "X", "weight": 1, "pallets": -1}]}
    r = await client.post("/api/solve", json=bad)
    assert r.status_code == 422


async def test_demo_endpoint_segregates_dg_classes(client):
    shipments = [{"name": "Thinners", "weight": 100, "dg_class": "3"},
                 {"name": "Chlorine", "weight": 100, "dg_class": "5.1"},
                 {"name": "Bricks", "weight": 100}]
    r = await client.post("/api/solve", json={"capacity": 1000, "shipments": shipments})
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["segregated"] is True and data["lower_bound"] == 1 and data["num_trucks"] == 2
    for truck in data["trucks"]:
        classes = {s["dg_class"] for s in truck["shipments"]}
        assert not {"3", "5.1"} <= classes


async def test_demo_endpoint_segregates_on_subsidiary_hazards(client):
    # 3 x 4.3 is fine, but the 8 subsidiary x 4.3 is not (Table 9.1).
    shipments = [{"name": "Acid thinners", "weight": 100, "dg_class": "3", "subsidiary": ["8"]},
                 {"name": "Calcium carbide", "weight": 100, "dg_class": "4.3"}]
    r = await client.post("/api/solve", json={"capacity": 1000, "shipments": shipments})
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["segregated"] is True and data["num_trucks"] == 2
    subs = {s["name"]: s["subsidiary"] for t in data["trucks"] for s in t["shipments"]}
    assert subs == {"Acid thinners": ["8"], "Calcium carbide": []}
    # Without the subsidiary they can share a truck.
    shipments[0]["subsidiary"] = []
    r = await client.post("/api/solve", json={"capacity": 1000, "shipments": shipments})
    assert r.json()["segregated"] is False and r.json()["num_trucks"] == 1


@pytest.mark.parametrize("shipment", [
    {"dg_class": "food", "subsidiary": ["8"]},
    {"dg_class": "fire_risk", "subsidiary": ["8"]},
    {"subsidiary": ["8"]},
    {"dg_class": "8", "subsidiary": ["8"]},
    {"dg_class": "3", "subsidiary": ["9"]},
    {"dg_class": "3", "subsidiary": ["2.1", "4.1", "5.1", "6.1", "8"]},
])
async def test_demo_endpoint_rejects_bad_subsidiary(client, shipment):
    r = await client.post("/api/solve", json={"capacity": 100, "shipments": [
        {"name": "X", "weight": 10, **shipment}]})
    assert r.status_code == 422, r.text


async def test_demo_endpoint_northline_rule_set(client):
    shipments = [{"name": "Matches", "weight": 10, "dg_class": "4.3"},
                 {"name": "Paint", "weight": 10, "dg_class": "3"}]
    r = await client.post("/api/solve", json={"capacity": 100, "shipments": shipments})
    assert r.status_code == 200
    body = {"capacity": 100, "shipments": shipments, "rule_set": "northline"}
    r = await client.post("/api/solve", json=body)
    assert r.status_code == 400 and "'Matches' (Class 4.3)" in r.json()["detail"]
    assert "Paint" not in r.json()["detail"]


@pytest.mark.parametrize("body", [
    {"capacity": 9 * 10**15, "shipments": [{"name": "A", "weight": 1}]},
    {"capacity": 1000, "shipments": [{"name": "A", "weight": 9 * 10**15}]},
])
async def test_demo_rejects_huge_numbers(client, body):
    r = await client.post("/api/solve", json=body)
    assert r.status_code == 422


async def test_demo_solve_is_capped(client):
    body = {"capacity": 100, "shipments": [{"name": "A", "weight": 60}, {"name": "B", "weight": 50}]}
    held = [demo._solve_slots.acquire(blocking=False) for _ in range(demo.MAX_CONCURRENT_SOLVES)]
    try:
        assert all(held)
        r = await client.post("/api/solve", json=body)
        assert r.status_code == 429 and "busy" in r.json()["detail"]
    finally:
        for _ in held:
            demo._solve_slots.release()
    r = await client.post("/api/solve", json=body)
    assert r.status_code == 200 and r.json()["num_trucks"] == 2


async def test_oversized_bodies_are_rejected(client):
    r = await client.post("/api/solve", content=b"x" * (2 * 1024 * 1024),
                          headers={"content-type": "application/json"})
    assert r.status_code == 413


async def test_health(client):
    r = await client.get("/api/health")
    assert r.status_code == 200 and r.json() == {"status": "ok"}
