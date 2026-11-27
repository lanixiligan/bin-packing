"""Multi-dimension packing (app.solver) and the 1D demo endpoint (POST /api/solve)."""

import random
import time

import pytest

from app import dg as dgrules
from app.dg import DgInfo
from app.schemas import Capacity, PackUnit, SolveResult, Usage
from app.solver import exceeded, pack, usage_of
from app.solver import multi as multi_mod
from app.solver.packing import ffd as ffd_1d
from app.solver.packing import solve_cpsat as cpsat_1d

CLASSIC = [560, 490, 440, 370, 360, 340, 190, 150]


def unit(i: int, weight: float = 1.0, volume: float = 0.0, pallets: float = 0.0,
         line: int | None = None, dg: str | dict | None = None) -> PackUnit:
    """`dg`: a DG class ("3") or DgInfo fields."""
    line = i if line is None else line
    info = DgInfo.model_validate({"dg_class": dg, "t92": []} if isinstance(dg, str) else dg) if dg else None
    return PackUnit(id=i, order_id=1, order_reference="ORD-000001", order_line_id=line,
                    item_name=f"Item {line}", item_sku=f"SKU-{line}",
                    weight_kg=weight, volume_m3=volume, pallets=pallets, dg=info)


def units_1d(weights) -> list[PackUnit]:
    return [unit(i, w) for i, w in enumerate(weights)]


def assert_valid(result: SolveResult, units: list[PackUnit], capacity: Capacity) -> None:
    """Every unit exactly once, every load within every capacity, never below the bound."""
    methods = [result.ffd] + ([result.ortools] if result.ortools else [])
    for m in methods:
        placed = sorted(uid for load in m.loads for uid in load.unit_ids)
        assert placed == sorted(u.id for u in units)
        assert sorted(m.drop_order) == placed
        assert m.num_loads == len(m.loads) >= result.lower_bound
        assert [load.number for load in m.loads] == list(range(1, m.num_loads + 1))
        by_id = {u.id: u for u in units}
        for load in m.loads:
            usage = usage_of(by_id[i] for i in load.unit_ids)
            assert load.usage == usage
            assert exceeded(usage, capacity) == []
            on_load = [by_id[i].dg for i in load.unit_ids]
            assert not [c for c in dgrules.check_all(on_load) if c.status == "incompatible"]
    if result.ortools:
        assert result.ortools.num_loads <= result.ffd.num_loads
    assert result.lower_bound == max(v for v in result.lower_bounds.model_dump().values() if v is not None)


def random_units(rng: random.Random, n: int) -> list[PackUnit]:
    return [unit(i, rng.uniform(20, 400), rng.uniform(0.1, 3.0), rng.choice([0, 0, 1, 2]))
            for i in range(n)]


# ---------------------------------------------------------------------------
# 1D regression (same answers as the original demo)
# ---------------------------------------------------------------------------

def test_classic_ffd_loses_to_cpsat():
    result = pack(units_1d(CLASSIC), Capacity(weight_kg=1000), 10)
    assert result.lower_bound == 3 and result.lower_bounds.weight == 3
    assert result.ffd.num_loads == 4 and not result.ffd.optimal and result.ffd.status == "HEURISTIC"
    assert result.ortools.num_loads == 3 and result.ortools.optimal
    assert result.recommended == "ortools"
    assert result.ffd.drop_order == list(range(8))  # already heaviest first
    assert [load.unit_ids for load in result.ffd.loads] == [[0, 2], [1, 3], [4, 5, 6], [7]]
    for load in result.ortools.loads:  # heaviest first inside a load
        weights = [CLASSIC[i] for i in load.unit_ids]
        assert weights == sorted(weights, reverse=True)
    assert result.lower_bounds.volume is None and result.lower_bounds.pallets is None
    assert_valid(result, units_1d(CLASSIC), Capacity(weight_kg=1000))


