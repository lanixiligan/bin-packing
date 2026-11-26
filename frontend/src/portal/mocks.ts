// Mock handlers for the portal API (used only with VITE_MOCK_API=1).
// An in-memory copy of one customer's data (Acme Hardware, company 1) plus a
// little of another company's, to show that other tenants' rows answer 404.
// The handlers follow docs/api.md: FastAPI-shaped 422s, 409 for a duplicate
// SKU and for invalid status changes, the real quote formula, and dangerous
// goods: items carry `dg`, lines copy it, orders list `dg_conflicts`.
import { fail, mock, newId, nowIso, ok, type MockRequest, type MockResponse } from "../api/mock.ts";
import { todayIso } from "../shell/format.ts";
import { DG_CLASSES, checkAll, isGeneral, normalise, validateDg, type DgInfo, type DgLike } from "../dg/rules.ts";
import { dgItemLabel } from "./logic.ts";
import type { Address, DgConflict, Item, Order, OrderEvent, OrderLine, OrderStatus, OrderSummary, Pod, Quote } from "./types.ts";

// ---- Pricing (same as backend/app/pricing.py) -------------------------------------

export const ZONE_RATES: Record<string, string> = { NORTH: "0.45", SOUTH: "0.50", WEST: "0.55" };
export const DEFAULT_RATE = "0.60";
const CUBIC_FACTOR = 250;

const round = (n: number, digits: number) => {
  const f = 10 ** digits;
  return Math.round((n + Number.EPSILON) * f) / f;
};

export function priceLines(zone: string | null, lines: { weightKg: number; volumeM3: number }[], stored = false): Quote {
  const kg = lines.reduce((s, l) => s + l.weightKg, 0);
  const m3 = lines.reduce((s, l) => s + l.volumeM3, 0);
  const cubic = Math.max(kg, m3 * CUBIC_FACTOR);
  const rate = zone && ZONE_RATES[zone] ? ZONE_RATES[zone] : DEFAULT_RATE;
  return {
    id: stored ? newId() : null,
    zone_code: zone && ZONE_RATES[zone] ? zone : null,
    total_weight_kg: round(kg, 3),
    total_volume_m3: round(m3, 4),
    cubic_weight_kg: round(cubic, 3),
    rate_per_kg: rate,
    amount: round(cubic * Number(rate), 2).toFixed(2),
    provisional: !(zone && ZONE_RATES[zone]),
    created_at: stored ? nowIso() : null,
  };
}

// ---- People --------------------------------------------------------------------------

const ALICE = { id: "00000000-0000-4000-8000-000000000001", name: "Alice Nguyen", role: "customer" } as const;
const BOB = { id: "00000000-0000-4000-8000-000000000004", name: "Bob Smith", role: "customer" } as const;
const DANA = { id: "00000000-0000-4000-8000-000000000002", name: "Dana Dispatcher", role: "dispatcher" } as const;
const DAVE = { id: "00000000-0000-4000-8000-000000000003", name: "Dave Driver", role: "driver" } as const;
type Actor = typeof ALICE | typeof BOB | typeof DANA | typeof DAVE;

const MY_COMPANY = 1;
const COMPANY_NAMES: Record<number, string> = { 1: "Acme Hardware", 2: "Bright Electrical" };

// ---- Store -----------------------------------------------------------------------------

interface OrderRecord {
  id: number;
  company_id: number;
  status: OrderStatus;
  pickup_address_id: number;
  delivery_address_id: number;
  delivery_date: string;
  window_start: string | null;
  window_end: string | null;
  customer_reference: string | null;
  notes: string | null;
  lines: OrderLine[];
  events: OrderEvent[];
  quote: Quote | null;
  pods: Pod[];
  plan_id: number | null;
  created_at: string;
  updated_at: string;
  submitted_at: string | null;
  delivered_at: string | null;
}

interface Store {
  items: Item[];
  addresses: Address[];
  orders: OrderRecord[];
}

let db: Store = seed();

/** Restore the seed data (used by tests). */
export function resetPortalMock() {
  db = seed();
}

function hoursAgo(h: number): string {
  return new Date(Date.now() - h * 3_600_000).toISOString();
}

