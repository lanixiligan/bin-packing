"""Sized OR-Tools packing (app.solver) and the demo endpoint (POST /api/solve)."""

import random

import pytest
from ortools.sat.python import cp_model

from app import solver as solver_mod
from app.demo_models import SolveResponse
from app.dg import DgInfo
from app.routers import demo
from app.solver import DeckSpec, Item, Solution, Truck, pallet_key, solve

AU = (1165, 1165)
EURO = (1200, 800)
BODY = DeckSpec("body", "Body", 4800, 2400, 2700)          # RIGID_MEDIUM with a tautliner
RIGID = Truck(8000, (BODY,), "Medium rigid")
TINY = Truck(5000, (DeckSpec("body", "Body", 1200, 1200, 2700),), "Tiny")


def pallet(i: int, height: int = 1200, weight: int = 100, stackable: bool = False, kind: str = "AU_STD",
           dg: str | None = None) -> Item:
    length, width = {"AU_STD": AU, "EURO": EURO, "AU_TWIN": AU}[kind]
    info = DgInfo(dg_class=dg, t92=[]) if dg else None
    return Item(i, f"P{i}", weight, length, width, height, stackable, pallet_key(kind), info)


def loose(i: int, length: int, width: int, height: int = 500, weight: int = 100,
          stackable: bool = False) -> Item:
    return Item(i, f"L{i}", weight, length, width, height, stackable)


def check(result: Solution, items: list[Item], truck: Truck) -> None:
    """Re-run the solver's own geometric check and the bound."""
    group, conflicts = solver_mod._dg_groups(items)
    solver_mod._check(items, truck, result.trucks, group, conflicts)
    assert len(result.trucks) >= result.lower_bound == max(1, *result.lower_bounds.values())


# ---------------------------------------------------------------------------
# Solver
# ---------------------------------------------------------------------------

def test_items_that_never_fit_are_named():
    items = [loose(0, 6000, 400), pallet(1, height=2800), pallet(2, weight=9000), loose(3, 1000, 2500),
             pallet(4)]
    with pytest.raises(ValueError) as exc:
        solve(items, RIGID, 2)
    msg = str(exc.value)
    assert "'L0' is 6,000 mm long and the longest deck is 4,800 mm" in msg
    assert "'P1' is 2,800 mm tall and the inside height is 2,700 mm" in msg
    assert "'P2' weighs 9,000 kg and the payload is 8,000 kg" in msg
    assert "'L3'" not in msg   # 1,000 x 2,500 fits turned: 2,500 along the deck
    assert "'P4'" not in msg
    with pytest.raises(ValueError, match="'L1' is 2,500 mm wide and the widest deck is 2,400 mm"):
        solve([loose(1, 2500, 2500)], RIGID, 2)
    with pytest.raises(ValueError, match="no shipments"):
        solve([], RIGID, 2)


def test_rotation_lets_an_item_fit():
    # 2,000 along x by 3,000 across is wider than the deck; turned it is 3,000 x 2,000.
    result = solve([loose(0, 2000, 3000)], RIGID, 2)
    (p,), = result.trucks
    assert p.rotated and (p.length, p.width) == (3000, 2000) and p.x + p.length <= 4800
    assert result.optimal and result.status == "OPTIMAL"


def test_two_turned_items_share_a_deck():
    # Four 2,400 x 1,000 items fill a 4,000 x 2,400 deck only when all are turned (1,000 along x).
    items = [loose(i, 2400, 1000) for i in range(4)]
    truck = Truck(8000, (DeckSpec("body", "Body", 4000, 2400, 2700),))
    result = solve(items, truck, 3)
    assert len(result.trucks) == 1 and all(p.rotated for p in result.trucks[0])
    check(result, items, truck)


def test_stackable_pallets_of_one_type_stack():
    items = [pallet(0, 1200, weight=200, stackable=True), pallet(1, 1300, weight=300, stackable=True)]
    result = solve(items, TINY, 2)
    assert len(result.trucks) == 1 and result.optimal
    bottom, top = result.trucks[0]
    # Heaviest at the bottom; the top sits on it with the same footprint.
    assert (bottom.id, bottom.level, bottom.z, bottom.base) == (1, 0, 0, 1)
    assert (top.id, top.level, top.z, top.base) == (0, 1, 1300, 1)
    assert (top.x, top.y, top.length, top.width) == (bottom.x, bottom.y, bottom.length, bottom.width)
    check(result, items, TINY)


