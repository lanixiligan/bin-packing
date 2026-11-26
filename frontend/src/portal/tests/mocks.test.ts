// Contract tests for the portal mock API (docs/api.md). Run: node --test src/portal/tests/
import { beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { mockFetch } from "../../api/mock.ts";
import { priceLines, resetPortalMock } from "../mocks.ts";
import { todayIso } from "../../shell/format.ts";

type Json = Record<string, unknown> & { detail?: unknown };

async function call(method: string, path: string, body?: unknown, role: string | null = "customer") {
  const headers: Record<string, string> = {};
  if (role) headers.Authorization = `Bearer mock:${role}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await mockFetch(new Request(`http://mock${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }));
  const text = res.status === 204 ? "" : await res.text();
  let data: unknown = text;
  try { data = text ? JSON.parse(text) : null; } catch { /* binary */ }
  return { status: res.status, data: data as Json & Json[], type: res.headers.get("content-type") };
}

beforeEach(() => resetPortalMock());

describe("pricing", () => {
  test("cubic weight = max(kg, m³ × 250), times the zone rate", () => {
    const heavy = priceLines("NORTH", [{ weightKg: 100, volumeM3: 0.2 }]);
    assert.equal(heavy.cubic_weight_kg, 100);
    assert.equal(heavy.amount, "45.00");
    assert.equal(heavy.provisional, false);
    const bulky = priceLines("WEST", [{ weightKg: 9, volumeM3: 0.45 }]);
    assert.equal(bulky.cubic_weight_kg, 112.5);
    assert.equal(bulky.amount, "61.88");
    const unzoned = priceLines(null, [{ weightKg: 10, volumeM3: 0 }]);
    assert.equal(unzoned.rate_per_kg, "0.60");
    assert.equal(unzoned.provisional, true);
    assert.equal(unzoned.id, null);
  });
});

describe("auth and tenants", () => {
  test("401 without a token, 403 for other roles", async () => {
    assert.equal((await call("GET", "/api/portal/items", undefined, null)).status, 401);
    assert.equal((await call("GET", "/api/portal/items", undefined, "dispatcher")).status, 403);
  });
  test("another company's rows are 404", async () => {
    assert.equal((await call("GET", "/api/portal/items/50")).status, 404);
    assert.equal((await call("GET", "/api/portal/addresses/60")).status, 404);
    assert.equal((await call("GET", "/api/portal/orders/20")).status, 404);
    const items = await call("GET", "/api/portal/items?include_archived=true");
    assert.ok(items.data.every((i) => i.company_id === 1));
  });
});

describe("items", () => {
  test("archived items are hidden unless asked for", async () => {
    const active = await call("GET", "/api/portal/items");
    const all = await call("GET", "/api/portal/items?include_archived=true");
    assert.ok(all.data.length > active.data.length);
    assert.ok(active.data.every((i) => !i.archived));
  });
  test("create, duplicate SKU 409, 422 shape, update, archive", async () => {
    const created = await call("POST", "/api/portal/items", { sku: "NEW-1", name: "New", weight_kg: 2 });
    assert.equal(created.status, 201);
    assert.equal(created.data.volume_m3, 0);
    const dup = await call("POST", "/api/portal/items", { sku: "new-1", name: "Again", weight_kg: 1 });
    assert.equal(dup.status, 409);
    const bad = await call("POST", "/api/portal/items", { sku: "", name: "X", weight_kg: 0 });
    assert.equal(bad.status, 422);
    assert.deepEqual((bad.data.detail as { loc: unknown[] }[]).map((d) => d.loc), [["body", "sku"], ["body", "weight_kg"]]);
    const id = created.data.id as number;
    const patched = await call("PATCH", `/api/portal/items/${id}`, { name: "Renamed", description: null });
    assert.equal(patched.data.name, "Renamed");
    assert.equal((await call("PATCH", `/api/portal/items/${id}`, { sku: "CEM-20" })).status, 409);
    assert.equal((await call("DELETE", `/api/portal/items/${id}`)).status, 204);
    assert.equal((await call("GET", `/api/portal/items/${id}`)).data.archived, true);
    assert.equal((await call("GET", "/api/portal/items/abc")).status, 422);
  });
});

describe("addresses", () => {
  test("customers can't set the zone", async () => {
    const created = await call("POST", "/api/portal/addresses", {
      label: "New site", line1: "1 Test St", suburb: "Ryde", state: "NSW", postcode: "2112", zone: "NORTH",
    });
    assert.equal(created.status, 201);
    assert.equal(created.data.zone, null);
    assert.equal(created.data.country, "AU");
    const patched = await call("PATCH", `/api/portal/addresses/${created.data.id}`, { zone: "WEST", phone: "123" });
    assert.equal(patched.data.zone, null);
    assert.equal(patched.data.phone, "123");
    assert.equal((await call("POST", "/api/portal/addresses", { label: "x" })).status, 422);
  });
});

describe("orders", () => {
  const draft = () => ({
    pickup_address_id: 1, delivery_address_id: 2, delivery_date: todayIso(2), lines: [{ item_id: 2, quantity: 5 }],
  });

  test("list is newest first and filters by status and date", async () => {
    const all = await call("GET", "/api/portal/orders");
    assert.ok(all.data.length >= 8);
    const created = all.data.map((o) => o.created_at as string);
    assert.deepEqual(created, [...created].sort().reverse());
    const closed = await call("GET", "/api/portal/orders?status=rejected&status=cancelled&status=exception");
    assert.deepEqual(new Set(closed.data.map((o) => o.status)), new Set(["rejected", "cancelled", "exception"]));
    const today = todayIso();
    const fromToday = await call("GET", `/api/portal/orders?from_date=${today}&to_date=${today}`);
    assert.ok(fromToday.data.every((o) => o.delivery_date === today));
    assert.equal((await call("GET", "/api/portal/orders?status=bogus")).status, 422);
  });

  test("create a draft, edit it, submit stores the quote, then cancel", async () => {
    const created = await call("POST", "/api/portal/orders", draft());
    assert.equal(created.status, 201);
    assert.equal(created.data.status, "draft");
    assert.equal((created.data.events as unknown[]).length, 1);
    const id = created.data.id;
    const patched = await call("PATCH", `/api/portal/orders/${id}`, { lines: [{ item_id: 4, quantity: 1 }], window_start: "09:00", window_end: "11:00" });
    assert.equal(patched.status, 200);
    assert.equal((patched.data.lines as unknown[]).length, 1);
    assert.equal(patched.data.window_start, "09:00:00");
    const submitted = await call("POST", `/api/portal/orders/${id}/submit`);
    assert.equal(submitted.data.status, "submitted");
    const quote = submitted.data.quote as Json;
    assert.equal(quote.zone_code, "NORTH");
    assert.equal(quote.amount, "427.50"); // 950 kg × 0.45
    assert.equal(submitted.data.amount, "427.50");
    assert.ok(quote.id != null);
    assert.equal((await call("POST", `/api/portal/orders/${id}/submit`)).status, 409);
    assert.equal((await call("PATCH", `/api/portal/orders/${id}`, { notes: "x" })).status, 409);
    const cancelled = await call("POST", `/api/portal/orders/${id}/cancel`, { note: "Changed plans" });
    assert.equal(cancelled.data.status, "cancelled");
    const events = cancelled.data.events as Json[];
    assert.deepEqual(events.map((e) => e.to_status), ["draft", "submitted", "cancelled"]);
    assert.equal(events[2].note, "Changed plans");
    assert.equal((await call("POST", `/api/portal/orders/${id}/cancel`)).status, 409);
  });

  test("validation: same addresses, duplicate items, past dates, archived refs", async () => {
    const same = await call("POST", "/api/portal/orders", { ...draft(), delivery_address_id: 1 });
    assert.equal(same.status, 422);
    assert.match(JSON.stringify(same.data.detail), /must be different/);
    const dup = await call("POST", "/api/portal/orders", { ...draft(), lines: [{ item_id: 2, quantity: 1 }, { item_id: 2, quantity: 2 }] });
    assert.match(JSON.stringify(dup.data.detail), /only once/);
    const past = await call("POST", "/api/portal/orders", { ...draft(), delivery_date: todayIso(-1) });
    assert.equal(past.status, 422);
    const archivedItem = await call("POST", "/api/portal/orders", { ...draft(), lines: [{ item_id: 11, quantity: 1 }] });
    assert.equal(archivedItem.status, 422);
    const archivedAddr = await call("POST", "/api/portal/orders", { ...draft(), delivery_address_id: 7 });
    assert.equal(archivedAddr.status, 422);
    const missing = await call("POST", "/api/portal/orders", { pickup_address_id: 1 });
    assert.equal(missing.status, 422);
    assert.ok((missing.data.detail as unknown[]).length >= 3);
  });

  test("seeded orders: rejected reason, delivered POD with a photo, accepted can't be cancelled", async () => {
    const rejected = await call("GET", "/api/portal/orders/8");
    const events = rejected.data.events as Json[];
    assert.equal(events.at(-1)?.to_status, "rejected");
    assert.ok(events.at(-1)?.note);
    const delivered = await call("GET", "/api/portal/orders/7");
    const pod = (delivered.data.pods as Json[])[0];
    assert.equal(delivered.data.status, "delivered");
    const photo = await call("GET", pod.photo_url as string);
    assert.equal(photo.status, 200);
    assert.match(photo.type ?? "", /^image\//);
    assert.equal((await call("POST", "/api/portal/orders/4/cancel")).status, 409);
  });

  test("quote preview prices without storing; unzoned is provisional", async () => {
    const zoned = await call("POST", "/api/portal/quote-preview", { delivery_address_id: 3, lines: [{ item_id: 5, quantity: 2 }] });
    assert.equal(zoned.status, 200);
    assert.equal(zoned.data.id, null);
    assert.equal(zoned.data.cubic_weight_kg, 225); // 0.9 m³ × 250 beats 18 kg
    assert.equal(zoned.data.amount, "123.75");
    const unzoned = await call("POST", "/api/portal/quote-preview", { delivery_address_id: 5, lines: [{ item_id: 2, quantity: 1 }] });
    assert.equal(unzoned.data.provisional, true);
    assert.equal(unzoned.data.amount, "12.00");
    assert.equal((await call("POST", "/api/portal/quote-preview", { delivery_address_id: 3, lines: [] })).status, 422);
  });
});
