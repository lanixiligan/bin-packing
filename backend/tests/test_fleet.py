"""Split across trucks: app/planner/fleet.py (with tests/factories.py vehicles) and POST /api/plan/fleet
(with the real reference data)."""

import itertools
import json
import time
from pathlib import Path

import pytest

from app import solve_slots
from app.planner import fleet
from app.planner.fleet import plan_fleet
from app.planner.heuristic import HeuristicPlanner, expand_units
from app.planner.models import FleetResult, FreightItem, PlanRequest, PlanResult
from app.reference.schemas import VehicleConfig
from tests.factories import RIGID, SEMI, containers, loose, pallets, reference, request

# RIGID with a weaker rear axle: the steer may add 2,800 kg and the rear 4,700 kg, so the axle groups
# (7,500 kg of freight between them) bind before the 8,000 kg payload.
TIGHT = RIGID.model_copy(update={
    "id": "TIGHT", "name": "Tight rigid",
    "axle_groups": [g if g.id != "rear" else g.model_copy(update={"gml_kg": 7000.0})
                    for g in RIGID.axle_groups]})
REF = reference(TIGHT=TIGHT)
SAMPLE = Path(__file__).resolve().parents[2] / "frontend" / "src" / "__fixtures__" / "fleet-sample.json"


def dg(item: FreightItem, dg_class: str) -> FreightItem:
    return FreightItem.model_validate({**item.model_dump(), "dg": {"dg_class": dg_class, "t92": []}})


def split(*items: FreightItem, vehicle: str = "RIGID", time_limit_s: float = 5.0, **kw) -> FleetResult:
    return plan_fleet(request(*items, vehicle=vehicle, **kw), REF, time_limit_s)


def check_fleet(result: FleetResult, *items: FreightItem, vehicle: VehicleConfig) -> None:
    """Every unit is in exactly one truck (or unplaced), and every truck is a legal single-truck plan."""
    wanted = [u.unit_id for u in expand_units(list(items))]
    placed = [p.unit_id for t in result.trucks for p in t.placements]
    assert sorted(placed + result.unplaced) == sorted(wanted)
    assert len(set(placed)) == len(placed)
    assert result.num_trucks == len(result.trucks)
    assert result.lower_bound == max(result.lower_bounds.values())
    assert set(result.lower_bounds) == {"weight", "floor", "volume"}
    assert result.num_trucks >= result.lower_bound or not result.trucks
    for truck in result.trucks:
        PlanResult.model_validate(truck.model_dump())
        assert truck.fits and truck.unplaced == [] and truck.placements, truck.reasons
        assert (truck.vehicle_id, truck.body_type) == (result.vehicle_id, result.body_type)
        assert truck.total_weight_kg <= vehicle.max_payload_kg + 1e-6
        assert all(a.load_kg <= a.limit_kg + 1e-6 for a in truck.axle_loads), truck.axle_loads
        assert truck.utilisation.pallet_spaces.used <= vehicle.pallet_spaces
        assert "DG_INCOMPATIBLE" not in [w.code for w in truck.warnings]
        for p in truck.placements:
            deck = vehicle.deck(p.deck_id)
            assert deck.cargo and 0 <= p.x_mm and p.x_mm + p.length_mm <= deck.length_mm, p.unit_id
            assert 0 <= p.y_mm and p.y_mm + p.width_mm <= deck.width_mm and p.z_mm >= 0, p.unit_id
        for a, b in itertools.combinations(truck.placements, 2):
            apart = (a.deck_id != b.deck_id
                     or a.x_mm >= b.x_mm + b.length_mm or b.x_mm >= a.x_mm + a.length_mm
                     or a.y_mm >= b.y_mm + b.width_mm or b.y_mm >= a.y_mm + a.width_mm
                     or a.z_mm >= b.z_mm + b.height_mm or b.z_mm >= a.z_mm + a.height_mm)
            assert apart, f"{a.unit_id} overlaps {b.unit_id}"
        stacks: dict[int, list] = {}
        for p in truck.placements:
            stacks.setdefault(p.stack_id, []).append(p)
        for members in stacks.values():   # one floor position per stack, levels 0, 1, ... bottom up
            assert len({(p.deck_id, p.x_mm, p.y_mm, p.length_mm, p.width_mm) for p in members}) == 1
            members.sort(key=lambda p: p.stack_level)
            assert [p.stack_level for p in members] == list(range(len(members)))
            assert [p.z_mm for p in members] == [sum(q.height_mm for q in members[:k])
                                                 for k in range(len(members))]
            assert len(members) == 1 or all(p.stackable for p in members)


