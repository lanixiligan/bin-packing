import assert from "node:assert/strict";
import { test } from "node:test";
import { SUBSIDIARIES, validateDg } from "../dg/rules.ts";
import { autoName, demoDg, isDgClass, itemByName, ITEMS, MAX_SUBSIDIARY, normaliseHazard, randomShipments, shipmentsFromWeights } from "./shipments.js";

// A deterministic random source.
function seeded(seed) {
  let x = seed;
  return () => ((x = (x * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
}

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

test("every catalogue item carries valid DG data", () => {
  assert.equal(new Set(ITEMS.map((i) => i.name.toLowerCase())).size, ITEMS.length);
  for (const it of ITEMS) {
    assert.deepEqual(normaliseHazard(it.dgClass, it.subsidiary), { dgClass: it.dgClass, subsidiary: it.subsidiary }, it.name);
    if (isDgClass(it.dgClass)) assert.deepEqual(validateDg(demoDg(it.dgClass, it.subsidiary)), [], it.name);
  }
  assert.ok(ITEMS.some((i) => i.subsidiary.length > 0));
});

test("itemByName ignores case and the list number", () => {
  assert.deepEqual(itemByName("methanol 07"), { name: "Methanol", dgClass: "3", subsidiary: ["6.1"] });
  assert.equal(itemByName("  Rice ").dgClass, "food");
  assert.equal(itemByName("Mystery box"), undefined);
});

test("random shipments take their DG data from the item", () => {
  const rnd = seeded(7);
  const all = Array.from({ length: 10 }, () => randomShipments(1000, 40, rnd)).flat();
  for (const s of all) {
    const it = itemByName(s.name);
    assert.ok(it, s.name);
    assert.deepEqual({ dgClass: s.dgClass, subsidiary: s.subsidiary }, { dgClass: it.dgClass, subsidiary: it.subsidiary });
    assert.ok(s.weight >= 50 && s.weight <= 600);
    assert.ok([1, 2, 3].includes(s.pallets), String(s.pallets));
  }
  assert.ok(all.some((s) => isDgClass(s.dgClass)) && all.some((s) => s.dgClass === "food") && all.some((s) => !s.dgClass));
  assert.ok(all.some((s) => s.subsidiary.length > 0));
});

test("automatic names are general freight only", () => {
  for (let i = 0; i < 40; i++) assert.equal(itemByName(autoName(i)).dgClass, null);
  assert.ok(shipmentsFromWeights([1, 2, 3]).every((s) => s.dgClass === null && s.subsidiary.length === 0 && s.pallets === 1));
});
