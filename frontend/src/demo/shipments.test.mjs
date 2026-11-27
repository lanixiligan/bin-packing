import assert from "node:assert/strict";
import { test } from "node:test";
import { fitProblems, inputProblem } from "./components/sizes.ts";
import {
  autoName, itemByName, ITEMS, PASTE_SIZE, randomShipments,
  shipmentsFromWeights, toRequest, typicalSize,
} from "./shipments.js";

// A deterministic random source.
function seeded(seed) {
  let x = seed;
  return () => ((x = (x * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
}

const RIGID = { payloadKg: 8000, decks: [{ id: "body", name: "Body", length_mm: 4800, width_mm: 2400, height_mm: 2700 }] };

test("every catalogue item has a typical size", () => {
  assert.equal(new Set(ITEMS.map((i) => i.name.toLowerCase())).size, ITEMS.length);
  for (const it of ITEMS) {
    const [lo, hi] = it.size.kg;
    assert.ok(lo >= 100 && hi <= 1000 && lo < hi, it.name);
    assert.equal(inputProblem({ name: it.name, weight: lo, ...typicalSize(it) }), "", it.name);
  }
  assert.deepEqual(typicalSize(itemByName("Pipes")), { kind: "loose", lengthMm: 6000, widthMm: 400, heightMm: 300, stackable: false });
  assert.equal(typicalSize(itemByName("Pipes"), 4800).lengthMm, 4600);
  assert.deepEqual(typicalSize(itemByName("Paint")), { kind: "pallet", palletType: "AU_STD", heightMm: 1200, stackable: true });
  assert.deepEqual(typicalSize(itemByName("Glass")), { kind: "pallet", palletType: "EURO", heightMm: 1600, stackable: false });
});

test("itemByName ignores case and the list number", () => {
  assert.equal(itemByName("paint 07").name, "Paint");
  assert.equal(itemByName("  Rice ").name, "Rice");
  assert.equal(itemByName("Mystery box"), undefined);
});

test("random shipments come from the catalogue and fit the rigid", () => {
  const rnd = seeded(7);
  const all = Array.from({ length: 10 }, () => randomShipments(40, rnd)).flat();
  for (const s of all) {
    const it = itemByName(s.name);
    assert.ok(it, s.name);
    assert.equal(inputProblem(s), "", s.name);
    assert.equal(s.kind, it.size.kind);
    assert.ok(s.weight >= it.size.kg[0] && s.weight <= it.size.kg[1] && s.weight % 5 === 0, `${s.name} ${s.weight}`);
    assert.deepEqual(fitProblems(s, RIGID).messages, [], s.name);
    if (s.stackable) assert.ok(2 * s.heightMm <= 2700, `${s.name} ${s.heightMm}`);
  }
  assert.equal(randomShipments().length, 20);
  assert.ok(all.some((s) => s.kind === "loose") && all.some((s) => s.stackable) && all.some((s) => !s.stackable));
  assert.ok(new Set(all.filter((s) => s.name.startsWith("Paint")).map((s) => s.heightMm)).size > 1, "heights vary");
});

test("a bigger vehicle lets the long pipes in", () => {
  const rnd = seeded(3);
  const pipes = Array.from({ length: 30 }, () => randomShipments(40, rnd, { maxLengthMm: 13900 })).flat()
    .filter((s) => s.name.startsWith("Pipes"));
  assert.ok(pipes.some((s) => s.lengthMm === 6000));
  assert.ok(pipes.filter((s) => s.lengthMm <= 4600).length > pipes.length / 2, "mostly short ones");
});

test("pasted weights become catalogue-named shipments on AU pallets", () => {
  for (let i = 0; i < 40; i++) assert.ok(itemByName(autoName(i)), autoName(i));
  const list = shipmentsFromWeights([100, 200, 300]);
  assert.ok(list.every((s) => inputProblem(s) === ""));
  assert.deepEqual(
    { kind: list[0].kind, palletType: list[0].palletType, heightMm: list[0].heightMm, stackable: list[0].stackable },
    PASTE_SIZE,
  );
});

test("toRequest builds the solve request exactly as the contract says", () => {
  const shipments = [
    { uid: 1, name: " Paint 01 ", weight: "420", kind: "pallet", palletType: "AU_STD", lengthMm: 999, heightMm: "1200", stackable: true },
    { uid: 2, name: "Pipes 02", weight: 250, kind: "loose", palletType: "EURO", lengthMm: "4600", widthMm: 400, heightMm: 300, stackable: false },
    { uid: 3, name: "Glass 03", weight: 500, kind: "pallet", palletType: "EURO", heightMm: 1400, stackable: false },
  ];
  assert.deepEqual(toRequest({ vehicleId: "B_DOUBLE", bodyType: null, shipments }), {
    vehicle_id: "B_DOUBLE",
    body_type: null,
    shipments: [
      { name: "Paint 01", weight: 420, kind: "pallet", pallet_type: "AU_STD", height_mm: 1200, stackable: true },
      { name: "Pipes 02", weight: 250, kind: "loose", length_mm: 4600, width_mm: 400, height_mm: 300, stackable: false },
      { name: "Glass 03", weight: 500, kind: "pallet", pallet_type: "EURO", height_mm: 1400, stackable: false },
    ],
  });
  assert.equal(toRequest({ vehicleId: "RIGID_MEDIUM", bodyType: "PANTECH", shipments: [] }).body_type, "PANTECH");
});