# ---------------------------------------------------------------------------
# Exact path
# ---------------------------------------------------------------------------

def test_one_truck_when_everything_fits():
    items = [pallets(6, 500)]
    result = split(*items)
    assert result.fits and result.reasons == [] and result.num_trucks == 1 and result.unplaced == []
    assert (result.method, result.status, result.optimal) == ("exact", "OPTIMAL", True)
    assert result.planner == "fleet"
    assert (result.vehicle_id, result.vehicle_name, result.body_type, result.mass_scheme) \
        == ("RIGID", "Rigid 8 t", "TAUTLINER", "GML")
    assert result.lower_bounds == {"weight": 1, "floor": 1, "volume": 1}
    assert [p.unit_id for p in result.trucks[0].placements] == [f"P#{n}" for n in range(1, 7)]
    check_fleet(result, *items, vehicle=RIGID)


def test_dangerous_goods_force_two_trucks():
    items = [dg(pallets(4, 450, id="paint"), "3"), dg(pallets(3, 600, id="chlor"), "5.1"),
             pallets(6, 700, id="gen")]
    result = split(*items, vehicle="SEMI")
    assert result.fits and result.num_trucks == 2
    assert result.lower_bound == 1 and result.optimal and result.status == "OPTIMAL"   # proven by CP-SAT
    check_fleet(result, *items, vehicle=SEMI)
    on_board = []
    for truck in result.trucks:
        ids = {p.item_id for p in truck.placements}
        assert not {"paint", "chlor"} <= ids
        on_board += [w.message for w in truck.warnings if w.code == "DG_ON_BOARD"]
        assert all(set(w.item_ids) <= ids for w in truck.warnings)   # warnings scoped to the truck's items
    assert sorted(on_board) == ["This load carries dangerous goods (Class 3).",
                                "This load carries dangerous goods (Class 5.1)."]


def test_payload_forces_trucks():
    items = [pallets(12, 1400)]   # 16.8 t on an 8 t payload
    result = split(*items)
    assert result.fits and result.num_trucks == 3 == result.lower_bounds["weight"] and result.optimal
    check_fleet(result, *items, vehicle=RIGID)


def test_axle_limits_force_more_trucks_than_the_weight_bound():
    """Dense freight on a rigid whose axle groups bind before the payload: 7.6 t would be one truck by
    weight and floor, but the axles can only add 7.5 t."""
    items = [pallets(8, 950, id="steel", height=600)]
    single = HeuristicPlanner().plan(request(*items, vehicle="TIGHT"), REF)
    assert "AXLE_OVER_LIMIT" in [w.code for w in single.warnings]   # why one truck doesn't do
    result = split(*items, vehicle="TIGHT")
    assert result.fits and result.num_trucks == 2
    assert result.lower_bounds["weight"] == 1 and result.lower_bound == 1
    assert result.optimal and result.status == "OPTIMAL"
    check_fleet(result, *items, vehicle=TIGHT)
    for truck in result.trucks:
        assert [a.status for a in truck.axle_loads if a.status == "over"] == []
        assert "AXLE_OVER_LIMIT" not in [w.code for w in truck.warnings]


def test_weights_that_are_not_whole_kg_stay_within_the_axle_limits():
    items = [pallets(8, 937.5, id="steel"), loose(1, 4800, 400, 310.4, id="beam")]
    result = split(*items, vehicle="TIGHT")
    assert result.fits and result.num_trucks == 2
    check_fleet(result, *items, vehicle=TIGHT)
    assert sum(t.total_weight_kg for t in result.trucks) == pytest.approx(8 * 937.5 + 310.4)


