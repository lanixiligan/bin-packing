// Unit tests for the portal's pure helpers. Run: node --test src/portal/tests/
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  formatVolume, lastEventTo, lineTotals, matchesItemSearch, matchesSearch, pricedLines, sortEvents, splitApiErrors,
  statusesForGroup, validateAddress, validateItem, validateOrder, volumeFromCm, type OrderFormValues,
} from "../logic.ts";
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
    const e = validateItem({ sku: " ", name: "", description: "", weight_kg: "0", volume_m3: "-1", pallet_spaces: "abc" });
    assert.deepEqual(Object.keys(e).sort(), ["name", "pallet_spaces", "sku", "volume_m3", "weight_kg"]);
    assert.deepEqual(validateItem({ sku: "A", name: "B", description: "", weight_kg: "1.5", volume_m3: "", pallet_spaces: "" }), {});
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