function seed(): Store {
  const created = hoursAgo(24 * 60);
  const item = (id: number, sku: string, name: string, weight_kg: number, volume_m3: number, pallet_spaces: number,
    description: string | null = null, company_id = MY_COMPANY, archived = false): Item => ({
    id, company_id, sku, name, description, weight_kg, volume_m3, pallet_spaces, dg: null, archived, created_at: created,
  });
  const dgItem = (it: Item, dg: DgLike): Item => ({ ...it, dg: normalise(dg) });
  const items: Item[] = [
    item(1, "BOLT-M10-100", "M10 bolts, box of 100", 4.2, 0.003, 0, "Zinc-plated hex bolts with nuts."),
    item(2, "CEM-20", "Cement bag 20 kg", 20, 0.014, 0),
    item(3, "PLY-2400", "Plywood sheet 2400 × 1200 × 17", 28, 0.049, 0, "Structural plywood, sold per sheet."),
    item(4, "TILE-PAL", "Floor tiles, full pallet", 950, 0.9, 1, "Porcelain 600 × 600, 60 boxes."),
    item(5, "INS-BATT", "Insulation batts, pack", 9, 0.45, 0, "Light but bulky: priced by cubic weight."),
    item(6, "PAINT-15L", "Exterior paint 15 L", 18, 0.02, 0),
    item(7, "LADDER-6M", "Extension ladder 6 m", 16, 0.12, 0),
    item(8, "PINE-90-BDL", "Pine framing 90 × 45, bundle", 310, 0.6, 1, "Bundle of 24 lengths at 4.8 m."),
    item(9, "BARROW", "Wheelbarrow, boxed", 14, 0.18, 0),
    item(10, "PAVER-PAL", "Concrete pavers, pallet", 1100, 0.8, 1),
    item(11, "DRILL-18V", "Cordless drill 18 V (discontinued)", 3.5, 0.008, 0, null, MY_COMPANY, true),
    // Dangerous goods: pool chlorine can't share a vehicle with the thinners (5.1 × 3) or the acids (5.1 × 8);
    // the drain cleaner's Table 9.2 details aren't recorded, so with the acid it needs a check.
    dgItem(item(12, "POOL-CHLOR-10", "Pool chlorine granules 10 kg", 10.5, 0.012, 0, "Calcium hypochlorite, 65% available chlorine."),
      { dg_class: "5.1", packing_group: "II", un_number: "2880", t92: ["calcium_hypochlorite", "hypochlorite"] }),
    dgItem(item(13, "THINNERS-20L", "Paint thinners 20 L", 17, 0.024, 0),
      { dg_class: "3", packing_group: "II", un_number: "1263", container: "drum", t92: [] }),
    dgItem(item(14, "HCL-20L", "Hydrochloric acid 20 L", 23, 0.022, 0, "Pool and masonry acid, 32%."),
      { dg_class: "8", packing_group: "II", un_number: "1789", t92: ["acid_strong"] }),
    dgItem(item(15, "DRAIN-5L", "Drain cleaner 5 L", 6, 0.006, 0, "Sodium hydroxide solution."),
      { dg_class: "8", packing_group: "II", un_number: "1824", t92: null }),
    item(50, "CABLE-100M", "Cable drum 100 m", 45, 0.2, 0, null, 2),
  ];

  const addr = (id: number, label: string, line1: string, suburb: string, postcode: string, zone: string | null,
    extra: Partial<Address> = {}): Address => ({
    id, company_id: MY_COMPANY, label, contact_name: null, phone: null, line1, line2: null, suburb, state: "NSW",
    postcode, country: "AU", notes: null, zone, archived: false, created_at: created, ...extra,
  });
  const addresses: Address[] = [
    addr(1, "Botany distribution centre", "14 Foreshore Rd", "Botany", "2019", "SOUTH",
      { contact_name: "Sam Lee", phone: "02 9000 1001", notes: "Dock 3. Forklift on site." }),
    addr(2, "Hornsby store", "22 Peats Ferry Rd", "Hornsby", "2077", "NORTH", { contact_name: "Priya Shah", phone: "02 9000 2002" }),
    addr(3, "Parramatta store", "101 Church St", "Parramatta", "2150", "WEST", { line2: "Rear loading bay" }),
    addr(4, "Chatswood site office", "8 Victoria Ave", "Chatswood", "2067", "NORTH"),
    addr(5, "Bowral project site", "5 Bong Bong St", "Bowral", "2576", null, { contact_name: "Ken Wu", notes: "Call 30 min before arrival." }),
    addr(6, "Sutherland store", "40 Eton St", "Sutherland", "2232", "SOUTH"),
    addr(7, "Old Mascot depot", "3 Coward St", "Mascot", "2020", "SOUTH", { archived: true }),
    addr(60, "Bright Electrical HQ", "1 George St", "Sydney", "2000", "NORTH", { company_id: 2 }),
  ];

  const store: Store = { items, addresses, orders: [] };

  // Orders: each one replays its lifecycle so the timeline is consistent.
  type Step = [OrderStatus, Actor, string | null];
  const order = (id: number, o: {
    pickup: number; delivery: number; day: number; lines: [number, number][]; startedHoursAgo: number;
    steps: Step[]; lastHoursAgo?: number; ref?: string; notes?: string; window?: [string, string]; company?: number; by?: Actor;
  }) => {
    const t0 = o.startedHoursAgo;
    const rec: OrderRecord = {
      id, company_id: o.company ?? MY_COMPANY, status: "draft",
      pickup_address_id: o.pickup, delivery_address_id: o.delivery, delivery_date: todayIso(o.day),
      window_start: o.window?.[0] ?? null, window_end: o.window?.[1] ?? null,
      customer_reference: o.ref ?? null, notes: o.notes ?? null,
      lines: o.lines.map(([itemId, quantity]) => lineFrom(store, itemId, quantity)),
      events: [], quote: null, pods: [], plan_id: null,
      created_at: hoursAgo(t0), updated_at: hoursAgo(t0), submitted_at: null, delivered_at: null,
    };
    rec.events.push(event(null, "draft", o.by ?? ALICE, null, hoursAgo(t0)));
    o.steps.forEach(([to, actor, note], i) => {
      const last = o.lastHoursAgo ?? t0 / (o.steps.length + 1);
      const at = hoursAgo(t0 - ((t0 - last) * (i + 1)) / o.steps.length);
      if (to === "submitted") {
        rec.quote = { ...quoteForRecord(store, rec, true), created_at: at };
        rec.submitted_at = at;
      }
      if (to === "planned") rec.plan_id = 7;
      if (to === "delivered") {
        rec.delivered_at = at;
        rec.pods.push({
          id: 900 + id, order_id: id, signed_by: "R. Patel", note: "Left on the loading dock, signed by store manager.",
          created_at: at, driver_name: DAVE.name, photo_url: `/api/pods/${900 + id}/photo`,
        });
      }
      rec.events.push(event(rec.status, to, actor, note, at));
      rec.status = to;
      rec.updated_at = at;
    });
    store.orders.push(rec);
  };

  order(1, { pickup: 1, delivery: 2, day: 3, lines: [[2, 10], [6, 4]], startedHoursAgo: 3, steps: [], ref: "PO-4471" });
  order(2, { pickup: 1, delivery: 5, day: 6, lines: [[3, 20], [5, 12]], startedHoursAgo: 26, steps: [],
    notes: "Site has a narrow driveway; small truck preferred." });
  order(3, { pickup: 1, delivery: 3, day: 2, lines: [[4, 2], [9, 6]], startedHoursAgo: 30, window: ["08:00:00", "12:00:00"],
    ref: "PO-4460", steps: [["submitted", ALICE, null]] });
  order(4, { pickup: 1, delivery: 4, day: 1, lines: [[8, 1], [7, 3]], startedHoursAgo: 50, by: BOB,
    steps: [["submitted", BOB, null], ["accepted", DANA, "Booked on the north run."]] });
  order(5, { pickup: 1, delivery: 6, day: 1, lines: [[10, 1], [2, 30]], startedHoursAgo: 70, ref: "PO-4452",
    steps: [["submitted", ALICE, null], ["accepted", DANA, null], ["planned", DANA, null]] });
  order(6, { pickup: 1, delivery: 2, day: 0, lastHoursAgo: 1, lines: [[1, 12], [6, 8], [9, 2]], startedHoursAgo: 96, window: ["09:00:00", "15:00:00"],
    steps: [["submitted", ALICE, null], ["accepted", DANA, null], ["planned", DANA, null], ["picked_up", DAVE, null], ["in_transit", DAVE, null]] });
  order(7, { pickup: 1, delivery: 3, day: -1, lastHoursAgo: 20, lines: [[4, 1], [3, 10], [1, 5]], startedHoursAgo: 150, ref: "PO-4431",
    steps: [["submitted", ALICE, null], ["accepted", DANA, null], ["planned", DANA, null], ["picked_up", DAVE, null],
      ["in_transit", DAVE, null], ["delivered", DAVE, "Delivered to the rear loading bay."]] });
  order(8, { pickup: 1, delivery: 5, day: 4, lines: [[8, 2]], startedHoursAgo: 40, window: ["06:00:00", "07:00:00"],
    steps: [["submitted", ALICE, null], ["rejected", DANA,
      "We can't reach Bowral before 07:00. Please create a new order with a window after 10:00."]] });
  order(9, { pickup: 1, delivery: 6, day: 2, lines: [[7, 1]], startedHoursAgo: 20, ref: "PO-4468",
    steps: [["submitted", ALICE, null], ["cancelled", ALICE, "Ordered by mistake, collecting in store instead."]] });
  order(10, { pickup: 1, delivery: 4, day: -1, lastHoursAgo: 22, lines: [[10, 2]], startedHoursAgo: 80,
    steps: [["submitted", ALICE, null], ["accepted", DANA, null], ["planned", DANA, null], ["exception", DAVE,
      "Site gate locked and nobody answered the phone. Goods returned to the depot."]] });
  order(11, { pickup: 1, delivery: 6, day: 5, lines: [[12, 4], [13, 2], [14, 2], [15, 1]], startedHoursAgo: 4, steps: [],
    ref: "PO-4475", notes: "Pool supplies for the Sutherland store." });
  order(20, { pickup: 60, delivery: 60, day: 2, lines: [[50, 3]], startedHoursAgo: 10, steps: [], company: 2 });
  return store;
}