def test_columns_can_be_more_than_two_high():
    items = [pallet(i, 800, stackable=True) for i in range(3)]
    result = solve(items, TINY, 2)
    assert len(result.trucks) == 1
    assert [p.level for p in result.trucks[0]] == [0, 1, 2]
    assert [p.z for p in result.trucks[0]] == [0, 800, 1600]


@pytest.mark.parametrize("items", [
    [pallet(0, 1400, stackable=True), pallet(1, 1400, stackable=True)],      # 2,800 mm column
    [pallet(0, 1000, stackable=True), pallet(1, 1000, stackable=False)],     # one is not stackable
    [pallet(0, 1000, stackable=False), pallet(1, 1000, stackable=True)],
    [pallet(0, 1000, stackable=True), pallet(1, 1000, stackable=True, kind="AU_TWIN")],  # other type
    [pallet(0, 1000, stackable=True), pallet(1, 1000, stackable=True, kind="EURO")],
])
def test_pallets_that_must_not_stack_take_two_trucks(items):
    result = solve(items, TINY, 2)
    assert len(result.trucks) == 2
    assert all(p.level == 0 for load in result.trucks for p in load)
    check(result, items, TINY)


def test_loose_items_stack_on_the_same_footprint_either_way_round():
    items = [loose(0, 1000, 600, stackable=True), loose(1, 600, 1000, stackable=True)]
    result = solve(items, Truck(5000, (DeckSpec("body", "Body", 1000, 1000, 2700),)), 2)
    assert len(result.trucks) == 1
    bottom, top = result.trucks[0]
    assert top.level == 1 and top.rotated != bottom.rotated


def test_full_floor_forces_stacking():
    # 8 AU pallets fill a 4,800 x 2,400 floor; the 9th must go on top of one.
    items = [pallet(i, 1200, stackable=True) for i in range(9)]
    result = solve(items, RIGID, 5)
    assert len(result.trucks) == 1 and result.optimal
    levels = [p.level for p in result.trucks[0]]
    assert levels.count(0) <= 8 and set(levels) == {0, 1}
    check(result, items, RIGID)


def test_b_double_uses_both_decks():
    lead, rear = DeckSpec("lead", "Lead", 7400, 2480, 2700), DeckSpec("rear", "Rear", 13600, 2480, 2700)
    truck = Truck(42500, (lead, rear), "B-double")
    items = [pallet(i) for i in range(30)]     # 12 fit the lead deck, 22 the rear one
    result = solve(items, truck, 5)
    assert len(result.trucks) == 1
    assert {p.deck for p in result.trucks[0]} == {0, 1}
    check(result, items, truck)


def test_payload_binds():
    items = [pallet(i, weight=3000) for i in range(3)]
    result = solve(items, RIGID, 2)
    assert result.lower_bounds["weight"] == 2 and len(result.trucks) == 2 and result.optimal
    check(result, items, RIGID)


def test_incompatible_goods_get_separate_trucks():
    items = [pallet(0, dg="3"), pallet(1, dg="2.3"), pallet(2), pallet(3, dg="3")]
    result = solve(items, RIGID, 3)
    assert result.lower_bound == 1 and len(result.trucks) == 2
    check(result, items, RIGID)


def test_lower_bounds():
    items = [pallet(0, 1000, stackable=True), pallet(1, 2000), loose(2, 4000, 2000, 1000)]
    bounds = solver_mod.lower_bounds(items, RIGID)
    assert bounds == {"weight": 1, "volume": 1, "floor": 1}
    # Non-stackable floor: 9 AU pallets (12.2 m2) on 11.52 m2.
    assert solver_mod.lower_bounds([pallet(i) for i in range(9)], RIGID)["floor"] == 2
    assert solver_mod.lower_bounds([pallet(i, stackable=True) for i in range(9)], RIGID)["floor"] == 0


def test_no_cpsat_answer_returns_the_greedy_packing(monkeypatch):
    monkeypatch.setattr(cp_model.CpSolver, "solve", lambda self, model: cp_model.UNKNOWN)
    items = [pallet(i, 1200, stackable=True) for i in range(9)] + [loose(9, 3000, 400)]
    result = solve(items, RIGID, 2)
    assert result.status == "UNKNOWN"
    assert result.optimal == (len(result.trucks) == result.lower_bound)
    check(result, items, RIGID)


