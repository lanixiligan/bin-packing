// Unit tests for the deck geometry of the truck views.
// Run: node --test src/demo/components/deck.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import solved from "../__fixtures__/solve-sized.json" with { type: "json" };
import { DECK_GAP_MM, deckPlan, floorUsedM2, rectOf, stackColumns } from "./deck.ts";

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≈ ${b}`);

test("a rigid's deck is scaled to the width limit", () => {
  const plan = deckPlan(solved.capacity.decks, { maxWidthPx: 80, maxLengthPx: 340 });
  close(plan.scale, 80 / 2400);
  close(plan.width, 80);
  close(plan.decks[0].lengthPx, 160);
});

test("a long vehicle is scaled to fit its length, decks end to end with a gap", () => {
  const decks = [
    { id: "lead", name: "Lead trailer", length_mm: 7400, width_mm: 2480, height_mm: 2700 },
    { id: "rear", name: "Rear trailer", length_mm: 13600, width_mm: 2480, height_mm: 2700 },
  ];
  const plan = deckPlan(decks, { maxWidthPx: 80, maxLengthPx: 340 });
  close(plan.scale, 340 / (7400 + 13600 + DECK_GAP_MM));
  close(plan.decks[1].lengthPx, 13600 * plan.scale);
  assert.ok(plan.width < 80);
});

test("a placement is drawn x down the deck and y across it, turned as returned", () => {
  const rice = solved.trucks[0].shipments.find((s) => s.name === "Rice 08").placement;
  const r = rectOf(rice, 0.1);
  close(r.top, 233);
  close(r.left, 0);
  close(r.width, 120);
  close(r.height, 80);
});

test("stacked shipments form one column, bottom first, with its height", () => {
  const cols = stackColumns(solved.trucks[0].shipments);
  assert.equal(cols.length, 5);
  const paint = cols.find((c) => c.items.length === 2);
  assert.deepEqual(paint.items.map((s) => s.name), ["Paint 01", "Paint 02"]);
  assert.equal(paint.topMm, 2400);
  assert.equal(paint.deckId, "body");
  assert.ok(cols.filter((c) => c !== paint).every((c) => c.items.length === 1));
});

test("floor used counts stacked items once", () => {
  const t = solved.trucks[0];
  close(Math.round(floorUsedM2(t.shipments) * 100) / 100, t.floor_used_m2);
});