function event(from: OrderStatus | null, to: OrderStatus, actor: Actor, note: string | null, at: string): OrderEvent {
  return { id: newId(), from_status: from, to_status: to, actor_id: actor.id, actor_name: actor.name, actor_role: actor.role, note, created_at: at };
}

function lineFrom(store: Store, itemId: number, quantity: number): OrderLine {
  const it = store.items.find((i) => i.id === itemId)!;
  return {
    id: newId(), item_id: it.id, item_name: it.name, item_sku: it.sku, quantity,
    unit_weight_kg: it.weight_kg, unit_volume_m3: it.volume_m3, unit_pallet_spaces: it.pallet_spaces,
    dg: it.dg ?? null, dg_approval_ref: null,
  };
}

/** Pairs of lines that can't share a vehicle or need a Table 9.2 check (as backend/app/serializers.py). */
export function dgConflicts(lines: OrderLine[]): DgConflict[] {
  return checkAll(lines, (l) => l.dg).map((c) => {
    const items = [dgItemLabel(c.a.item_name, c.a.dg), dgItemLabel(c.b.item_name, c.b.dg)];
    const reasons = c.reasons.join(" ");
    return {
      status: c.status,
      order_line_ids: [c.a.id, c.b.id],
      items,
      message: c.status === "incompatible"
        ? `${items[0]} and ${items[1]} can't travel on the same vehicle. ${reasons}`
        : `Check ${items[0]} with ${items[1]}: ${reasons}`,
    };
  });
}

function quoteForRecord(store: Store, rec: OrderRecord, stored: boolean): Quote {
  const zone = store.addresses.find((a) => a.id === rec.delivery_address_id)?.zone ?? null;
  return priceLines(zone, rec.lines.map((l) => ({ weightKg: l.unit_weight_kg * l.quantity, volumeM3: l.unit_volume_m3 * l.quantity })), stored);
}

// ---- Serialisation -------------------------------------------------------------------

function summary(rec: OrderRecord): OrderSummary {
  const pickup = db.addresses.find((a) => a.id === rec.pickup_address_id)!;
  const delivery = db.addresses.find((a) => a.id === rec.delivery_address_id)!;
  const sum = (f: (l: OrderLine) => number) => rec.lines.reduce((s, l) => s + f(l), 0);
  return {
    id: rec.id,
    reference: `ORD-${String(rec.id).padStart(6, "0")}`,
    status: rec.status,
    company_id: rec.company_id,
    company_name: COMPANY_NAMES[rec.company_id] ?? "",
    delivery_date: rec.delivery_date,
    window_start: rec.window_start,
    window_end: rec.window_end,
    customer_reference: rec.customer_reference,
    pickup_label: pickup.label,
    delivery_label: delivery.label,
    delivery_suburb: delivery.suburb,
    zone: delivery.zone,
    line_count: rec.lines.length,
    total_units: sum((l) => l.quantity),
    total_weight_kg: round(sum((l) => l.quantity * l.unit_weight_kg), 3),
    total_volume_m3: round(sum((l) => l.quantity * l.unit_volume_m3), 4),
    total_pallet_spaces: round(sum((l) => l.quantity * l.unit_pallet_spaces), 2),
    amount: rec.quote?.amount ?? null,
    plan_id: rec.plan_id,
    created_at: rec.created_at,
    updated_at: rec.updated_at,
  };
}

