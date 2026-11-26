"""Regression tests for the correctness review fixes: draft edits racing a submit,
item and vehicle sizes kept to the solver's resolution, the CP-SAT size cap and
the demo endpoint's input bounds. (Split-order driver steps: tests/test_driver.py.)"""

import asyncio

import pytest

from app.models import Order, OrderStatus
from app.schemas import Capacity, ItemCreate, PackUnit, VehicleCreate
from app.solver import multi, pack
from tests.test_portal_support import create_order, make_catalog, zone_north


@pytest.fixture
async def cat(session, customer):
    return await make_catalog(session, customer.company, zone=await zone_north(session))


async def test_edit_racing_submit_never_leaves_a_stale_quote(client, session, customer, cat):
    """Whatever order the edit and the submit run in, the stored quote prices the
    lines the order ends up with."""
    for _ in range(5):
        o = await create_order(client, customer, cat)
        edit = client.patch(f"/api/portal/orders/{o['id']}", headers=customer.headers,
                            json={"lines": [{"item_id": cat.item.id, "quantity": 40}]})
        submit = client.post(f"/api/portal/orders/{o['id']}/submit", headers=customer.headers)
        r_edit, r_submit = await asyncio.gather(edit, submit)
        assert r_submit.status_code == 200, r_submit.text
        assert r_edit.status_code in (200, 409), r_edit.text
        order = await session.get(Order, o["id"], populate_existing=True)
        assert order.status == OrderStatus.submitted
        weight = sum(ln.unit_weight_kg * ln.quantity for ln in order.lines)
        assert order.quote.total_weight_kg == pytest.approx(weight)


def test_sizes_are_kept_to_the_solver_resolution():
    item = ItemCreate(sku="A", name="A", weight_kg=0.33333, volume_m3=0.1234567, pallet_spaces=1 / 3)
    assert (item.weight_kg, item.volume_m3, item.pallet_spaces) == (0.333, 0.123457, 0.333)
    with pytest.raises(ValueError):
        ItemCreate(sku="A", name="A", weight_kg=0.0004)  # rounds to 0 g
    v = VehicleCreate(name="V", registration="V1", max_weight_kg=999.99949, max_volume_m3=12.3456789)
    assert (v.max_weight_kg, v.max_volume_m3) == (999.999, 12.345679)


def _units(n, **size):
    return [PackUnit(id=k, order_id=1, order_reference="R", order_line_id=1, item_name="x",
                     item_sku="x", **({"weight_kg": 0, "volume_m3": 0, "pallets": 0} | size))
            for k in range(n)]


def test_thirds_of_a_pallet_fit_one_load():
    """Three items entered as 1/3 pallet (stored as 0.333) share one 1-pallet load in
    both methods; before, CP-SAT's rounding made this infeasible."""
    pallets = ItemCreate(sku="A", name="A", weight_kg=1, pallet_spaces=1 / 3).pallet_spaces
    r = pack(_units(3, weight_kg=1, pallets=pallets), Capacity(pallets=1), 5)
    assert r.ffd.num_loads == 1 and r.ortools is not None and r.ortools.num_loads == 1


def test_large_models_skip_cpsat(monkeypatch):
    monkeypatch.setattr(multi, "MAX_CPSAT_VARS", 10)
    r = pack(_units(20, weight_kg=10), Capacity(weight_kg=50), 5)
    assert r.ffd.num_loads == 4 and r.ortools is None and r.recommended == "ffd"


@pytest.mark.parametrize("body", [
    {"capacity": 9 * 10**15, "shipments": [{"name": "A", "weight": 1}]},
    {"capacity": 1000, "shipments": [{"name": "A", "weight": 9 * 10**15}]},
])
async def test_demo_rejects_huge_numbers(client, body):
    r = await client.post("/api/solve", json=body)
    assert r.status_code == 422
