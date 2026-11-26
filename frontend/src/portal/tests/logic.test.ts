// Unit tests for the portal's pure helpers. Run: node --test src/portal/tests/
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  DG_FIELDS, dgFromForm, dgToForm, formatVolume, lastEventTo, lineTotals, matchesItemSearch, matchesSearch, orderDgWarnings,
  pricedLines, sortEvents, splitApiErrors, statusesForGroup, validateAddress, validateDgForm, validateItem, validateOrder,
  volumeFromCm, type DgFormValues, type OrderFormValues,
} from "../logic.ts";
import { normalise, type DgLike } from "../../dg/rules.ts";
import type { OrderEvent } from "../types.ts";

describe("status groups", () => {
  test("map to the statuses the brief lists", () => {
    assert.deepEqual(statusesForGroup("drafts"), ["draft"]);
    assert.deepEqual(statusesForGroup("active"), ["submitted", "accepted", "planned", "picked_up", "in_transit"]);
    assert.deepEqual(statusesForGroup("delivered"), ["delivered"]);
    assert.deepEqual(statusesForGroup("closed"), ["rejected", "cancelled", "exception"]);
    assert.deepEqual(statusesForGroup("all"), []);
    assert.deepEqual(statusesForGroup("nonsense"), []);
  });
});

describe("search", () => {
  test("orders match on reference or customer reference, case-insensitive", () => {
    const o = { reference: "ORD-000042", customer_reference: "PO-4471" };
    assert.ok(matchesSearch(o, "000042"));
    assert.ok(matchesSearch(o, "po-44"));
    assert.ok(matchesSearch(o, "  "));
    assert.ok(!matchesSearch(o, "xyz"));
    assert.ok(!matchesSearch({ reference: "ORD-1", customer_reference: null }, "PO"));
  });
  test("items match on SKU, name or description", () => {
    const it = { sku: "CEM-20", name: "Cement bag", description: "Grey" };
    assert.ok(matchesItemSearch(it, "cem"));
    assert.ok(matchesItemSearch(it, "BAG"));
    assert.ok(matchesItemSearch(it, "grey"));
    assert.ok(!matchesItemSearch(it, "tile"));
  });
  test("items match on the DG class, class name and UN number", () => {
    const it = { sku: "POOL", name: "Pool chlorine", description: null, dg: { dg_class: "5.1", un_number: "2880" } as DgLike };
    assert.ok(matchesItemSearch(it, "class 5.1"));
    assert.ok(matchesItemSearch(it, "oxidising"));
    assert.ok(matchesItemSearch(it, "UN 2880"));
    assert.ok(matchesItemSearch(it, "un2880"));
    assert.ok(!matchesItemSearch({ ...it, dg: null }, "2880"));
  });
});

describe("totals and volume", () => {
  test("lineTotals skips incomplete lines", () => {
    const items = new Map([[1, { weight_kg: 20, volume_m3: 0.014, pallet_spaces: 0 }], [2, { weight_kg: 950, volume_m3: 0.9, pallet_spaces: 1 }]]);
    const t = lineTotals([{ itemId: 1, quantity: 10 }, { itemId: 2, quantity: 2 }, { itemId: null, quantity: 5 }, { itemId: 1, quantity: NaN }], items);
    assert.equal(t.units, 12);
    assert.equal(t.weightKg, 2100);
    assert.ok(Math.abs(t.volumeM3 - 1.94) < 1e-9);
    assert.equal(t.pallets, 2);
  });
  test("volumeFromCm converts cm³ to m³", () => {
    assert.equal(volumeFromCm("120", "100", "50"), 0.6);
    assert.equal(volumeFromCm("10", "10", "10"), 0.001);
    assert.equal(volumeFromCm("10", "", "10"), null);
    assert.equal(volumeFromCm("10", "-1", "10"), null);
  });
  test("formatVolume keeps three decimals for small volumes", () => {
    assert.match(formatVolume(0.003), /^0[.,]003 m³$/);
    assert.match(formatVolume(1.234), /^1[.,]23 m³$/);
    assert.equal(formatVolume(0), "0 m³");
  });
});