@pytest.mark.parametrize("items, truck, expected", [
    ([pallet(i, 1200, stackable=True) for i in range(9)], RIGID, 1),                    # must stack
    ([loose(i, 2400, 1000) for i in range(4)], Truck(8000, (DeckSpec("b", "B", 4000, 2400, 2700),)), 1),
    ([pallet(0, dg="3"), pallet(1, dg="2.3"), pallet(2), pallet(3, dg="3")], RIGID, 2),  # segregate
])
def test_cpsat_improves_on_a_poor_start(monkeypatch, items, truck, expected):
    """With one truck per item as the start, the answer must come from the CP-SAT model itself."""
    def one_each(items, truck, order, group, conflicts):
        return [solver_mod._Column(t, 0, 0, 0, items[i].length, items[i].width, [i], items[i].height)
                for t, i in enumerate(order)]
    monkeypatch.setattr(solver_mod, "_greedy", one_each)
    result = solve(items, truck, 5)
    assert result.status == "OPTIMAL" and len(result.trucks) == expected
    check(result, items, truck)


def test_floor_items_come_first():
    items = [pallet(i, 1000, stackable=True) for i in range(10)]
    result = solve(items, RIGID, 3)
    for load in result.trucks:
        levels = [p.level for p in load]
        assert levels == sorted(levels)


def _random_items(rng: random.Random, n: int) -> list[Item]:
    classes = [None] * 5 + ["3", "5.1", "8", "2.3"]
    out = []
    for i in range(n):
        dg = rng.choice(classes)
        info = DgInfo(dg_class=dg, t92=[]) if dg else None
        if rng.random() < 0.7:
            kind = rng.choice(["AU_STD", "EURO"])
            length, width = {"AU_STD": AU, "EURO": EURO}[kind]
            out.append(Item(i, f"S{i}", rng.randint(100, 1500), length, width, rng.randint(500, 1500),
                            rng.random() < 0.5, pallet_key(kind), info))
        else:
            out.append(Item(i, f"S{i}", rng.randint(50, 500), rng.choice([1500, 3000, 4500]),
                            rng.choice([300, 600, 1000]), rng.randint(200, 900), rng.random() < 0.3,
                            "", info))
    return out


@pytest.mark.parametrize("seed, size", [(s, (6, 14)) for s in range(5)] + [(s, (20, 25)) for s in (5, 6)])
def test_random_instances_are_valid_and_never_below_the_bound(seed, size):
    rng = random.Random(seed)
    truck = rng.choice([RIGID, Truck(42500, (DeckSpec("lead", "Lead", 7400, 2480, 2700),
                                             DeckSpec("rear", "Rear", 13600, 2480, 2700)))])
    items = _random_items(rng, rng.randint(*size))
    result = solve(items, truck, 1)
    check(result, items, truck)
    assert result.status in ("OPTIMAL", "FEASIBLE", "UNKNOWN")


# ---------------------------------------------------------------------------
# POST /api/solve
# ---------------------------------------------------------------------------

def body(*shipments: dict, **extra) -> dict:
    return {"shipments": list(shipments), **extra}


def ship(name: str, weight: int = 100, height_mm: int = 1200, **kw) -> dict:
    return {"name": name, "weight": weight, "height_mm": height_mm, **kw}


