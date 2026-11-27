import assert from "node:assert/strict";
import { test } from "node:test";
import { northlineProhibited, SUBSIDIARIES, validateDg } from "../dg/rules.ts";
import { fitProblems, inputProblem } from "./components/sizes.ts";
import {
  autoName, demoDg, isDgClass, itemByName, ITEMS, MAX_SUBSIDIARY, normaliseHazard, PASTE_SIZE, randomShipments,
  shipmentsFromWeights, toRequest, typicalSize,
} from "./shipments.js";

// A deterministic random source.
function seeded(seed) {
  let x = seed;
  return () => ((x = (x * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
}

const RIGID = { payloadKg: 8000, decks: [{ id: "body", name: "Body", length_mm: 4800, width_mm: 2400, height_mm: 2700 }] };

test("demoDg carries subsidiary hazards for a class only", () => {
  assert.equal(demoDg(null), null);
  assert.deepEqual(demoDg("food", ["8"]), { food: true });
  assert.deepEqual(demoDg("3", ["6.1"]), { dg_class: "3", subsidiary: ["6.1"], t92: [], explosive_code: null });
  assert.equal(demoDg("1").explosive_code, "1.4S");
});

test("normaliseHazard matches the backend's checks", () => {
  assert.deepEqual(normaliseHazard("food", ["8"]), { dgClass: "food", subsidiary: [] });
  assert.deepEqual(normaliseHazard("", ["8"]), { dgClass: null, subsidiary: [] });
  assert.deepEqual(normaliseHazard("8", ["8", "3", "3", "9"]), { dgClass: "8", subsidiary: ["3"] });
  assert.deepEqual(normaliseHazard("3", ["8", "2.1"]), { dgClass: "3", subsidiary: ["2.1", "8"] });
  assert.equal(normaliseHazard("9", SUBSIDIARIES).subsidiary.length, MAX_SUBSIDIARY);
});

test("every catalogue item carries valid DG data and a typical size", () => {
  assert.equal(new Set(ITEMS.map((i) => i.name.toLowerCase())).size, ITEMS.length);
  for (const it of ITEMS) {
    assert.deepEqual(normaliseHazard(it.dgClass, it.subsidiary), { dgClass: it.dgClass, subsidiary: it.subsidiary }, it.name);
    if (isDgClass(it.dgClass)) assert.deepEqual(validateDg(demoDg(it.dgClass, it.subsidiary)), [], it.name);
    const [lo, hi] = it.size.kg;
    assert.ok(lo >= 100 && hi <= 1000 && lo < hi, it.name);
    assert.equal(inputProblem({ name: it.name, weight: lo, ...typicalSize(it) }), "", it.name);
  }
  assert.ok(ITEMS.some((i) => i.subsidiary.length > 0));
  assert.deepEqual(typicalSize(itemByName("Pipes")), { kind: "loose", lengthMm: 6000, widthMm: 400, heightMm: 300, stackable: false });
  assert.equal(typicalSize(itemByName("Pipes"), 4800).lengthMm, 4600);
  assert.deepEqual(typicalSize(itemByName("Paint")), { kind: "pallet", palletType: "AU_STD", heightMm: 1200, stackable: true });
  assert.deepEqual(typicalSize(itemByName("Glass")), { kind: "pallet", palletType: "EURO", heightMm: 1600, stackable: false });
});

test("itemByName ignores case and the list number", () => {
  assert.deepEqual(itemByName("methanol 07").subsidiary, ["6.1"]);
  assert.equal(itemByName("methanol 07").dgClass, "3");
  assert.equal(itemByName("  Rice ").dgClass, "food");
  assert.equal(itemByName("Mystery box"), undefined);
});

test("random shipments take their DG data from the item and fit the rigid", () => {
  const rnd = seeded(7);
  const all = Array.from({ length: 10 }, () => randomShipments(40, rnd)).flat();
  for (const s of all) {
    const it = itemByName(s.name);
    assert.ok(it, s.name);
    assert.deepEqual({ dgClass: s.dgClass, subsidiary: s.subsidiary }, { dgClass: it.dgClass, subsidiary: it.subsidiary });
    assert.equal(inputProblem(s), "", s.name);
    assert.equal(s.kind, it.size.kind);
    assert.ok(s.weight >= it.size.kg[0] && s.weight <= it.size.kg[1] && s.weight % 5 === 0, `${s.name} ${s.weight}`);
    assert.deepEqual(fitProblems(s, RIGID).messages, [], s.name);
    if (s.stackable) assert.ok(2 * s.heightMm <= 2700, `${s.name} ${s.heightMm}`);
  }
  assert.equal(randomShipments().length, 20);
  assert.ok(all.some((s) => isDgClass(s.dgClass)) && all.some((s) => s.dgClass === "food") && all.some((s) => !s.dgClass));
  assert.ok(all.some((s) => s.subsidiary.length > 0));
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

test("pasted weights become general freight on AU pallets", () => {
  for (let i = 0; i < 40; i++) assert.equal(itemByName(autoName(i)).dgClass, null);
  const list = shipmentsFromWeights([100, 200, 300]);
  assert.ok(list.every((s) => s.dgClass === null && s.subsidiary.length === 0 && inputProblem(s) === ""));
  assert.deepEqual(
    { kind: list[0].kind, palletType: list[0].palletType, heightMm: list[0].heightMm, stackable: list[0].stackable },
    PASTE_SIZE,
  );
});

test("toRequest builds the solve request exactly as the contract says", () => {
  const shipments = [
    { uid: 1, name: " Paint 01 ", weight: "420", kind: "pallet", palletType: "AU_STD", lengthMm: 999, heightMm: "1200", stackable: true, dgClass: "3", subsidiary: [] },
    { uid: 2, name: "Pipes 02", weight: 250, kind: "loose", palletType: "EURO", lengthMm: "4600", widthMm: 400, heightMm: 300, stackable: false, dgClass: null, subsidiary: [] },
    { uid: 3, name: "Chlorine gas 03", weight: 500, kind: "pallet", palletType: "EURO", heightMm: 1400, stackable: false, dgClass: "2.3", subsidiary: ["8"] },
  ];
  assert.deepEqual(toRequest({ vehicleId: "B_DOUBLE", bodyType: null, ruleSet: "northline", shipments }), {
    vehicle_id: "B_DOUBLE",
    body_type: null,
    rule_set: "northline",
    shipments: [
      { name: "Paint 01", weight: 420, kind: "pallet", pallet_type: "AU_STD", height_mm: 1200, stackable: true, dg_class: "3" },
      { name: "Pipes 02", weight: 250, kind: "loose", length_mm: 4600, width_mm: 400, height_mm: 300, stackable: false },
      { name: "Chlorine gas 03", weight: 500, kind: "pallet", pallet_type: "EURO", height_mm: 1400, stackable: false, dg_class: "2.3", subsidiary: ["8"] },
    ],
  });
  assert.equal(toRequest({ vehicleId: "RIGID_MEDIUM", bodyType: "PANTECH", shipments: [] }).body_type, "PANTECH");
});

test("random shipments never include goods Northline refuses", () => {
  const random = seeded(1);
  for (let k = 0; k < 50; k++) {
    for (const s of randomShipments(20, random)) {
      assert.equal(northlineProhibited(demoDg(s.dgClass, s.subsidiary)), false, s.name);
    }
  }
});
