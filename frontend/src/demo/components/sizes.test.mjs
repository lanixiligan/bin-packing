// Unit tests for shipment size labels and the fit checks the table makes before solving.
// Run: node --test src/demo/components/sizes.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { columnLabel, describeItem, fitProblems, footprintOf, inputProblem, metres, sizeLabel, sizeSpoken, volumeOf } from "./sizes.ts";

const rigid = { payloadKg: 8000, decks: [{ id: "body", name: "Body", length_mm: 4800, width_mm: 2400, height_mm: 2700 }] };
const pallet = (palletType, heightMm, weight = 500) => ({ name: "P", kind: "pallet", palletType, heightMm, weight });
const loose = (lengthMm, widthMm, heightMm, weight = 300) => ({ name: "L", kind: "loose", lengthMm, widthMm, heightMm, weight });

test("metres keep one or two decimals", () => {
  assert.deepEqual([metres(1200), metres(6000), metres(2480), metres(400)], ["1.2", "6.0", "2.48", "0.4"]);
});

test("size labels for pallets and loose items, from the list or the response", () => {
  assert.equal(sizeLabel(pallet("AU_STD", 1200)), "AU · 1.2 m");
  assert.equal(sizeLabel(pallet("EURO", 1600)), "Euro · 1.6 m");
  assert.equal(sizeLabel(loose(6000, 400, 300)), "6.0 × 0.4 × 0.3 m");
  assert.equal(sizeLabel({ kind: "loose", length_mm: 4200, width_mm: 600, height_mm: 500 }), "4.2 × 0.6 × 0.5 m");
  assert.equal(sizeLabel({ kind: "pallet", pallet_type: "SQUARE", height_mm: 1000 }), "Square · 1.0 m");
  assert.equal(sizeSpoken(pallet("AU_STD", 1200)), "AU pallet, 1.2 m high");
  assert.equal(sizeSpoken(loose(6000, 400, 300)), "6.0 × 0.4 × 0.3 m loose");
});

test("footprints and volume", () => {
  assert.deepEqual(footprintOf(pallet("EURO", 1000)), [1200, 800]);
  assert.deepEqual(footprintOf(loose(4200, 600, 500)), [4200, 600]);
  assert.equal(footprintOf(pallet("MYSTERY", 1000)), null);
  assert.deepEqual(footprintOf(pallet("MYSTERY", 1000), { MYSTERY: { length_mm: 1000, width_mm: 500 } }), [1000, 500]);
  assert.ok(Math.abs(volumeOf(loose(1000, 1000, 1000)) - 1) < 1e-9);
});

test("a shipment that fits the vehicle has no problems", () => {
  assert.deepEqual(fitProblems(loose(4600, 400, 300), rigid).messages, []);
  // 2.6 m across fits turned along the 4.8 m deck.
  assert.deepEqual(fitProblems(loose(2000, 2600, 300), rigid).messages, []);
  assert.deepEqual(fitProblems(pallet("AU_STD", 2700, 8000), rigid).messages, []);
});

test("longer than every deck, taller than inside, heavier than the payload", () => {
  const long = fitProblems(loose(6000, 400, 300), rigid);
  assert.equal(long.tooLong, true);
  assert.deepEqual(long.messages, ["Too long or wide for the 4.8 × 2.4 m deck, even turned."]);
  assert.equal(fitProblems(loose(3000, 2600, 300), rigid).tooLong, true);
  const tall = fitProblems(pallet("AU_STD", 2800), rigid);
  assert.deepEqual([tall.tooTall, tall.messages[0]], [true, "Taller than the 2.7 m inside height."]);
  const heavy = fitProblems(pallet("AU_STD", 1200, 8001), rigid);
  assert.deepEqual([heavy.tooHeavy, heavy.messages[0]], [true, "Heavier than the 8,000 kg payload."]);
  const bDouble = { payloadKg: 42500, decks: [
    { id: "lead", name: "Lead trailer", length_mm: 7400, width_mm: 2480, height_mm: 2700 },
    { id: "rear", name: "Rear trailer", length_mm: 13600, width_mm: 2480, height_mm: 2700 },
  ] };
  assert.deepEqual(fitProblems(loose(12000, 400, 300), bDouble).messages, []);
  assert.deepEqual(fitProblems(loose(14000, 400, 300), bDouble).messages, ["Too long or wide for every deck, even turned."]);
});

test("no fit checks without a vehicle", () => {
  assert.deepEqual(fitProblems(loose(60000, 400, 300), null).messages, []);
});

test("labels for what is drawn on a deck", () => {
  const paint = (id, name, weight) => ({ id, name, weight, kind: "pallet", pallet_type: "AU_STD", height_mm: 1200, dg_class: "3", subsidiary: [] });
  const pipes = { id: 2, name: "Pipes 03", weight: 250, kind: "loose", length_mm: 4600, width_mm: 400, height_mm: 300 };
  assert.equal(columnLabel([pipes], 300, 1, 2), "Pipes 03, 4.6 × 0.4 × 0.3 m loose, 250 kg, truck 1 of 2");
  assert.equal(describeItem(paint(0, "Paint 01", 1420)), "Paint 01, AU pallet, 1.2 m high, 1,420 kg, Class 3");
  assert.equal(
    columnLabel([paint(0, "Paint 01", 420), paint(1, "Paint 02", 380)], 2400, 1, 2),
    "Stack of 2, 2.4 m high: level 1, Paint 01, AU pallet, 1.2 m high, 420 kg, Class 3; " +
      "level 2, Paint 02, AU pallet, 1.2 m high, 380 kg, Class 3; truck 1 of 2",
  );
});

test("input problems", () => {
  assert.equal(inputProblem(pallet("AU_STD", 1200)), "");
  assert.equal(inputProblem({ ...pallet("AU_STD", 1200), name: " " }), "needs a name");
  assert.equal(inputProblem(pallet("AU_STD", 1200, "1.5")), "needs a whole-number weight above 0 kg");
  assert.equal(inputProblem(pallet("AU_STD", "")), "needs a height in whole mm");
  assert.equal(inputProblem(loose("", 400, 300)), "needs a length and width in whole mm");
  assert.equal(inputProblem(loose(4000, 400, 300)), "");
});
