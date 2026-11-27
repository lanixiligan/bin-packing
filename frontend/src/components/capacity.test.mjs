// Unit tests for the capacity helpers and the mock packer.
// Run: node --test src/components/capacity.test.mjs src/ops/mocks.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import {
  bindingDim, describeUsage, dgClassText, dgTextOf, fillPercent, fits, limitedDims, lowerBounds, overDims, shipmentFractions,
} from "./capacity.ts";
import { exact, ffd, misfits } from "../ops/packing.ts";

const u = (id, weight_kg, volume_m3 = 0, pallets = 0) => ({ id, weight_kg, volume_m3, pallets });

test("limitedDims keeps only the set limits, in display order", () => {
  assert.deepEqual(limitedDims({ weight_kg: null, volume_m3: 20, pallets: 6 }).map((d) => d.dim), ["volume", "pallets"]);
  assert.deepEqual(limitedDims({ weight_kg: 1000 }).map((d) => d.dim), ["weight"]);
});

test("fill percent and binding dimension", () => {
  const cap = { weight_kg: 2000, volume_m3: 12 };
  const usage = { weight_kg: 500, volume_m3: 9, pallets: 3 };
  assert.deepEqual(fillPercent(usage, cap), { weight: 25, volume: 75, pallets: null });
  assert.deepEqual(bindingDim(usage, cap), { dim: "volume", fraction: 0.75 });
  assert.match(describeUsage(usage, cap), /^Weight 500 of 2,000 kg, volume 9 of 12 m³$/);
});

test("fits and overDims tolerate float sums", () => {
  const cap = { volume_m3: 0.3 };
  assert.ok(fits({ weight_kg: 0, volume_m3: 0.1, pallets: 0 }, { weight_kg: 5, volume_m3: 0.2, pallets: 0 }, cap));
  assert.deepEqual(overDims({ weight_kg: 9999, volume_m3: 0.31, pallets: 0 }, cap).map((d) => d.dim), ["volume"]);
});

test("lower bound is the max over the limited dimensions", () => {
  const lb = lowerBounds({ weight_kg: 2900, volume_m3: 10, pallets: 6.5 }, { weight_kg: 3000, pallets: 6 });
  assert.deepEqual(lb, { overall: 2, weight: 1, volume: null, pallets: 2 });
});

test("1D shipment fractions are weight / capacity (the demo)", () => {
  const f = shipmentFractions([{ id: 1, name: "a", weight: 250 }, { id: 2, name: "b", weight: 500 }], 1000);
  assert.equal(f.get(1), 0.25);
  assert.equal(f.get(2), 0.5);
});

test("multi-dimension fractions add up to the binding fill and never overflow", () => {
  const cap = { weight_kg: 1000, volume_m3: 10 };
  // heavy + small and light + bulky: 70% weight, 70% volume, but 60% + 60% by own binding dim
  const ships = [
    { id: 1, name: "heavy", weight: 600, volume: 1 },
    { id: 2, name: "bulky", weight: 100, volume: 6 },
  ];
  const f = shipmentFractions(ships, cap);
  const total = f.get(1) + f.get(2);
  assert.ok(Math.abs(total - 0.7) < 1e-9, `total ${total}`);
  assert.ok(Math.abs(f.get(1) - f.get(2)) < 1e-9); // both 60% in their own binding dimension
});

test("FFD loses to the exact search on the demo's example", () => {
  const weights = [560, 490, 440, 370, 360, 340, 190, 150];
  const units = weights.map((w, i) => u(i, w));
  const cap = { weight_kg: 1000 };
  assert.equal(ffd(units, cap).loads.length, 4);
  const r = exact(units, cap, 3);
  assert.ok(r.loads);
  assert.equal(r.loads.length, 3);
  for (const load of r.loads) assert.ok(load.reduce((s, id) => s + weights[id], 0) <= 1000);
  assert.deepEqual(exact(units, cap, 2), { loads: null, exhausted: true });
});

test("FFD respects every limited dimension", () => {
  const cap = { weight_kg: 3000, pallets: 2 };
  const units = [u(0, 100, 0, 1), u(1, 100, 0, 1), u(2, 100, 0, 1)];
  assert.deepEqual(ffd(units, cap).loads, [[0, 1], [2]]);
});

test("misfits lists units bigger than the vehicle with their dimensions", () => {
  const m = misfits([u(0, 1200, 2.5, 2), u(1, 25)], { weight_kg: 1000, pallets: 1 });
  assert.equal(m.length, 1);
  assert.deepEqual(m[0].dims, ["weight", "pallets"]);
});

test("DG text for truck blocks", () => {
  assert.equal(dgClassText(null), "");
  assert.equal(dgClassText("3"), "Class 3");
  assert.equal(dgClassText("1"), "Class 1.4S");
  assert.equal(dgClassText("food"), "Food");
  assert.equal(dgClassText("fire_risk"), "Fire-risk");
  assert.equal(dgClassText("3", ["6.1", "8"]), "Class 3 (sub 6.1, 8)");
  assert.equal(dgClassText("3", null), "Class 3");
  assert.equal(dgTextOf({ dg_class: "5.1" }), "Class 5.1");
  assert.equal(dgTextOf({ dg_class: "2.2", subsidiary: ["5.1"] }), "Class 2.2 (sub 5.1)");
  assert.equal(dgTextOf({ dg_class: "8", dgLabel: "Class 8 (sub 6.1)" }), "Class 8 (sub 6.1)");
  assert.equal(dgTextOf({}), "");
});