async def test_demo_endpoint_response(client):
    shipments = [ship("Paint 01", 420, dg_class="3", stackable=True),
                 ship("Paint 02", 400, dg_class="3", stackable=True),
                 ship("Pipes 03", 250, 300, kind="loose", length_mm=4600, width_mm=400),
                 ship("Glass 04", 300, 1600, pallet_type="EURO"),
                 ship("Acid 05", 300, 1400, dg_class="8", subsidiary=["6.1"]),
                 ship("Rice 06", 400, 1000, pallet_type="EURO", dg_class="food")]
    r = await client.post("/api/solve", json=body(*shipments))
    assert r.status_code == 200, r.text
    data = SolveResponse.model_validate(r.json()).model_dump()
    assert r.json() == SolveResponse.model_validate(r.json()).model_dump(mode="json")
    assert data["vehicle_id"] == "RIGID_MEDIUM" and data["vehicle_name"] == "Medium rigid (8 t)"
    assert data["body_type"] == "TAUTLINER"
    cap = data["capacity"]
    assert cap["weight_kg"] == 8000 and cap["floor_m2"] == 11.52 and cap["volume_m3"] == 31.1
    assert cap["decks"] == [{"id": "body", "name": "Body", "length_mm": 4800, "width_mm": 2400,
                             "height_mm": 2700}]
    assert data["total_weight"] == 2070
    assert data["segregated"] is True and data["num_trucks"] == 2 and data["lower_bound"] == 1
    assert set(data["lower_bounds"]) == {"weight", "volume", "floor"}
    assert data["time_limit_s"] == 10.0 and data["status"] == "OPTIMAL" and data["optimal"]
    assert data["drop_order"] == [s["id"] for t in data["trucks"] for s in t["shipments"]]
    assert sorted(data["drop_order"]) == list(range(6))
    for number, t in enumerate(data["trucks"], start=1):
        assert t["truck"] == number
        assert t["load"] == sum(s["weight"] for s in t["shipments"]) and t["empty"] == 8000 - t["load"]
        floor = sum(s["placement"]["length_mm"] * s["placement"]["width_mm"]
                    for s in t["shipments"] if s["placement"]["level"] == 0)
        assert t["floor_used_m2"] == round(floor / 1e6, 2)
        assert t["max_height_mm"] == max(s["placement"]["z_mm"] + s["height_mm"] for s in t["shipments"])
        levels = [s["placement"]["level"] for s in t["shipments"]]
        assert levels == sorted(levels)
    out = {s["name"]: s for t in data["trucks"] for s in t["shipments"]}
    assert out["Paint 01"]["pallet_type"] == "AU_STD" and out["Paint 01"]["length_mm"] == 1165
    assert out["Glass 04"]["length_mm"] == 1200 and out["Glass 04"]["width_mm"] == 800
    assert out["Pipes 03"]["pallet_type"] is None and out["Pipes 03"]["kind"] == "loose"
    assert out["Acid 05"]["subsidiary"] == ["6.1"]
    # Food and Class 8 never share a truck.
    truck_of = {s["name"]: t["truck"] for t in data["trucks"] for s in t["shipments"]}
    assert truck_of["Rice 06"] != truck_of["Acid 05"]


async def test_demo_endpoint_names_items_that_never_fit(client):
    r = await client.post("/api/solve", json=body(
        ship("Pipes 04", 200, 300, kind="loose", length_mm=6000, width_mm=400), ship("Ok")))
    assert r.status_code == 400
    assert "'Pipes 04' is 6,000 mm long and the longest deck is 4,800 mm" in r.json()["detail"]
    assert "Ok" not in r.json()["detail"]


async def test_demo_endpoint_stacks_when_the_floor_is_full(client):
    pallets = [ship(f"P{i}", stackable=True) for i in range(9)]
    data = (await client.post("/api/solve", json=body(*pallets))).json()
    assert data["num_trucks"] == 1
    top = [s["placement"] for s in data["trucks"][0]["shipments"] if s["placement"]["level"] == 1]
    assert top and all(p["z_mm"] == 1200 for p in top)
    by_id = {s["id"]: s["placement"] for s in data["trucks"][0]["shipments"]}
    for p in top:
        base = by_id[p["stack_base"]]
        assert base["level"] == 0 and (base["x_mm"], base["y_mm"]) == (p["x_mm"], p["y_mm"])
    assert data["trucks"][0]["max_height_mm"] == 2400
    # Too tall to stack under 2,700 mm: two trucks.
    pallets = [ship(f"P{i}", height_mm=1400, stackable=True) for i in range(9)]
    data = (await client.post("/api/solve", json=body(*pallets))).json()
    assert data["num_trucks"] == 2


async def test_demo_endpoint_b_double_uses_both_decks(client):
    pallets = [ship(f"P{i}") for i in range(30)]
    r = await client.post("/api/solve", json=body(*pallets, vehicle_id="B_DOUBLE"))
    assert r.status_code == 200, r.text
    data = r.json()
    assert [d["id"] for d in data["capacity"]["decks"]] == ["lead", "rear"]
    assert data["num_trucks"] == 1
    assert {s["placement"]["deck_id"] for s in data["trucks"][0]["shipments"]} == {"lead", "rear"}