function detail(rec: OrderRecord): Order {
  return {
    ...summary(rec),
    pickup_address: db.addresses.find((a) => a.id === rec.pickup_address_id)!,
    delivery_address: db.addresses.find((a) => a.id === rec.delivery_address_id)!,
    notes: rec.notes,
    lines: rec.lines,
    dg_conflicts: dgConflicts(rec.lines),
    events: rec.events,
    quote: rec.quote,
    pods: rec.pods,
    submitted_at: rec.submitted_at,
    delivered_at: rec.delivered_at,
  };
}

// ---- FastAPI-like validation -------------------------------------------------------

interface Issue {
  type: string;
  loc: (string | number)[];
  msg: string;
  input?: unknown;
}
type Body = Record<string, unknown>;

const invalid = (issues: Issue[]): MockResponse => fail(422, issues);

function checkStr(body: Body, field: string, issues: Issue[], o: { min?: number; max: number; required?: boolean; nullable?: boolean }, loc: (string | number)[] = ["body", field]) {
  if (!(field in body) || body[field] === undefined) {
    if (o.required) issues.push({ type: "missing", loc, msg: "Field required", input: body });
    return;
  }
  const v = body[field];
  if (v === null) {
    if (!o.nullable && o.required) issues.push({ type: "string_type", loc, msg: "Input should be a valid string", input: v });
    return;
  }
  if (typeof v !== "string") return void issues.push({ type: "string_type", loc, msg: "Input should be a valid string", input: v });
  if (o.min && v.length < o.min) issues.push({ type: "string_too_short", loc, msg: `String should have at least ${o.min} character${o.min === 1 ? "" : "s"}`, input: v });
  if (v.length > o.max) issues.push({ type: "string_too_long", loc, msg: `String should have at most ${o.max} characters`, input: v });
}

function checkNum(body: Body, field: string, issues: Issue[], o: { gt?: number; ge?: number; le?: number; required?: boolean; int?: boolean }, loc: (string | number)[] = ["body", field]) {
  if (!(field in body) || body[field] === undefined) {
    if (o.required) issues.push({ type: "missing", loc, msg: "Field required", input: body });
    return;
  }
  const v = body[field];
  if (v === null) {
    if (o.required) issues.push({ type: o.int ? "int_type" : "float_type", loc, msg: `Input should be a valid ${o.int ? "integer" : "number"}`, input: v });
    return;
  }
  if (typeof v !== "number" || !Number.isFinite(v)) return void issues.push({ type: o.int ? "int_type" : "float_type", loc, msg: `Input should be a valid ${o.int ? "integer" : "number"}`, input: v });
  if (o.int && !Number.isInteger(v)) return void issues.push({ type: "int_from_float", loc, msg: "Input should be a valid integer, got a number with a fractional part", input: v });
  if (o.gt != null && !(v > o.gt)) issues.push({ type: "greater_than", loc, msg: `Input should be greater than ${o.gt}`, input: v });
  if (o.ge != null && !(v >= o.ge)) issues.push({ type: "greater_than_equal", loc, msg: `Input should be greater than or equal to ${o.ge}`, input: v });
  if (o.le != null && !(v <= o.le)) issues.push({ type: "less_than_equal", loc, msg: `Input should be less than or equal to ${o.le}`, input: v });
}

function checkPattern(body: Body, field: string, issues: Issue[], re: RegExp, type: string, msg: string, required = false) {
  const v = body[field];
  if (v === undefined) {
    if (required) issues.push({ type: "missing", loc: ["body", field], msg: "Field required", input: body });
    return;
  }
  if (v === null && !required) return;
  if (typeof v !== "string" || !re.test(v)) issues.push({ type, loc: ["body", field], msg, input: v });
}

/** The JSON body as an object, or FastAPI's 422 for a missing / non-object body. */
function parseBody(raw: unknown): { body: Body; error?: undefined } | { error: MockResponse; body?: undefined } {
  if (raw === undefined) return { error: invalid([{ type: "missing", loc: ["body"], msg: "Field required", input: null }]) };
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { error: invalid([{ type: "model_attributes_type", loc: ["body"], msg: "Input should be a valid dictionary or object to extract fields from", input: raw }]) };
  }
  return { body: raw as Body };
}

function pathId(req: MockRequest, key: string): number | MockResponse {
  const raw = req.params[key];
  if (!/^-?\d+$/.test(raw)) {
    return invalid([{ type: "int_parsing", loc: ["path", key], msg: "Input should be a valid integer, unable to parse string as an integer", input: raw }]);
  }
  return Number(raw);
}

const truthy = (v: string | null) => v != null && ["1", "true", "yes", "on"].includes(v.toLowerCase());
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;
const normTime = (t: unknown) => (typeof t === "string" ? (t.length === 5 ? `${t}:00` : t) : null);

/** Wrap a handler: customers only, and resolve the caller's company. */
function customer(handler: (req: MockRequest, company: number) => MockResponse | Promise<MockResponse>) {
  return (req: MockRequest) => {
    if (!req.role) return fail(401, "Unauthorized");
    if (req.role !== "customer") return fail(403, "This needs the customer role.");
    return handler(req, MY_COMPANY);
  };
}

// ---- Items ---------------------------------------------------------------------------