def test_loose_items_are_packed_with_pallets():
    items = [pallets(4, 500), loose(2, 4000, 600, 300, id="pipe"),
             loose(3, 2000, 1000, 250, id="crate", stackable=True, height=500)]
    result = split(*items)
    assert result.fits and result.unplaced == []
    check_fleet(result, *items, vehicle=RIGID)
    placed = [p for t in result.trucks for p in t.placements]
    pipes = [p for p in placed if p.item_id == "pipe"]
    assert len(pipes) == 2 and all((p.kind, p.type_id) == ("loose", "LOOSE") for p in pipes)
    assert all(sorted((p.length_mm, p.width_mm)) == [600, 4000] for p in pipes)
    assert all(p.rotated == (p.length_mm == 600) for p in pipes)
    assert {p.kind for p in placed} == {"pallet", "loose"}


def test_stacking_follows_the_planner_rules():
    """Stackable pallets of one type stack up to the 1.8 m cap: 16 x 900 mm on 8 floor positions."""
    items = [pallets(16, 400, height=900, stackable=True)]
    result = split(*items)
    assert result.fits and result.num_trucks == 1
    check_fleet(result, *items, vehicle=RIGID)
    assert sorted(p.stack_level for p in result.trucks[0].placements) == [0] * 8 + [1] * 8
    # 1,000 mm each: two would be 2.0 m, over the cap, so nothing stacks and the floor decides.
    tall = [pallets(16, 400, height=1000, stackable=True)]
    result = split(*tall)
    assert result.num_trucks == 2 and all(p.stack_level == 0 for t in result.trucks for p in t.placements)
    check_fleet(result, *tall, vehicle=RIGID)


def test_units_no_truck_can_take_are_unplaced_and_the_rest_packed():
    items = [loose(1, 6000, 400, id="pipe"), pallets(3, 500), pallets(2, 400, id="tall", height=2000),
             pallets(1, 500, id="odd", type_id="MOON")]
    result = split(*items)
    assert not result.fits
    assert result.unplaced == ["pipe#1", "tall#1", "tall#2", "odd#1"]
    assert len(result.reasons) == 3
    assert any('"pipe" is 6.0 m long' in r for r in result.reasons)
    assert any('"tall" is 2.0 m tall' in r for r in result.reasons)
    assert any("unknown pallet type 'MOON'" in r for r in result.reasons)
    assert result.num_trucks == 1 and result.trucks[0].fits
    assert [p.unit_id for p in result.trucks[0].placements] == ["P#1", "P#2", "P#3"]
    check_fleet(result, *items, vehicle=RIGID)


def test_a_unit_that_overloads_an_axle_on_its_own_is_unplaced():
    items = [loose(1, 4800, 2000, 7000, id="press"), pallets(2, 500)]
    result = split(*items, vehicle="TIGHT")
    assert result.unplaced == ["press#1"] and not result.fits
    assert result.reasons == [
        "'press' weighs 7,000 kg and would overload the Rear single wherever it stands."]
    assert result.num_trucks == 1
    heavy = split(loose(1, 2000, 1000, 9000, id="block"), vehicle="TIGHT")
    assert heavy.unplaced == ["block#1"] and heavy.trucks == [] and heavy.num_trucks == 0
    assert heavy.reasons == ['Item "block" weighs 9.0 t; the Tight rigid can carry 8.0 t.']
    assert (heavy.lower_bound, heavy.optimal) == (0, False)


def test_a_body_that_cant_carry_the_freight_packs_nothing():
    items = [pallets(3)]
    result = split(*items, vehicle="SEMI", body="SKELETAL")
    assert not result.fits and result.trucks == [] and result.unplaced == ["P#1", "P#2", "P#3"]
    assert result.reasons == ["Pallets can't go on a skeletal body."]


def test_goods_the_carrier_refuses_are_packed_but_the_fleet_does_not_fit():
    items = [dg(pallets(2, 300, id="matches"), "4.3"), pallets(2, 500)]
    result = split(*items)   # rule_set "northline" by default
    assert not result.fits and result.unplaced == [] and result.num_trucks == 1
    assert any("4.3" in r for r in result.reasons)
    adg = split(*items, rule_set="adg")
    assert adg.fits and adg.reasons == []