describe("validation", () => {
  test("items need SKU, name and a positive weight", () => {
    const dg = dgToForm(null);
    const e = validateItem({ sku: " ", name: "", description: "", weight_kg: "0", volume_m3: "-1", pallet_spaces: "abc", dg });
    assert.deepEqual(Object.keys(e).sort(), ["name", "pallet_spaces", "sku", "volume_m3", "weight_kg"]);
    assert.deepEqual(validateItem({ sku: "A", name: "B", description: "", weight_kg: "1.5", volume_m3: "", pallet_spaces: "", dg }), {});
    const dgErrors = validateItem({ sku: "A", name: "B", description: "", weight_kg: "1.5", volume_m3: "", pallet_spaces: "", dg: { ...dg, kind: "dg" } });
    assert.deepEqual(Object.keys(dgErrors), ["dg.dg_class"]);
  });
  test("addresses need label, street, suburb, state, postcode and a 2-letter country", () => {
    const blank = { label: "", contact_name: "", phone: "", line1: "", line2: "", suburb: "", state: "", postcode: "12", country: "AUS", notes: "" };
    assert.deepEqual(Object.keys(validateAddress(blank)).sort(), ["country", "label", "line1", "postcode", "state", "suburb"]);
  });

  const base: OrderFormValues = {
    pickup_address_id: "1", delivery_address_id: "2", delivery_date: "2026-12-01", window_start: "", window_end: "",
    customer_reference: "", notes: "", lines: [{ key: "a", itemId: "1", quantity: "2" }],
  };
  test("a complete order is valid", () => {
    assert.deepEqual(validateOrder(base, "2026-11-26"), {});
  });
  test("orders: addresses must differ, date not in the past, window ordered", () => {
    const e = validateOrder({ ...base, delivery_address_id: "1", delivery_date: "2026-11-25", window_start: "12:00", window_end: "09:00" }, "2026-11-26");
    assert.match(e.delivery_address_id, /different/);
    assert.match(e.delivery_date, /past/);
    assert.match(e.window_end, /after/);
    assert.deepEqual(validateOrder({ ...base, delivery_date: "2026-11-26" }, "2026-11-26"), {});
  });
  test("orders: lines need an item, a whole quantity and no duplicates", () => {
    const e = validateOrder({ ...base, lines: [
      { key: "a", itemId: "1", quantity: "2" }, { key: "b", itemId: "1", quantity: "1" },
      { key: "c", itemId: "", quantity: "1" }, { key: "d", itemId: "3", quantity: "1.5" },
    ] }, "2026-11-26");
    assert.equal(e["line:a"], undefined);
    assert.match(e["line:b"], /already/);
    assert.match(e["line:c"], /Choose/);
    assert.match(e["line:d"], /whole/);
    assert.match(validateOrder({ ...base, lines: [] }, "2026-11-26").lines, /at least one/);
  });
  test("pricedLines keeps only complete, unique lines", () => {
    assert.deepEqual(pricedLines([
      { key: "a", itemId: "1", quantity: "2" }, { key: "b", itemId: "1", quantity: "3" },
      { key: "c", itemId: "", quantity: "1" }, { key: "d", itemId: "4", quantity: "0" }, { key: "e", itemId: "5", quantity: "7" },
    ]), [{ item_id: 1, quantity: 2 }, { item_id: 5, quantity: 7 }]);
  });
});