function itemIssues(body: Body, partial: boolean): Issue[] {
  const issues: Issue[] = [];
  const required = !partial;
  checkStr(body, "sku", issues, { min: 1, max: 64, required });
  checkStr(body, "name", issues, { min: 1, max: 200, required });
  checkStr(body, "description", issues, { max: 1000, nullable: true });
  checkNum(body, "weight_kg", issues, { gt: 0, le: 100_000, required });
  checkNum(body, "volume_m3", issues, { ge: 0, le: 1_000 });
  checkNum(body, "pallet_spaces", issues, { ge: 0, le: 100 });
  dgIssues(body, issues);
  return issues;
}

const DG_KEYS = ["dg_class", "subsidiary", "packing_group", "un_number", "explosive_code", "container", "t92", "carrier_tags", "food", "fire_risk"];

/** The DgInfo model's checks (backend/app/dg.py): field errors first, then its model validator. */
function dgIssues(body: Body, issues: Issue[]) {
  const raw = body.dg;
  if (raw === undefined || raw === null) return;
  const loc = ["body", "dg"];
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return void issues.push({ type: "model_type", loc, msg: "Input should be a valid dictionary or instance of DgInfo", input: raw });
  }
  const d = raw as Body;
  const before = issues.length;
  for (const key of Object.keys(d)) {
    if (!DG_KEYS.includes(key)) issues.push({ type: "extra_forbidden", loc: [...loc, key], msg: "Extra inputs are not permitted", input: d[key] });
  }
  if (d.dg_class != null && !(DG_CLASSES as unknown[]).includes(d.dg_class)) {
    issues.push({ type: "literal_error", loc: [...loc, "dg_class"], msg: `Input should be ${DG_CLASSES.map((c) => `'${c}'`).join(", ")}`, input: d.dg_class });
  }
  if (d.un_number != null && (typeof d.un_number !== "string" || !/^\d{4}$/.test(d.un_number))) {
    issues.push({ type: "string_pattern_mismatch", loc: [...loc, "un_number"], msg: "String should match pattern '^\\d{4}$'", input: d.un_number });
  }
  if (Array.isArray(d.subsidiary) && d.subsidiary.length > 4) {
    issues.push({ type: "too_long", loc: [...loc, "subsidiary"], msg: `List should have at most 4 items after validation, not ${d.subsidiary.length}`, input: d.subsidiary });
  }
  if (issues.length > before) return;
  const dg = d as DgLike;
  let msg: string | undefined;
  if (!dg?.dg_class) {
    if (dg?.subsidiary?.length || dg?.packing_group || dg?.un_number || dg?.explosive_code || dg?.t92?.length || dg?.carrier_tags?.length) {
      msg = "Choose a DG class before you add DG details, or clear them.";
    }
  } else if (dg.food) msg = "Dangerous goods can't be marked as food.";
  else if (dg.dg_class !== "1" && dg.explosive_code) msg = "The explosive code is only for Class 1.";
  msg ??= validateDg(dg)[0];
  if (msg) issues.push({ type: "value_error", loc, msg: `Value error, ${msg}`, input: raw });
}

/** What's stored in `items.dg`: null for general freight, else the DgInfo with its defaults. */
const storeDg = (raw: unknown): DgInfo | null => (isGeneral(raw as DgLike) ? null : normalise(raw as DgLike));

const skuTaken = (company: number, sku: string, exceptId?: number) =>
  db.items.some((i) => i.company_id === company && i.id !== exceptId && i.sku.toLowerCase() === sku.trim().toLowerCase());
const findItem = (company: number, id: number) => db.items.find((i) => i.id === id && i.company_id === company);

mock("get", "/api/portal/items", customer(({ query }, company) =>
  ok(db.items
    .filter((i) => i.company_id === company && (truthy(query.get("include_archived")) || !i.archived))
    .sort((a, b) => a.sku.localeCompare(b.sku)))));

mock("post", "/api/portal/items", customer(({ body: raw }, company) => {
  const { body, error } = parseBody(raw);
  if (error) return error;
  const issues = itemIssues(body, false);
  if (issues.length) return invalid(issues);
  const sku = String(body.sku).trim();
  if (skuTaken(company, sku)) return fail(409, `An item with SKU ${sku} already exists.`);
  const item: Item = {
    id: newId(), company_id: company, sku, name: String(body.name).trim(),
    description: (body.description as string | null | undefined) ?? null,
    weight_kg: body.weight_kg as number, volume_m3: (body.volume_m3 as number | undefined) ?? 0,
    pallet_spaces: (body.pallet_spaces as number | undefined) ?? 0, dg: storeDg(body.dg), archived: false, created_at: nowIso(),
  };
  db.items.push(item);
  return ok(item, 201);
}));

mock("get", "/api/portal/items/{item_id}", customer((req, company) => {
  const id = pathId(req, "item_id");
  if (typeof id !== "number") return id;
  const item = findItem(company, id);
  return item ? ok(item) : fail(404, "Item not found.");
}));

mock("patch", "/api/portal/items/{item_id}", customer((req, company) => {
  const id = pathId(req, "item_id");
  if (typeof id !== "number") return id;
  const { body, error } = parseBody(req.body);
  if (error) return error;
  const issues = itemIssues(body, true);
  if (issues.length) return invalid(issues);
  const item = findItem(company, id);
  if (!item) return fail(404, "Item not found.");
  if (typeof body.sku === "string" && skuTaken(company, body.sku, id)) return fail(409, `An item with SKU ${body.sku.trim()} already exists.`);
  for (const key of ["sku", "name", "description", "weight_kg", "volume_m3", "pallet_spaces"] as const) {
    if (!(key in body)) continue;
    const v = body[key];
    if (v === null && key !== "description") continue; // not nullable columns: ignore
    (item as Record<string, unknown>)[key] = typeof v === "string" && key !== "description" ? v.trim() : v;
  }
  if ("dg" in body) item.dg = storeDg(body.dg); // null clears it
  return ok(item);
}));

mock("delete", "/api/portal/items/{item_id}", customer((req, company) => {
  const id = pathId(req, "item_id");
  if (typeof id !== "number") return id;
  const item = findItem(company, id);
  if (!item) return fail(404, "Item not found.");
  item.archived = true;
  return { status: 204 };
}));

