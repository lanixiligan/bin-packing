// Unit tests for the capacity helpers.
// Run: node --test src/components/capacity.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { bindingDim, describeSize, describeUsage, dgClassText, dgCodeOf, dgTextOf, limitedDims, overDims, truckFill } from "./capacity.ts";

test("limitedDims keeps only the set limits, in display order", () => {
  assert.deepEqual(limitedDims({ weight_kg: 1000, pallets: 8 }).map((d) => d.dim), ["weight", "pallets"]);
  assert.deepEqual(limitedDims({ weight_kg: 1000, pallets: null }).map((d) => d.dim), ["weight"]);
});

test("binding dimension, over dimensions and labels", () => {
  const cap = { weight_kg: 1000, pallets: 8 };
  const usage = { weight_kg: 500, pallets: 6 };
  assert.deepEqual(bindingDim(usage, cap), { dim: "pallets", fraction: 0.75 });
  assert.deepEqual(overDims({ weight_kg: 1000.0000000001, pallets: 9 }, cap).map((d) => d.dim), ["pallets"]);
  assert.equal(describeUsage(usage, cap), "Weight 500 of 1,000 kg, pallets 6 of 8 pallets");
  assert.equal(describeSize({ weight_kg: 560, pallets: 2 }), "560 kg, 2 pallets");
  assert.equal(describeSize({ weight_kg: 80, pallets: 0 }), "80 kg");
});

test("truckFill follows the drop animation", () => {
  const truck = { shipments: [{ id: 1, name: "a", weight: 400, pallets: 2 }, { id: 2, name: "b", weight: 500, pallets: 1 }] };
  const cap = { weight_kg: 1000, pallets: 4 };
  const half = truckFill(truck, cap, 1, { 1: 0, 2: 1 });
  assert.deepEqual([half.fill, half.done, half.over], [50, false, false]);
  const all = truckFill(truck, cap, 2, { 1: 0, 2: 1 });
  assert.deepEqual([all.fill, all.done, all.over], [90, true, false]);
});

test("DG text and placard codes", () => {
  assert.equal(dgClassText(null), "");
  assert.equal(dgClassText("3"), "Class 3");
  assert.equal(dgClassText("1"), "Class 1.4S");
  assert.equal(dgClassText("food"), "Food");
  assert.equal(dgClassText("fire_risk"), "Fire-risk");
  assert.equal(dgClassText("3", ["6.1", "8"]), "Class 3 (sub 6.1, 8)");
  assert.equal(dgClassText("3", null), "Class 3");
  assert.equal(dgTextOf({ dg_class: "2.2", subsidiary: ["5.1"] }), "Class 2.2 (sub 5.1)");
  assert.equal(dgTextOf({}), "");
  assert.deepEqual([dgCodeOf({ dg_class: "food" }), dgCodeOf({ dg_class: "fire_risk" }), dgCodeOf({ dg_class: "8" }), dgCodeOf({})], ["F", "R", "8", null]);
});
