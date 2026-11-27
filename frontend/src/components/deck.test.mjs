// Unit tests for the pallet deck geometry.
// Run: node --test src/components/deck.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_LOAD_MM, deckFor, describeDeck, layoutPallets, loadHeightMm, MAX_LOAD_MM, palletFootprint, truckDeck, usesDeck,
} from "./deck.ts";

const s = (id, pallets, volume = 0) => ({ id, name: `S${id}`, weight: 100, pallets, volume });

test("a 22-pallet deck is 2 across by 11 rows, about 13.4 m long", () => {
  const d = deckFor(22);
  assert.equal(d.across, 2);
  assert.equal(d.rows, 11);
  assert.equal(d.slots, 22);
  assert.equal(d.lengthMm, 11 * 1165 + 12 * 50);
  assert.ok(d.limited);
  assert.equal(describeDeck(d), "13.4 × 2.4 m deck, 22 pallet spaces");
});

test("one slot is one across; an odd limit leaves the last row half used", () => {
  assert.deepEqual([deckFor(1).across, deckFor(1).rows, deckFor(1).slots], [1, 1, 1]);
  assert.deepEqual([deckFor(7).across, deckFor(7).rows, deckFor(7).slots], [2, 4, 7]);
});

test("without a limit the deck is sized to the load, at least two rows", () => {
  assert.deepEqual([deckFor(null, 9).rows, deckFor(null, 9).slots, deckFor(null, 9).limited], [5, 10, false]);
  assert.equal(deckFor(null, 1).rows, 2);
  assert.equal(truckDeck([s(1, 3), s(2, 2.5)], 1000).rows, 3);
  assert.equal(truckDeck([s(1, 3)], { weight_kg: 1000, pallets: 8 }).slots, 8);
});

test("whole pallets fill front to back, left then right", () => {
  const { pieces, loose, rows } = layoutPallets([s(1, 2), s(2, 1)], deckFor(6));
  assert.deepEqual(pieces.map((p) => [p.id, p.row, p.col, p.from, p.to, p.first]), [
    [1, 0, 0, 0, 1, true], [1, 0, 1, 0, 1, false], [2, 1, 0, 0, 1, true],
  ]);
  assert.equal(loose.length, 0);
  assert.equal(rows, 3);
});

test("two half pallets share one slot, a whole pallet skips the half-used slot", () => {
  const { pieces } = layoutPallets([s(1, 0.5), s(2, 1), s(3, 0.5)], deckFor(4));
  assert.deepEqual(pieces.map((p) => [p.id, p.slot, p.from, p.to]), [[1, 0, 0, 0.5], [2, 1, 0, 1], [3, 0, 0.5, 1]]);
});

test("pieces past the last slot are over and add rows past the rear", () => {
  const { pieces, rows } = layoutPallets([s(1, 3), s(2, 2)], deckFor(4));
  assert.deepEqual(pieces.map((p) => p.over), [false, false, false, false, true]);
  assert.equal(rows, 3);
});

test("loose freight is kept apart", () => {
  const { pieces, loose } = layoutPallets([s(1, 0), s(2, 1)], deckFor(2));
  assert.deepEqual(loose.map((x) => x.id), [1]);
  assert.equal(pieces.length, 1);
});

test("usesDeck: a pallet limit, or any shipment on pallets", () => {
  assert.equal(usesDeck([s(1, 0)], 1000), false);
  assert.equal(usesDeck([s(1, 0)], { weight_kg: 1000 }), false);
  assert.equal(usesDeck([s(1, 0)], { weight_kg: 1000, pallets: 8 }), true);
  assert.equal(usesDeck([s(1, 1)], 1000), true);
});

test("load height from volume over the pallet footprint, clamped", () => {
  assert.equal(loadHeightMm(s(1, 1)), DEFAULT_LOAD_MM);
  assert.equal(Math.round(loadHeightMm(s(1, 1, 1.165 * 1.165))), 1000);
  assert.equal(loadHeightMm(s(1, 1, 10)), MAX_LOAD_MM);
  assert.equal(palletFootprint(2), "2 pallet spaces of 1165 × 1165 mm");
  assert.equal(palletFootprint(0), "");
});