// ---- Addresses ------------------------------------------------------------------------

function addressIssues(body: Body, partial: boolean): Issue[] {
  const issues: Issue[] = [];
  const required = !partial;
  checkStr(body, "label", issues, { min: 1, max: 100, required });
  checkStr(body, "contact_name", issues, { max: 200, nullable: true });
  checkStr(body, "phone", issues, { max: 50, nullable: true });
  checkStr(body, "line1", issues, { min: 1, max: 200, required });
  checkStr(body, "line2", issues, { max: 200, nullable: true });
  checkStr(body, "suburb", issues, { min: 1, max: 100, required });
  checkStr(body, "state", issues, { min: 1, max: 50, required });
  checkStr(body, "postcode", issues, { min: 3, max: 10, required });
  checkStr(body, "country", issues, { min: 2, max: 2 });
  checkStr(body, "notes", issues, { max: 1000, nullable: true });
  return issues;
}

const ADDRESS_FIELDS = ["label", "contact_name", "phone", "line1", "line2", "suburb", "state", "postcode", "country", "notes"] as const;
const NULLABLE_ADDRESS_FIELDS = new Set(["contact_name", "phone", "line2", "notes"]);
const findAddress = (company: number, id: number) => db.addresses.find((a) => a.id === id && a.company_id === company);

mock("get", "/api/portal/addresses", customer(({ query }, company) =>
  ok(db.addresses
    .filter((a) => a.company_id === company && (truthy(query.get("include_archived")) || !a.archived))
    .sort((a, b) => a.label.localeCompare(b.label)))));

mock("post", "/api/portal/addresses", customer(({ body: raw }, company) => {
  const { body, error } = parseBody(raw);
  if (error) return error;
  const issues = addressIssues(body, false);
  if (issues.length) return invalid(issues);
  const a: Address = {
    id: newId(), company_id: company, label: "", contact_name: null, phone: null, line1: "", line2: null,
    suburb: "", state: "", postcode: "", country: "AU", notes: null, zone: null, archived: false, created_at: nowIso(),
  };
  for (const key of ADDRESS_FIELDS) if (body[key] !== undefined) (a as Record<string, unknown>)[key] = body[key];
  db.addresses.push(a);
  return ok(a, 201);
}));

mock("get", "/api/portal/addresses/{address_id}", customer((req, company) => {
  const id = pathId(req, "address_id");
  if (typeof id !== "number") return id;
  const a = findAddress(company, id);
  return a ? ok(a) : fail(404, "Address not found.");
}));

mock("patch", "/api/portal/addresses/{address_id}", customer((req, company) => {
  const id = pathId(req, "address_id");
  if (typeof id !== "number") return id;
  const { body, error } = parseBody(req.body);
  if (error) return error;
  const issues = addressIssues(body, true);
  if (issues.length) return invalid(issues);
  const a = findAddress(company, id);
  if (!a) return fail(404, "Address not found.");
  // `zone` is not part of AddressUpdate: like FastAPI, unknown fields are ignored.
  for (const key of ADDRESS_FIELDS) {
    if (!(key in body)) continue;
    if (body[key] === null && !NULLABLE_ADDRESS_FIELDS.has(key)) continue;
    (a as Record<string, unknown>)[key] = body[key];
  }
  return ok(a);
}));

mock("delete", "/api/portal/addresses/{address_id}", customer((req, company) => {
  const id = pathId(req, "address_id");
  if (typeof id !== "number") return id;
  const a = findAddress(company, id);
  if (!a) return fail(404, "Address not found.");
  a.archived = true;
  return { status: 204 };
}));

// ---- Orders: shared checks ------------------------------------------------------------

function lineIssues(body: Body, issues: Issue[], required: boolean) {
  if (!("lines" in body) || body.lines === undefined) {
    if (required) issues.push({ type: "missing", loc: ["body", "lines"], msg: "Field required", input: body });
    return;
  }
  const lines = body.lines;
  if (lines === null && !required) return;
  if (!Array.isArray(lines)) return void issues.push({ type: "list_type", loc: ["body", "lines"], msg: "Input should be a valid list", input: lines });
  if (lines.length < 1) issues.push({ type: "too_short", loc: ["body", "lines"], msg: "List should have at least 1 item after validation, not 0", input: lines });
  if (lines.length > 100) issues.push({ type: "too_long", loc: ["body", "lines"], msg: `List should have at most 100 items after validation, not ${lines.length}`, input: lines });
  lines.forEach((ln, i) => {
    if (typeof ln !== "object" || ln === null) return void issues.push({ type: "model_type", loc: ["body", "lines", i], msg: "Input should be a valid dictionary", input: ln });
    checkNum(ln as Body, "item_id", issues, { required: true, int: true }, ["body", "lines", i, "item_id"]);
    checkNum(ln as Body, "quantity", issues, { required: true, int: true, ge: 1, le: 10_000 }, ["body", "lines", i, "quantity"]);
  });
}

