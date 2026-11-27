// Unit tests for the shipment colour and DG text helpers.
// Run: node --test src/demo/components/capacity.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { colorFor, dgClassText, dgCodeOf, dgTextOf } from "./capacity.ts";

test("each shipment keeps its colour", () => {
  assert.equal(colorFor(3), colorFor(3));
  assert.notEqual(colorFor(0), colorFor(1));
  assert.match(colorFor(5), /^hsl\(\d+(\.\d+)?, 55%, 74%\)$/);
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