describe("dangerous goods on the item form", () => {
  const dgForm = (patch: Partial<DgFormValues>): DgFormValues => ({ ...dgToForm(null), kind: "dg", ...patch });

  test("general freight is sent as null; food and fire-risk goods as flags", () => {
    assert.equal(dgFromForm(dgToForm(null)), null);
    assert.equal(dgFromForm(dgToForm({ food: false, fire_risk: false })), null);
    assert.equal(dgFromForm({ ...dgToForm(null), food: true })?.food, true);
    const fire = dgFromForm({ ...dgToForm(null), combustible: true });
    assert.equal(fire?.fire_risk, true);
    assert.equal(fire?.dg_class, null);
    // Leftover DG fields don't leak into general freight.
    assert.equal(dgFromForm({ ...dgForm({ dg_class: "3", un_number: "1263" }), kind: "general" }), null);
  });

  test("an item's DG data survives the form unchanged", () => {
    const cases: DgLike[] = [
      { dg_class: "5.1", packing_group: "II", un_number: "2880", t92: ["hypochlorite", "calcium_hypochlorite"] },
      { dg_class: "3", packing_group: "II", un_number: "1263", container: "drum", t92: [] },
      { dg_class: "1", explosive_code: "1.4S", subsidiary: [], carrier_tags: ["lithium_battery"] },
      { dg_class: "9", fire_risk: true, subsidiary: ["8"], t92: null },
      { food: true },
      { fire_risk: true },
    ];
    for (const dg of cases) assert.deepEqual(dgFromForm(dgToForm(dg)), normalise(dg));
  });

  test("fields the class doesn't use are dropped", () => {
    const out = dgFromForm(dgForm({
      dg_class: "2.1", packing_group: "II", explosive_code: "1.4S", fire_risk: true, subsidiary: ["2.1", "8", "8"], un_number: " 1075 ",
    }));
    assert.deepEqual(
      { pg: out?.packing_group, exp: out?.explosive_code, fire: out?.fire_risk, sub: out?.subsidiary, un: out?.un_number, t92: out?.t92 },
      { pg: null, exp: null, fire: false, sub: ["8"], un: "1075", t92: null },
    );
    assert.deepEqual(dgFromForm(dgForm({ dg_class: "8", t92_checked: true, t92: [] }))?.t92, []);
    assert.equal(dgFromForm(dgForm({ dg_class: "6.1", fire_risk: true }))?.fire_risk, true);
  });

  test("validation puts each problem on its field", () => {
    assert.deepEqual(validateDgForm(dgToForm(null)), {});
    assert.deepEqual(validateDgForm(dgForm({ dg_class: "3", packing_group: "II", un_number: "1263" })), {});
    assert.deepEqual(Object.keys(validateDgForm({ ...dgToForm(null), food: true, combustible: true })), ["dg.food"]);
    assert.deepEqual(Object.keys(validateDgForm(dgForm({}))), ["dg.dg_class"]);
    assert.match(validateDgForm(dgForm({ dg_class: "3", un_number: "12a" }))["dg.un_number"], /4 digits/);
    assert.match(validateDgForm(dgForm({ dg_class: "1", explosive_code: "1.4" }))["dg.explosive_code"], /1\.4S/);
    assert.match(validateDgForm(dgForm({ dg_class: "3", container: "cylinder" }))["dg.container"], /Class 2/);
    assert.match(validateDgForm(dgForm({ dg_class: "5.1", t92_checked: true, t92: ["calcium_hypochlorite", "ammonium_nitrate"] }))["dg.t92"], /conflict/);
    assert.match(validateDgForm(dgForm({ dg_class: "3", subsidiary: ["2.1", "4.1", "5.1", "6.1", "8"] }))["dg.subsidiary"], /At most 4/);
  });
});