function orderIssues(body: Body, partial: boolean): Issue[] {
  const issues: Issue[] = [];
  const required = !partial;
  checkNum(body, "pickup_address_id", issues, { required, int: true });
  checkNum(body, "delivery_address_id", issues, { required, int: true });
  checkPattern(body, "delivery_date", issues, DATE_RE, "date_from_datetime_parsing", "Input should be a valid date or datetime, input is too short", required);
  checkPattern(body, "window_start", issues, TIME_RE, "time_parsing", "Input should be in a valid time format, invalid character in hour");
  checkPattern(body, "window_end", issues, TIME_RE, "time_parsing", "Input should be in a valid time format, invalid character in hour");
  checkStr(body, "customer_reference", issues, { max: 64, nullable: true });
  checkStr(body, "notes", issues, { max: 1000, nullable: true });
  lineIssues(body, issues, required);
  if (issues.length) return issues;
  // The model validator in schemas._OrderFields.
  const p = body.pickup_address_id, d = body.delivery_address_id;
  const valueError = (msg: string) => issues.push({ type: "value_error", loc: ["body"], msg: `Value error, ${msg}`, input: body });
  if (p != null && d != null && p === d) valueError("Pickup and delivery addresses must be different.");
  else if (typeof body.window_start === "string" && typeof body.window_end === "string" && normTime(body.window_start)! >= normTime(body.window_end)!) {
    valueError("The delivery window must end after it starts.");
  } else if (Array.isArray(body.lines) && new Set((body.lines as Body[]).map((l) => l.item_id)).size !== body.lines.length) {
    valueError("Each item may appear only once per order; combine the quantities.");
  }
  // Assumption (see report): the API refuses delivery dates in the past.
  if (typeof body.delivery_date === "string" && body.delivery_date < todayIso()) {
    issues.push({ type: "value_error", loc: ["body", "delivery_date"], msg: "Value error, The delivery date can't be in the past.", input: body.delivery_date });
  }
  return issues;
}

/** Addresses and items must be the caller's and not archived. Returns an error message or null. */
function referenceError(company: number, pickup: number, delivery: number, lines: { item_id: number }[]): string | null {
  for (const [id, role] of [[pickup, "pickup"], [delivery, "delivery"]] as const) {
    const a = findAddress(company, id);
    if (!a) return `The ${role} address (${id}) was not found.`;
    if (a.archived) return `The ${role} address “${a.label}” is archived.`;
  }
  for (const l of lines) {
    const it = findItem(company, l.item_id);
    if (!it) return `Item ${l.item_id} was not found.`;
    if (it.archived) return `Item ${it.sku} is archived and can't be ordered.`;
  }
  return null;
}

const findOrder = (company: number, id: number) => db.orders.find((o) => o.id === id && o.company_id === company);
const label = (s: OrderStatus) => s.replace("_", " ");

function transition(rec: OrderRecord, to: OrderStatus, allowedFrom: OrderStatus[], note: unknown): MockResponse | null {
  if (!allowedFrom.includes(rec.status)) return fail(409, `An order that is ${label(rec.status)} cannot become ${label(to)}.`);
  const at = nowIso();
  const text = typeof note === "string" && note.trim() ? note.trim() : null;
  rec.events.push(event(rec.status, to, ALICE, text, at));
  rec.status = to;
  rec.updated_at = at;
  if (to === "submitted") rec.submitted_at = at;
  return null;
}

function noteIssues(body: unknown): Issue[] {
  if (body === undefined || body === null) return [];
  if (typeof body !== "object" || Array.isArray(body)) return [{ type: "model_attributes_type", loc: ["body"], msg: "Input should be a valid dictionary or object to extract fields from", input: body }];
  const issues: Issue[] = [];
  checkStr(body as Body, "note", issues, { max: 1000, nullable: true });
  return issues;
}

// ---- Quote preview --------------------------------------------------------------------

mock("post", "/api/portal/quote-preview", customer(({ body: raw }, company) => {
  const { body, error } = parseBody(raw);
  if (error) return error;
  const issues: Issue[] = [];
  checkNum(body, "delivery_address_id", issues, { required: true, int: true });
  lineIssues(body, issues, true);
  if (issues.length) return invalid(issues);
  const addr = findAddress(company, body.delivery_address_id as number);
  if (!addr) return fail(404, "Address not found.");
  const lines = body.lines as { item_id: number; quantity: number }[];
  const priced: { weightKg: number; volumeM3: number }[] = [];
  for (const l of lines) {
    const it = findItem(company, l.item_id);
    if (!it) return fail(404, `Item ${l.item_id} not found.`);
    priced.push({ weightKg: it.weight_kg * l.quantity, volumeM3: it.volume_m3 * l.quantity });
  }
  return ok(priceLines(addr.zone, priced));
}));

// ---- Orders ----------------------------------------------------------------------------

const ALL_STATUSES: OrderStatus[] = ["draft", "submitted", "accepted", "rejected", "cancelled", "planned", "picked_up", "in_transit", "delivered", "exception"];

mock("get", "/api/portal/orders", customer(({ query }, company) => {
  const issues: Issue[] = [];
  const statuses = query.getAll("status");
  statuses.forEach((s, i) => {
    if (!ALL_STATUSES.includes(s as OrderStatus)) {
      issues.push({ type: "enum", loc: ["query", "status", i], msg: `Input should be ${ALL_STATUSES.map((x) => `'${x}'`).join(", ")}`, input: s });
    }
  });
  const from = query.get("from_date"), to = query.get("to_date");
  for (const [key, v] of [["from_date", from], ["to_date", to]] as const) {
    if (v && !DATE_RE.test(v)) issues.push({ type: "date_from_datetime_parsing", loc: ["query", key], msg: "Input should be a valid date or datetime, input is too short", input: v });
  }
  const limit = Number(query.get("limit") ?? 200), offset = Number(query.get("offset") ?? 0);
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) issues.push({ type: "less_than_equal", loc: ["query", "limit"], msg: "Input should be less than or equal to 500", input: query.get("limit") });
  if (!Number.isInteger(offset) || offset < 0) issues.push({ type: "greater_than_equal", loc: ["query", "offset"], msg: "Input should be greater than or equal to 0", input: query.get("offset") });
  if (issues.length) return invalid(issues);
  const rows = db.orders
    .filter((o) => o.company_id === company)
    .filter((o) => !statuses.length || statuses.includes(o.status))
    .filter((o) => (!from || o.delivery_date >= from) && (!to || o.delivery_date <= to))
    .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id)
    .slice(offset, offset + limit);
  return ok(rows.map(summary));
}));