async def test_demo_endpoint_segregates_dg_classes(client):
    r = await client.post("/api/solve", json=body(ship("Thinners", dg_class="3"),
                                                  ship("Chlorine gas", dg_class="2.3"), ship("Bricks")))
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["segregated"] is True and data["lower_bound"] == 1 and data["num_trucks"] == 2
    for t in data["trucks"]:
        assert not {"3", "2.3"} <= {s["dg_class"] for s in t["shipments"]}


async def test_demo_endpoint_payload_binds(client):
    r = await client.post("/api/solve", json=body(*[ship(f"Steel {i}", 3000) for i in range(3)]))
    data = r.json()
    assert data["lower_bounds"]["weight"] == 2 and data["num_trucks"] == 2
    assert all(t["load"] <= 8000 for t in data["trucks"])


async def test_demo_endpoint_flat_top_height(client):
    # No roof: inside height is the 4,300 mm height limit less the 1,100 mm deck height.
    r = await client.post("/api/solve", json=body(ship("Tall", height_mm=3000), body_type="FLAT_TOP"))
    assert r.status_code == 200, r.text
    assert r.json()["capacity"]["decks"][0]["height_mm"] == 3200


@pytest.mark.parametrize("extra, message", [
    ({"vehicle_id": "SPACESHIP"}, "Unknown vehicle 'SPACESHIP'"),
    ({"body_type": "HOVERCRAFT"}, "Unknown body type 'HOVERCRAFT'"),
    ({"body_type": "DROP_DECK"}, "can't have"),
    ({"vehicle_id": "SEMI_TRAILER", "body_type": "SKELETAL"}, "doesn't carry pallets"),
])
async def test_demo_endpoint_rejects_bad_vehicles(client, extra, message):
    r = await client.post("/api/solve", json=body(ship("A"), **extra))
    assert r.status_code == 400 and message in r.json()["detail"]


async def test_demo_endpoint_rejects_unknown_pallets(client):
    r = await client.post("/api/solve", json=body(ship("A", pallet_type="MOON")))
    assert r.status_code == 400 and "'MOON'" in r.json()["detail"]


async def test_demo_endpoint_validation(client):
    r = await client.post("/api/solve", json=body())
    assert r.status_code == 400 and r.json()["detail"] == "Add at least one shipment."
    for bad in [ship("A", kind="loose"), ship("A", length_mm=100, width_mm=100),
                ship("A", kind="loose", length_mm=100, width_mm=100, pallet_type="EURO"),
                ship("A", weight=0), ship("A", dg_class="3", subsidiary=["3"])]:
        r = await client.post("/api/solve", json=body(bad))
        assert r.status_code == 422, bad
    r = await client.post("/api/solve", json=body(*[ship(f"S{i}") for i in range(41)]))
    assert r.status_code == 422


async def test_demo_endpoint_northline_rule_set(client):
    shipments = [ship("Matches", dg_class="4.3"), ship("Paint", dg_class="3")]
    # ADG + Northline is the default; the ADG Code alone accepts Class 4.3.
    r = await client.post("/api/solve", json=body(*shipments))
    assert r.status_code == 400 and "'Matches' (Class 4.3)" in r.json()["detail"]
    assert "Paint" not in r.json()["detail"]
    r = await client.post("/api/solve", json=body(*shipments, rule_set="adg"))
    assert r.status_code == 200


async def test_demo_solve_is_capped(client):
    payload = body(ship("A", 5000), ship("B", 4000))
    held = [demo._solve_slots.acquire(blocking=False) for _ in range(demo.MAX_CONCURRENT_SOLVES)]
    try:
        assert all(held)
        r = await client.post("/api/solve", json=payload)
        assert r.status_code == 429 and "busy" in r.json()["detail"]
    finally:
        for _ in held:
            demo._solve_slots.release()
    r = await client.post("/api/solve", json=payload)
    assert r.status_code == 200 and r.json()["num_trucks"] == 2


async def test_oversized_bodies_are_rejected(client):
    r = await client.post("/api/solve", content=b"x" * (2 * 1024 * 1024),
                          headers={"content-type": "application/json"})
    assert r.status_code == 413


async def test_health(client):
    r = await client.get("/api/health")
    assert r.status_code == 200 and r.json() == {"status": "ok"}