def test_containers_and_suggest_are_refused():
    with pytest.raises(ValueError, match="not containers"):
        plan_fleet(request(containers("GP20"), vehicle="SEMI", body="SKELETAL"), REF)
    with pytest.raises(ValueError, match="Unknown vehicle 'suggest'"):
        plan_fleet(request(pallets(1), vehicle="suggest"), REF)
    with pytest.raises(ValueError, match="Unknown body type"):
        plan_fleet(PlanRequest(items=[pallets(1)], vehicle_id="SEMI", body_type="HOVERCRAFT"), REF)


# ---------------------------------------------------------------------------
# Heuristic path
# ---------------------------------------------------------------------------

def test_two_hundred_units_take_the_heuristic_path():
    items = [pallets(120, 600, id="A"), pallets(60, 900, id="B", height=900, stackable=True),
             pallets(20, 300, id="C", type_id="EURO")]
    start = time.perf_counter()
    result = split(*items, vehicle="SEMI")
    assert time.perf_counter() - start < 5
    assert (result.method, result.status) == ("heuristic", "HEURISTIC")
    assert result.fits and result.unplaced == [] and all(t.fits for t in result.trucks)
    assert result.lower_bounds == {"weight": 6, "floor": 7, "volume": 5}   # 132 t, 140 unstackable
    assert result.num_trucks >= result.lower_bound == 7
    assert result.num_trucks <= result.lower_bound + 2
    assert result.optimal == (result.num_trucks == result.lower_bound)
    check_fleet(result, *items, vehicle=SEMI)


def test_the_exact_limit_decides_the_path(monkeypatch):
    monkeypatch.setattr(fleet, "EXACT_LIMIT", 10)
    assert split(pallets(10)).method == "exact"
    result = split(pallets(11))
    assert (result.method, result.status) == ("heuristic", "HEURISTIC")
    assert result.num_trucks == 2 == result.lower_bound and result.optimal   # equal to the bound
    assert fleet.EXACT_LIMIT == 10


@pytest.fixture
def heuristic_only(monkeypatch):
    monkeypatch.setattr(fleet, "EXACT_LIMIT", 0)


def test_heuristic_splits_dangerous_goods(heuristic_only):
    items = [dg(pallets(4, 450, id="paint"), "3"), dg(pallets(3, 600, id="chlor"), "5.1"),
             dg(pallets(2, 500, id="acid"), "8"), pallets(20, 700, id="gen")]
    result = split(*items, vehicle="SEMI")
    assert result.method == "heuristic" and result.fits
    assert result.num_trucks == 2
    check_fleet(result, *items, vehicle=SEMI)
    for truck in result.trucks:
        assert not {"paint", "chlor"} <= {p.item_id for p in truck.placements}


def test_heuristic_sends_units_back_until_the_payload_fits(heuristic_only):
    items = [pallets(12, 1400, id="heavy"), pallets(6, 200, id="light")]
    result = split(*items)
    assert result.fits and result.lower_bounds["weight"] == 3
    assert 3 <= result.num_trucks <= 4
    check_fleet(result, *items, vehicle=RIGID)


def test_heuristic_sends_units_back_until_the_axles_fit(heuristic_only):
    items = [pallets(8, 950, id="steel", height=600)]
    result = split(*items, vehicle="TIGHT")
    assert result.fits and result.num_trucks == 2 and result.lower_bound == 1 and not result.optimal
    check_fleet(result, *items, vehicle=TIGHT)


def test_heuristic_packs_loose_items_and_reports_never_fit_units(heuristic_only):
    items = [pallets(10, 500), loose(3, 4000, 600, 300, id="pipe"), loose(1, 6000, 400, id="long")]
    result = split(*items)
    assert not result.fits and result.unplaced == ["long#1"]
    assert result.lower_bound == 2 <= result.num_trucks <= 3 and all(t.fits for t in result.trucks)
    check_fleet(result, *items, vehicle=RIGID)