mock("post", "/api/portal/orders", customer(({ body: raw }, company) => {
  const { body, error } = parseBody(raw);
  if (error) return error;
  const issues = orderIssues(body, false);
  if (issues.length) return invalid(issues);
  const lines = body.lines as { item_id: number; quantity: number }[];
  const err = referenceError(company, body.pickup_address_id as number, body.delivery_address_id as number, lines);
  if (err) return fail(422, err);
  const at = nowIso();
  const rec: OrderRecord = {
    id: newId(), company_id: company, status: "draft",
    pickup_address_id: body.pickup_address_id as number, delivery_address_id: body.delivery_address_id as number,
    delivery_date: body.delivery_date as string, window_start: normTime(body.window_start), window_end: normTime(body.window_end),
    customer_reference: (body.customer_reference as string | null | undefined) ?? null, notes: (body.notes as string | null | undefined) ?? null,
    lines: lines.map((l) => lineFrom(db, l.item_id, l.quantity)),
    events: [event(null, "draft", ALICE, null, at)], quote: null, pods: [], plan_id: null,
    created_at: at, updated_at: at, submitted_at: null, delivered_at: null,
  };
  db.orders.push(rec);
  return ok(detail(rec), 201);
}));

mock("get", "/api/portal/orders/{order_id}", customer((req, company) => {
  const id = pathId(req, "order_id");
  if (typeof id !== "number") return id;
  const rec = findOrder(company, id);
  return rec ? ok(detail(rec)) : fail(404, "Order not found.");
}));

mock("patch", "/api/portal/orders/{order_id}", customer((req, company) => {
  const id = pathId(req, "order_id");
  if (typeof id !== "number") return id;
  const { body, error } = parseBody(req.body);
  if (error) return error;
  const issues = orderIssues(body, true);
  if (issues.length) return invalid(issues);
  const rec = findOrder(company, id);
  if (!rec) return fail(404, "Order not found.");
  if (rec.status !== "draft") return fail(409, `Only draft orders can be changed; this order is ${label(rec.status)}.`);
  const pickup = (body.pickup_address_id as number | undefined) ?? rec.pickup_address_id;
  const delivery = (body.delivery_address_id as number | undefined) ?? rec.delivery_address_id;
  if (pickup === delivery) return fail(422, "Pickup and delivery addresses must be different.");
  const ws = "window_start" in body ? normTime(body.window_start) : rec.window_start;
  const we = "window_end" in body ? normTime(body.window_end) : rec.window_end;
  if (ws && we && ws >= we) return fail(422, "The delivery window must end after it starts.");
  const lines = (body.lines as { item_id: number; quantity: number }[] | undefined) ?? null;
  const err = referenceError(company, pickup, delivery, lines ?? []);
  if (err) return fail(422, err);
  rec.pickup_address_id = pickup;
  rec.delivery_address_id = delivery;
  rec.window_start = ws;
  rec.window_end = we;
  if (typeof body.delivery_date === "string") rec.delivery_date = body.delivery_date;
  if ("customer_reference" in body) rec.customer_reference = (body.customer_reference as string | null) ?? null;
  if ("notes" in body) rec.notes = (body.notes as string | null) ?? null;
  if (lines) rec.lines = lines.map((l) => lineFrom(db, l.item_id, l.quantity));
  rec.updated_at = nowIso();
  return ok(detail(rec));
}));

mock("post", "/api/portal/orders/{order_id}/submit", customer((req, company) => {
  const id = pathId(req, "order_id");
  if (typeof id !== "number") return id;
  const issues = noteIssues(req.body);
  if (issues.length) return invalid(issues);
  const rec = findOrder(company, id);
  if (!rec) return fail(404, "Order not found.");
  if (rec.status === "draft") {
    const err = referenceError(company, rec.pickup_address_id, rec.delivery_address_id, rec.lines);
    if (err) return fail(422, err);
  }
  const conflict = transition(rec, "submitted", ["draft"], (req.body as Body | undefined)?.note);
  if (conflict) return conflict;
  rec.quote = quoteForRecord(db, rec, true);
  return ok(detail(rec));
}));

mock("post", "/api/portal/orders/{order_id}/cancel", customer((req, company) => {
  const id = pathId(req, "order_id");
  if (typeof id !== "number") return id;
  const issues = noteIssues(req.body);
  if (issues.length) return invalid(issues);
  const rec = findOrder(company, id);
  if (!rec) return fail(404, "Order not found.");
  const conflict = transition(rec, "cancelled", ["draft", "submitted"], (req.body as Body | undefined)?.note);
  return conflict ?? ok(detail(rec));
}));

// ---- POD photos -----------------------------------------------------------------------

const xml = (s: string) => s.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);

mock("get", "/api/pods/{pod_id}/photo", (req) => {
  if (!req.role) return fail(401, "Unauthorized");
  const id = pathId(req, "pod_id");
  if (typeof id !== "number") return id;
  const rec = db.orders.find((o) => o.pods.some((p) => p.id === id));
  const pod = rec?.pods.find((p) => p.id === id);
  if (!rec || !pod || (req.role === "customer" && rec.company_id !== MY_COMPANY)) return fail(404, "Photo not found.");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="320" viewBox="0 0 480 320">
<rect width="480" height="320" fill="#c9d3e3"/><rect x="0" y="230" width="480" height="90" fill="#8f99a8"/>
<rect x="150" y="110" width="180" height="130" fill="#b07b45" stroke="#6b4a26" stroke-width="4"/>
<path d="M150 150h180M240 110v130" stroke="#6b4a26" stroke-width="3"/>
<text x="20" y="40" font-family="sans-serif" font-size="22" fill="#1d2433">Proof of delivery</text>
<text x="20" y="300" font-family="sans-serif" font-size="18" fill="#fff">Signed by ${xml(pod.signed_by)}</text></svg>`;
  return { status: 200, body: new Blob([svg], { type: "image/svg+xml" }), headers: { "content-type": "image/svg+xml" } };
});
