// Unit tests for the adapters from the plan API to the truck views.
// Run: node --test src/ops/plan/solveView.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { loadsPanelData, methodPanelData, placements, summaryData } from "./solveView.ts";

const unit = (id, order_id, order_line_id, kg, m3 = 0, pallets = 0) => ({
  id, order_id, order_reference: `ORD-${order_id}`, order_line_id, item_name: `Item ${order_line_id}`,
  item_sku: `SKU-${order_line_id}`, weight_kg: kg, volume_m3: m3, pallets,
});

const result = {
  capacity: { weight_kg: 1000, volume_m3: 10, pallets: null },
  totals: { weight_kg: 1800, volume_m3: 12, pallets: 0 },
  lower_bound: 2,
  lower_bounds: { weight: 2, volume: 2, pallets: null },
  units: [unit(0, 1, 11, 600, 5), unit(1, 1, 11, 600, 5), unit(2, 2, 21, 600, 2)],
  ffd: {
    num_loads: 3, solve_time_ms: 0.123, drop_order: [0, 1, 2], optimal: false, status: "HEURISTIC",
    loads: [0, 1, 2].map((i) => ({ number: i + 1, unit_ids: [i], usage: { weight_kg: 600, volume_m3: 5, pallets: 0 }, fill_percent: {} })),
  },
  ortools: null,
  recommended: "ffd",
  time_limit_s: 10,
};

test("methodPanelData turns loads of unit ids into trucks of shipments", () => {
  const d = methodPanelData(result, result.ffd);
  assert.equal(d.num_trucks, 3);
  assert.deepEqual(d.drop_order, [0, 1, 2]);
  assert.equal(d.trucks[1].label, "Load 2");
  assert.deepEqual(d.trucks[2].shipments[0], {
    id: 2, name: "Item 21", weight: 600, volume: 2, pallets: 0, colorKey: 2, detail: "ORD-2",
  });
});

test("summaryData shows the per-dimension lower bounds and marks the binding ones", () => {
  const s = summaryData(result);
  assert.equal(s.ortools, null);
  assert.equal(s.lower_bound, 2);
  assert.equal(s.ffd.num_trucks, 3);
  assert.deepEqual(s.bound_details.map((d) => [d.label, d.binding]), [["Weight", true], ["Volume", true]]);
  assert.match(s.bound_note, /weight and volume/);
});

test("placements maps every unit to its load per method", () => {
  const p = placements({ ...result, ortools: { ...result.ffd, loads: [{ number: 1, unit_ids: [0, 2] }, { number: 2, unit_ids: [1] }] } });
  assert.deepEqual([...p.values()].map((x) => [x.ffd, x.ortools]), [[1, 1], [2, 2], [3, 1]]);
});

test("loadsPanelData makes one block per line on a load, sized by quantity", () => {
  const load = {
    id: 7, number: 1, vehicle: null, driver: null, over_capacity: false,
    capacity: { weight_kg: 1000, volume_m3: null, pallets: 4 },
    usage: { weight_kg: 900, volume_m3: 1.5, pallets: 3 }, fill_percent: {},
    lines: [{
      assignment_id: 70, order_line_id: 11, order_id: 1, order_reference: "ORD-1", company_name: "Acme",
      item_name: "Crate", item_sku: "CR", quantity: 3, line_quantity: 5,
      unit_weight_kg: 300, unit_volume_m3: 0.5, unit_pallet_spaces: 1,
    }],
  };
  const d = loadsPanelData([load]);
  assert.equal(d.num_trucks, 1);
  assert.deepEqual(d.drop_order, [70]);
  assert.deepEqual(d.trucks[0].capacity, load.capacity);
  assert.deepEqual(d.trucks[0].shipments[0], {
    id: 70, name: "Crate ×3", weight: 900, volume: 1.5, pallets: 3, colorKey: 1, detail: "ORD-1",
  });
});