def test_five_hundred_units_are_quick():
    items = [pallets(200, 800, id="A"), pallets(200, 450, id="B", height=800, stackable=True),
             loose(100, 2400, 1200, 700, id="C", height=600)]
    start = time.perf_counter()
    result = split(*items, vehicle="SEMI")
    assert time.perf_counter() - start < 8
    assert result.fits and result.method == "heuristic"
    check_fleet(result, *items, vehicle=SEMI)


# ---------------------------------------------------------------------------
# POST /api/plan/fleet (real reference data)
# ---------------------------------------------------------------------------

def pallet(qty, weight=500, *, id="P", type_id="AU_STD", height=1200, **kw):
    return {"id": id, "kind": "pallet", "type_id": type_id, "quantity": qty, "gross_weight_kg": weight,
            "height_mm": height, **kw}


async def post(client, *items, vehicle="RIGID_MEDIUM", **kw):
    return await client.post("/api/plan/fleet", json={"items": list(items), "vehicle_id": vehicle, **kw})


async def test_api_splits_the_sample_request(client):
    """The request of the hand-made frontend sample gives the same shape of answer."""
    sample = json.loads(SAMPLE.read_text())
    res = await client.post("/api/plan/fleet", json=sample["request"])
    assert res.status_code == 200, res.text
    result = FleetResult.model_validate(res.json())
    assert set(res.json()) == set(sample["result"])
    assert set(res.json()["trucks"][0]) == set(sample["result"]["trucks"][0])
    assert result.fits and result.num_trucks == 2 and result.optimal and result.method == "exact"
    assert sorted(p.unit_id for t in result.trucks for p in t.placements) \
        == sorted(p["unit_id"] for t in sample["result"]["trucks"] for p in t["placements"])
    for truck in result.trucks:
        assert not {"paint", "chlor"} <= {p.item_id for p in truck.placements}


async def test_api_loose_freight_and_axles(client):
    res = await post(client, pallet(10, 1000, id="steel", height=600),
                     {"id": "pipe", "kind": "loose", "length_mm": 4500, "width_mm": 300, "height_mm": 300,
                      "quantity": 4, "gross_weight_kg": 250})
    assert res.status_code == 200, res.text
    result = FleetResult.model_validate(res.json())
    assert result.fits and result.num_trucks == 2
    for truck in result.trucks:
        assert all(a.load_kg <= a.limit_kg + 1e-6 for a in truck.axle_loads)


@pytest.mark.parametrize("body, message", [
    ({"items": [{"id": "c", "kind": "container", "type_id": "GP20", "gross_weight_kg": 9000}],
      "vehicle_id": "SEMI_TRAILER"}, "Split mode takes pallets and loose freight, not containers."),
    ({"items": [pallet(2)], "vehicle_id": "suggest"}, "'suggest' isn't supported here"),
    ({"items": [pallet(2)], "vehicle_id": "SPACESHIP"}, "Unknown vehicle 'SPACESHIP'"),
    ({"items": [pallet(2)], "vehicle_id": "RIGID_MEDIUM", "body_type": "HOVERCRAFT"}, "Unknown body type"),
])
async def test_api_rejects_what_it_cannot_split(client, body, message):
    res = await client.post("/api/plan/fleet", json=body)
    assert res.status_code == 400 and message in res.json()["detail"]


async def test_api_is_capped_with_the_demo_solver(client):
    held = [solve_slots.solve_slots.acquire(blocking=False) for _ in range(solve_slots.MAX_CONCURRENT_SOLVES)]
    try:
        assert all(held)
        res = await post(client, pallet(2))
        assert res.status_code == 429 and "busy" in res.json()["detail"]
        shipment = {"name": "A", "weight": 100, "height_mm": 1200}
        demo = await client.post("/api/solve", json={"shipments": [shipment]})
        assert demo.status_code == 429   # the same slots guard the demo
    finally:
        for _ in held:
            solve_slots.solve_slots.release()
    res = await post(client, pallet(2))
    assert res.status_code == 200 and res.json()["num_trucks"] == 1