describe("dangerous goods on an order", () => {
  const items = new Map([
    { id: 1, name: "Cement", dg: null },
    { id: 2, name: "Pool chlorine", dg: { dg_class: "5.1", t92: ["calcium_hypochlorite", "hypochlorite"] } },
    { id: 3, name: "Thinners", dg: { dg_class: "3", t92: [] } },
    { id: 4, name: "Hydrochloric acid", dg: { dg_class: "8", t92: ["acid_strong"] } },
    { id: 5, name: "Drain cleaner", dg: { dg_class: "8", t92: null } },
    { id: 6, name: "Diesel additive", dg: { dg_class: "3", t92: [] } },
  ].map((i) => [i.id, i as { id: number; name: string; dg: DgLike }] as const));
  const lines = (...ids: string[]) => ids.map((itemId) => ({ itemId }));

  test("incompatible pairs and Table 9.2 checks among the chosen items", () => {
    const w = orderDgWarnings(lines("1", "2", "3", "4", "5", "", "2"), items);
    assert.deepEqual(w.incompatible.map((p) => [p.a, p.b]), [
      ["Pool chlorine (Class 5.1)", "Thinners (Class 3)"],
      ["Pool chlorine (Class 5.1)", "Hydrochloric acid (Class 8)"],
      ["Pool chlorine (Class 5.1)", "Drain cleaner (Class 8)"],
    ]);
    assert.ok(w.incompatible.every((p) => p.reason && p.reasons[0] === p.reason));
    assert.deepEqual(w.check.map((p) => [p.a, p.b]), [["Hydrochloric acid (Class 8)", "Drain cleaner (Class 8)"]]);
    assert.match(w.check[0].reason, /Table 9\.2/);
  });
  test("compatible or general goods give no warnings", () => {
    assert.deepEqual(orderDgWarnings(lines("1", "3", "6", "4"), items), { incompatible: [], check: [] });
    assert.deepEqual(orderDgWarnings(lines(), items), { incompatible: [], check: [] });
  });
});

describe("API errors", () => {
  test("422 lists split into known fields and general messages", () => {
    const { fields, general } = splitApiErrors([
      { loc: ["body", "sku"], msg: "String should have at least 1 character" },
      { loc: ["body"], msg: "Value error, Pickup and delivery addresses must be different." },
      { loc: ["body", "lines", 0, "quantity"], msg: "Input should be greater than or equal to 1" },
    ], ["sku"]);
    assert.deepEqual(fields, { sku: "String should have at least 1 character" });
    assert.deepEqual(general, ["Pickup and delivery addresses must be different.", "lines.0.quantity: Input should be greater than or equal to 1"]);
  });
  test("nested DG locs land on the longest known field", () => {
    const { fields, general } = splitApiErrors([
      { loc: ["body", "dg", "un_number"], msg: "String should match pattern '^\\d{4}$'" },
      { loc: ["body", "dg"], msg: "Value error, Class 3 has no packing groups." },
      { loc: ["body", "dg", "t92", 0], msg: "Input should be 'ammonium_nitrate', ..." },
      { loc: ["body", "lines", 0, "quantity"], msg: "Too many" },
    ], ["sku", ...DG_FIELDS]);
    assert.deepEqual(fields, {
      "dg.un_number": "String should match pattern '^\\d{4}$'",
      dg: "Class 3 has no packing groups.",
      "dg.t92": "Input should be 'ammonium_nitrate', ...",
    });
    assert.deepEqual(general, ["lines.0.quantity: Too many"]);
  });
  test("string details are left to the general error", () => {
    assert.deepEqual(splitApiErrors("SKU taken", ["sku"]), { fields: {}, general: [] });
  });
});

describe("events", () => {
  const ev = (id: number, to: OrderEvent["to_status"], at: string, note: string | null = null): OrderEvent => ({
    id, from_status: null, to_status: to, actor_id: null, actor_name: null, actor_role: null, note, created_at: at,
  });
  test("sortEvents is oldest first and lastEventTo finds the latest match", () => {
    const events = [ev(3, "rejected", "2026-11-03T00:00:00Z", "too late"), ev(1, "draft", "2026-11-01T00:00:00Z"), ev(2, "submitted", "2026-11-02T00:00:00Z")];
    assert.deepEqual(sortEvents(events).map((e) => e.id), [1, 2, 3]);
    assert.equal(lastEventTo(events, "rejected")?.note, "too late");
    assert.equal(lastEventTo(events, "delivered"), undefined);
  });
});