@pytest.mark.parametrize("seed", range(6))
def test_1d_matches_the_original_solver(seed):
    rng = random.Random(seed)
    capacity = rng.choice([500, 1000, 1500])
    weights = [rng.randint(1, capacity) for _ in range(rng.randint(5, 14))]
    shipments = [{"id": i, "name": f"S{i}", "weight": w} for i, w in enumerate(weights)]

    old_trucks, old_order, _ = ffd_1d(shipments, capacity)
    old_cp, old_optimal, _, _ = cpsat_1d(shipments, capacity, 10, hint=old_trucks)

    result = pack(units_1d(weights), Capacity(weight_kg=capacity), 10)
    assert [load.unit_ids for load in result.ffd.loads] == old_trucks
    assert result.ffd.drop_order == old_order
    assert result.lower_bound == -(-sum(weights) // capacity)
    assert old_optimal and result.ortools.optimal
    assert result.ortools.num_loads == len(old_cp)


async def test_demo_endpoint_response(client):
    body = {"capacity": 1000, "shipments": [{"name": f"S{i}", "weight": w} for i, w in enumerate(CLASSIC)]}
    r = await client.post("/api/solve", json=body)
    assert r.status_code == 200, r.text
    data = r.json()
    assert set(data) == {"capacity", "total_weight", "lower_bound", "segregated", "ffd", "ortools"}
    assert data["segregated"] is False
    assert data["capacity"] == 1000 and data["total_weight"] == sum(CLASSIC) and data["lower_bound"] == 3

    ffd = data["ffd"]
    assert set(ffd) == {"num_trucks", "trucks", "solve_time_ms", "hits_lower_bound", "drop_order"}
    assert ffd["num_trucks"] == 4 and ffd["hits_lower_bound"] is False
    assert ffd["drop_order"] == list(range(8))

    cp = data["ortools"]
    assert set(cp) == {"num_trucks", "trucks", "solve_time_ms", "optimal", "status", "time_limit_s",
                       "drop_order"}
    assert cp["num_trucks"] == 3 and cp["optimal"] is True and cp["status"] == "OPTIMAL"
    assert cp["time_limit_s"] == 10.0
    assert cp["drop_order"] == [s["id"] for t in cp["trucks"] for s in t["shipments"]]

    truck = ffd["trucks"][0]
    assert set(truck) == {"truck", "shipments", "load", "empty", "fill_percent"}
    assert truck == {
        "truck": 1,
        "shipments": [{"id": 0, "name": "S0", "weight": 560, "dg_class": None, "subsidiary": []},
                      {"id": 2, "name": "S2", "weight": 440, "dg_class": None, "subsidiary": []}],
        "load": 1000, "empty": 0, "fill_percent": 100.0,
    }
    for t in cp["trucks"]:
        assert t["load"] == sum(s["weight"] for s in t["shipments"]) <= 1000


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
    assert data["max_pallets"] == 8
    assert data["lower_bound"] == 2  # ceil(16 / 8)
    for method in ("ffd", "ortools"):
        for t in data[method]["trucks"]:
            assert sum(s["pallets"] for s in t["shipments"]) <= 8
    assert data["ortools"]["num_trucks"] == 2

    # Without a pallet limit the pallets ride along but don't constrain.
    body.pop("max_pallets")
    data = (await client.post("/api/solve", json=body)).json()
    assert "max_pallets" not in data and data["ortools"]["num_trucks"] == 1
    assert data["ffd"]["trucks"][0]["shipments"][0]["pallets"] == 3


async def test_demo_endpoint_pallet_validation(client):
    body = {"capacity": 1000, "max_pallets": 4, "shipments": [{"name": "Huge", "weight": 10, "pallets": 5}]}
    r = await client.post("/api/solve", json=body)
    assert r.status_code == 400 and "'Huge' (5 pallets)" in r.json()["detail"]
    bad = {"capacity": 1000, "shipments": [{"name": "X", "weight": 1, "pallets": -1}]}
    r = await client.post("/api/solve", json=bad)
    assert r.status_code == 422


# ---------------------------------------------------------------------------
# Multi-dimension behaviour
# ---------------------------------------------------------------------------

def test_volume_binds_when_weight_does_not():
    units = [unit(i, weight=100, volume=4) for i in range(6)]
    capacity = Capacity(weight_kg=1000, volume_m3=10)
    result = pack(units, capacity, 5)
    assert result.lower_bounds.weight == 1 and result.lower_bounds.volume == 3
    assert result.lower_bound == 3
    assert result.ffd.num_loads == 3 and result.ortools.num_loads == 3
    assert all(load.usage.volume_m3 <= 10 for load in result.ortools.loads)
    assert result.ffd.loads[0].fill_percent.volume == 80.0
    assert result.ffd.loads[0].fill_percent.weight == 20.0
    assert result.ffd.loads[0].fill_percent.pallets is None
    assert_valid(result, units, capacity)


def test_pallets_bind():
    units = [unit(i, weight=50, volume=0.2, pallets=1) for i in range(10)]
    capacity = Capacity(weight_kg=1000, volume_m3=20, pallets=4)
    result = pack(units, capacity, 5)
    assert result.lower_bounds.model_dump() == {"weight": 1, "volume": 1, "pallets": 3}
    assert result.ffd.num_loads == result.ortools.num_loads == 3
    assert max(load.usage.pallets for load in result.ffd.loads) == 4
    assert_valid(result, units, capacity)


def test_two_dimensions_cpsat_beats_ffd():
    sizes = [(550, 1.5), (450, 3), (250, 4), (250, 4), (750, 1.5), (200, 1.5), (550, 0.5), (650, 1),
             (350, 1.5)]
    units = [unit(i, weight=w, volume=v) for i, (w, v) in enumerate(sizes)]
    capacity = Capacity(weight_kg=1000, volume_m3=10)
    result = pack(units, capacity, 5)
    assert_valid(result, units, capacity)
    assert result.lower_bounds.weight == 4 and result.lower_bounds.volume == 2
    assert result.ffd.num_loads == 5 and not result.ffd.optimal
    assert result.ortools.num_loads == 4 and result.ortools.optimal and result.recommended == "ortools"


def test_unlimited_dimensions_are_ignored():
    units = [unit(i, weight=100, volume=500, pallets=50) for i in range(5)]
    capacity = Capacity(weight_kg=1000)
    result = pack(units, capacity, 5)
    assert result.lower_bounds.volume is None and result.lower_bounds.pallets is None
    assert result.ffd.num_loads == result.ortools.num_loads == 1
    fill = result.ffd.loads[0].fill_percent
    assert fill.weight == 50.0 and fill.volume is None and fill.pallets is None
    assert result.totals == Usage(weight_kg=500, volume_m3=2500, pallets=250)


def test_units_without_size_in_the_limited_dimensions_are_still_placed():
    units = [unit(i, weight=10, volume=0) for i in range(4)] + [unit(4, weight=10, volume=1)]
    capacity = Capacity(volume_m3=1)
    result = pack(units, capacity, 5)
    assert result.ffd.num_loads == result.ortools.num_loads == 1
    assert_valid(result, units, capacity)


@pytest.mark.parametrize("seed", range(5))
def test_random_instances_are_valid_and_never_below_the_bound(seed):
    rng = random.Random(100 + seed)
    units = random_units(rng, rng.randint(10, 40))
    capacity = rng.choice([
        Capacity(weight_kg=1000, volume_m3=8),
        Capacity(weight_kg=1500, pallets=4),
        Capacity(volume_m3=6.5, pallets=6),
        Capacity(weight_kg=900, volume_m3=7.5, pallets=5),
    ])
    result = pack(units, capacity, 3)
    assert_valid(result, units, capacity)
    dims = {"weight": "weight_kg", "volume": "volume_m3", "pallets": "pallets"}
    for dim, attr in dims.items():
        cap = getattr(capacity, attr)
        expected = None if cap is None else -int(-sum(getattr(u, attr) for u in units) // cap)
        if expected is not None:
            assert getattr(result.lower_bounds, dim) == max(expected, 0)
    assert result.ortools is not None
    assert result.recommended == "ortools"


def test_float_capacity_fits_exactly():
    units = [unit(i, weight=1, volume=0.1) for i in range(3)]
    capacity = Capacity(volume_m3=0.3)
    result = pack(units, capacity, 5)
    assert result.lower_bound == 1
    assert result.ffd.num_loads == 1 and result.ffd.optimal
    assert result.ortools.num_loads == 1 and result.ortools.optimal
    assert result.ffd.loads[0].fill_percent.volume == 100.0
    # 0.1 + 0.2 is 0.30000000000000004 in floats; still one load.
    units = [unit(0, volume=0.1), unit(1, volume=0.2)]
    assert pack(units, capacity, 5).ortools.num_loads == 1


def test_infeasible_unit_is_reported_clearly():
    units = [unit(0, weight=300), unit(1, weight=1200, volume=3), unit(2, weight=1200, volume=3, line=1)]
    with pytest.raises(ValueError) as exc:
        pack(units, Capacity(weight_kg=1000, volume_m3=2), 5)
    msg = str(exc.value)
    assert msg.startswith("1 item(s) can never fit the vehicle")  # once per order line
    assert "ORD-000001: Item 1 (SKU SKU-1) is too big for the vehicle" in msg
    assert "1200 kg > 1000 kg" in msg and "3 m³ > 2 m³" in msg


def test_no_units_or_no_capacity_is_an_error():
    with pytest.raises(ValueError, match="no units"):
        pack([], Capacity(weight_kg=1000), 5)
    with pytest.raises(ValueError, match="no capacity"):
        pack([unit(0)], Capacity(), 5)


def test_time_limit_is_honoured():
    rng = random.Random(7)
    units = [unit(i, rng.randint(201, 500)) for i in range(100)]
    start = time.perf_counter()
    result = pack(units, Capacity(weight_kg=1000), 1.0)
    wall = time.perf_counter() - start
    assert wall < 6
    if result.ortools is not None:
        assert result.ortools.solve_time_ms < 2500
        assert result.ortools.status in ("OPTIMAL", "FEASIBLE")
    assert result.time_limit_s == 1.0
    assert_valid(result, units, Capacity(weight_kg=1000))


def test_invalid_cpsat_answer_falls_back_to_ffd(monkeypatch):
    def broken(p, hint, lb, time_limit_s):
        return [list(range(len(p.units)))], "OPTIMAL", 0.01  # everything in one load: over capacity
    monkeypatch.setattr(multi_mod, "_cpsat", broken)
    result = pack(units_1d(CLASSIC), Capacity(weight_kg=1000), 5)
    assert result.ortools is None and result.recommended == "ffd"
    assert result.ffd.num_loads == 4


def test_unit_ids_are_reported_not_positions():
    units = [unit(10 + i, w) for i, w in enumerate([600, 500, 400])]
    result = pack(units, Capacity(weight_kg=1000), 5)
    assert sorted(uid for load in result.ortools.loads for uid in load.unit_ids) == [10, 11, 12]
    assert result.ffd.drop_order == [10, 11, 12]


# ---------------------------------------------------------------------------
# Dangerous goods segregation
# ---------------------------------------------------------------------------

def test_incompatible_goods_get_separate_loads():
    # Everything fits one load by weight, but Class 3 and Class 5.1 can't travel together.
    units = [unit(0, 10, dg="3"), unit(1, 10, dg="5.1"), unit(2, 10), unit(3, 10, dg="3"),
             unit(4, 10, dg="5.1")]
    capacity = Capacity(weight_kg=1000)
    result = pack(units, capacity, time_limit_s=5)
    assert_valid(result, units, capacity)
    assert result.lower_bound == 1
    assert result.ffd.num_loads == 2 and result.ortools.num_loads == 2
    assert result.ortools.status == "OPTIMAL"


def test_three_mutually_incompatible_classes_need_three_loads():
    # 3 x 5.1, 5.1 x 4.2 and 3 x 4.2 are all "N" in Table 9.1.
    units = [unit(i, 5, dg=c) for i, c in enumerate(["3", "5.1", "4.2", "3", "5.1", "4.2"])]
    capacity = Capacity(weight_kg=1000)
    result = pack(units, capacity, time_limit_s=5)
    assert_valid(result, units, capacity)
    assert result.ffd.num_loads == result.ortools.num_loads == 3


def test_compatible_classes_and_exceptions_share_a_load():
    units = [unit(0, 5, dg="3"), unit(1, 5, dg="8"), unit(2, 5, dg={"food": True}),
             unit(3, 5, dg={"dg_class": "2.1", "container": "aerosol"})]
    capacity = Capacity(weight_kg=1000)
    result = pack(units, capacity, time_limit_s=5)
    assert_valid(result, units, capacity)
    # Food can't go with Class 8 (exception 8), everything else can.
    assert result.ortools.num_loads == 2


def test_cpsat_beats_ffd_with_segregation():
    # FFD (largest first) needs 4 loads here; CP-SAT finds 3 (= the weight bound, so optimal).
    weights = [50, 20, 50, 50, 60, 20]
    classes = ["5.1", "3", "3", "5.1", None, "5.1"]
    units = [unit(i, w, dg=c) for i, (w, c) in enumerate(zip(weights, classes, strict=True))]
    capacity = Capacity(weight_kg=100)
    result = pack(units, capacity, time_limit_s=5)
    assert_valid(result, units, capacity)
    assert result.ffd.num_loads == 4
    assert result.ortools.num_loads == 3 and result.ortools.optimal
    assert result.recommended == "ortools"


@pytest.mark.parametrize("seed", range(6))
def test_random_dg_packings_are_valid(seed):
    rng = random.Random(seed)
    classes = [None, None, "3", "5.1", "8", "6.1", {"food": True}, "2.1", "9"]
    units = [unit(i, rng.uniform(20, 400), rng.uniform(0.1, 3.0), dg=rng.choice(classes))
             for i in range(25)]
    capacity = Capacity(weight_kg=1500, volume_m3=12)
    assert_valid(pack(units, capacity, time_limit_s=3), units, capacity)


async def test_demo_endpoint_segregates_dg_classes(client):
    shipments = [{"name": "Thinners", "weight": 100, "dg_class": "3"},
                 {"name": "Chlorine", "weight": 100, "dg_class": "5.1"},
                 {"name": "Bricks", "weight": 100}]
    r = await client.post("/api/solve", json={"capacity": 1000, "shipments": shipments})
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["segregated"] is True and data["lower_bound"] == 1
    assert data["ffd"]["num_trucks"] == data["ortools"]["num_trucks"] == 2
    for truck in data["ortools"]["trucks"]:
        classes = {s["dg_class"] for s in truck["shipments"]}
        assert not {"3", "5.1"} <= classes


async def test_demo_endpoint_segregates_on_subsidiary_hazards(client):
    # 3 x 4.3 is fine, but the 8 subsidiary x 4.3 is not (Table 9.1).
    shipments = [{"name": "Acid thinners", "weight": 100, "dg_class": "3", "subsidiary": ["8"]},
                 {"name": "Calcium carbide", "weight": 100, "dg_class": "4.3"}]
    r = await client.post("/api/solve", json={"capacity": 1000, "shipments": shipments})
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["segregated"] is True and data["ortools"]["num_trucks"] == 2
    subs = {s["name"]: s["subsidiary"] for t in data["ortools"]["trucks"] for s in t["shipments"]}
    assert subs == {"Acid thinners": ["8"], "Calcium carbide": []}
    # Without the subsidiary they can share a truck.
    shipments[0]["subsidiary"] = []
    r = await client.post("/api/solve", json={"capacity": 1000, "shipments": shipments})
    assert r.json()["segregated"] is False and r.json()["ortools"]["num_trucks"] == 1


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
    shipments = [{"name": "Matches", "weight": 10, "dg_class": "4.3"}, {"name": "Paint", "weight": 10,
                                                                         "dg_class": "3"}]
    r = await client.post("/api/solve", json={"capacity": 100, "shipments": shipments})
    assert r.status_code == 200
    r = await client.post("/api/solve", json={"capacity": 100, "shipments": shipments,
                                              "rule_set": "northline"})
    assert r.status_code == 400 and "'Matches' (Class 4.3)" in r.json()["detail"]
    assert "Paint" not in r.json()["detail"]
