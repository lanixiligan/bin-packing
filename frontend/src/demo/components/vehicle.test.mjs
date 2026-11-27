// Unit tests for the vehicle helpers (the demo's trucks are a planner vehicle).
// Run: node --test src/demo/components/vehicle.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import reference from "../../__fixtures__/reference.json" with { type: "json" };
import { demoReference, describeDecks, vehicleDecks, vehicleFit, vehicleLine } from "./vehicle.ts";

test("the demo offers no configurable or route-restricted vehicles, and only pallet bodies", () => {
  const ref = demoReference(reference);
  assert.deepEqual(Object.keys(ref.vehicles), ["RIGID_SMALL", "RIGID_MEDIUM", "RIGID_LARGE", "SEMI_TRAILER", "B_DOUBLE"]);
  for (const v of Object.values(ref.vehicles)) {
    for (const b of v.allowed_bodies) assert.ok(ref.bodies[b].carries_pallets && ref.bodies[b].in_scope, `${v.id} ${b}`);
  }
  assert.ok(!ref.vehicles.RIGID_LARGE.allowed_bodies.includes("SKELETAL"));
  // The input is not changed.
  assert.ok(reference.vehicles.RIGID_LARGE.allowed_bodies.includes("SKELETAL"));
});

test("cargo decks with the body's inside height", () => {
  assert.deepEqual(vehicleDecks(reference, "RIGID_MEDIUM"), [
    { id: "body", name: "Body", length_mm: 4800, width_mm: 2400, height_mm: 2700 },
  ]);
  assert.deepEqual(vehicleDecks(reference, "B_DOUBLE").map((d) => d.id), ["lead", "rear"]);
  assert.equal(vehicleDecks(reference, "RIGID_MEDIUM", "PANTECH")[0].height_mm, 2600);
  // An open body: the overall height limit above the deck.
  const v = reference.vehicles.RIGID_MEDIUM;
  assert.equal(vehicleDecks(reference, "RIGID_MEDIUM", "FLAT_TOP")[0].height_mm, v.overall_height_limit_mm - v.decks[0].deck_height_mm);
  assert.deepEqual(vehicleDecks(reference, "NOPE"), []);
  assert.equal(vehicleFit(reference, "RIGID_MEDIUM").payloadKg, 8000);
  assert.equal(vehicleFit(reference, "NOPE"), null);
});

test("the vehicle line", () => {
  assert.equal(vehicleLine(reference, "RIGID_MEDIUM"), "Medium rigid (8 t) · 4.8 × 2.4 m deck · 2.7 m inside · 8 t");
  assert.equal(vehicleLine(reference, "B_DOUBLE"), "B-double · 7.4 + 13.6 × 2.48 m decks · 2.7 m inside · 42.5 t");
  assert.equal(vehicleLine(reference, "RIGID_MEDIUM", "PANTECH"), "Medium rigid (8 t) · Pantech (van) · 4.8 × 2.4 m deck · 2.6 m inside · 8 t");
  assert.equal(describeDecks([
    { id: "a", name: "A", length_mm: 7400, width_mm: 2400, height_mm: 1 },
    { id: "b", name: "B", length_mm: 13600, width_mm: 2480, height_mm: 1 },
  ]), "7.4 × 2.4 + 13.6 × 2.48 m decks");
});
