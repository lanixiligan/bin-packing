// In-memory data behind the ops and driver mock APIs (VITE_MOCK_API=1).
// Shared by ops/mocks.ts and driver/mocks.ts so that what the dispatcher
// locks shows up on the driver's run, and what the driver delivers shows up
// on the invoices. Dates are relative to today, so the data never goes stale.
//
// Imports use explicit .ts extensions (and type-only imports) so the tests
// can load this module with `node --test`.
import type { Schemas } from "../api/client";
import { addUsage, emptyUsage, fillPercent, lowerBounds, overDims, type CapacityLimits, type UsageTotals } from "../components/capacity.ts";
import { exact, ffd, misfits, totalsOf, type Unit } from "./packing.ts";

type S = Schemas;
export type OrderStatus = S["OrderStatus"];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let seq = 100_000;
export const nextId = () => ++seq;

const pad = (n: number) => String(n).padStart(2, "0");
/** Local calendar date "YYYY-MM-DD", `offset` days from today. */
export function isoDay(offset = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
/** ISO timestamp `days` days from now at local hh:mm. */
function stamp(days: number, hh = 9, mm = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hh, mm, 0, 0);
  return d.toISOString();
}
const now = () => new Date().toISOString();
/** "YYYY-MM" of a timestamp in local time. */
export const monthOf = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
};
const round2 = (n: number) => Math.round(n * 100) / 100;
const money = (n: number) => round2(n).toFixed(2);

/** Errors thrown by the data layer; handlers turn them into responses. */
export class MockHttpError extends Error {
  status: number;
  detail: unknown;
  constructor(status: number, detail: unknown) {
    super(typeof detail === "string" ? detail : "Mock API error");
    this.status = status;
    this.detail = detail;
  }
}
export const httpError = (status: number, detail: unknown) => new MockHttpError(status, detail);
/** FastAPI-style validation error. */
export const validationError = (msg: string, loc: (string | number)[] = ["body"]) =>
  new MockHttpError(422, [{ loc, msg, type: "value_error" }]);

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------

export interface Company { id: number; name: string }
export interface ItemRec { id: number; company_id: number; sku: string; name: string; weight_kg: number; volume_m3: number; pallet_spaces: number }
export interface LineRec { id: number; item_id: number; quantity: number }
export interface EventRec { id: number; from_status: OrderStatus | null; to_status: OrderStatus; actor: Actor | null; note: string | null; created_at: string }
export interface PodRec { id: number; order_id: number; signed_by: string; note: string | null; created_at: string; driver_id: number; photo: Blob }
export interface QuoteRec { id: number; zone_code: string | null; rate: number; provisional: boolean; created_at: string }
export interface OrderRec {
  id: number;
  reference: string;
  company_id: number;
  status: OrderStatus;
  pickup_address_id: number;
  delivery_address_id: number;
  delivery_date: string;
  window_start: string | null;
  window_end: string | null;
  customer_reference: string | null;
  notes: string | null;
  lines: LineRec[];
  events: EventRec[];
  quote: QuoteRec | null;
  pod_ids: number[];
  plan_id: number | null;
  created_at: string;
  updated_at: string;
  submitted_at: string | null;
  delivered_at: string | null;
}
export interface AssignmentRec { id: number; order_line_id: number; quantity: number }
export interface LoadRec { id: number; number: number; vehicle_id: number | null; driver_id: number | null; assignments: AssignmentRec[] }
export interface PlanRec {
  id: number;
  delivery_date: string;
  zone: string;
  status: "draft" | "locked";
  vehicle_id: number;
  job_id: string;
  method: "ffd" | "ortools" | null;
  order_ids: number[];
  loads: LoadRec[];
  created_at: string;
  locked_at: string | null;
}
export interface JobRec {
  id: string;
  plan_id: number;
  created_ms: number;
  /** Mock timing: queued for `queuedMs`, then running until `doneMs`. */
  queuedMs: number;
  doneMs: number;
  time_limit_s: number;
  result: S["SolveResult"] | null;
  error: string | null;
}
interface Actor { id: string; name: string; role: S["UserRole"] }

const DISPATCHER: Actor = { id: "00000000-0000-4000-8000-000000000002", name: "Dana Dispatcher", role: "dispatcher" };
const customerActor = (companyId: number): Actor => ({
  id: `00000000-0000-4000-8000-0000000001${pad(companyId)}`,
  name: { 1: "Alice Nguyen", 2: "Bea Florez", 3: "Cam Russo" }[companyId] ?? "Customer",
  role: "customer",
});
const driverActor = (driverId: number): Actor => {
  const d = db.drivers.find((x) => x.id === driverId);
  return { id: d?.user_id ?? "00000000-0000-4000-8000-000000000003", name: d?.name ?? "Driver", role: "driver" };
};

/** The driver behind the mock driver login (mockAuth: driver_id 1). */
export const MOCK_DRIVER_ID = 1;
export const DEFAULT_RATE_PER_KG = 0.6;
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export const TIME_LIMIT_S = 10;

// ---------------------------------------------------------------------------
// Seed data
// ---------------------------------------------------------------------------

function addr(id: number, company_id: number, label: string, line1: string, suburb: string, postcode: string, zone: string | null, contact_name: string, phone: string, notes: string | null = null): S["AddressRead"] {
  return {
    id, company_id, label, contact_name, phone, line1, line2: null, suburb, state: "NSW", postcode, country: "AU",
    notes, zone, archived: false, created_at: stamp(-120),
  };
}

function placeholderPhoto(text: string): Blob {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="320" viewBox="0 0 480 320">` +
    `<rect width="480" height="320" fill="#c9cfdb"/><rect x="150" y="90" width="180" height="140" fill="#b08a5a" stroke="#6b4f2a" stroke-width="6"/>` +
    `<path d="M150 135h180M240 90v140" stroke="#6b4f2a" stroke-width="4"/>` +
    `<text x="240" y="280" font-family="sans-serif" font-size="22" text-anchor="middle" fill="#1d2433">${text}</text></svg>`;
  return new Blob([svg], { type: "image/svg+xml" });
}

function makeDb() {
  const companies: Company[] = [
    { id: 1, name: "Acme Hardware" },
    { id: 2, name: "Bloom & Co Florists" },
    { id: 3, name: "Coastal Cafe Supplies" },
  ];
  const zones: S["ZoneRead"][] = [
    { code: "NORTH", name: "North Shore & Northern Beaches", rate_per_kg: "0.4200", active: true, created_at: stamp(-200) },
    { code: "SOUTH", name: "South & St George", rate_per_kg: "0.3800", active: true, created_at: stamp(-200) },
    { code: "WEST", name: "Western Sydney", rate_per_kg: "0.4500", active: true, created_at: stamp(-200) },
  ];
  const addresses: S["AddressRead"][] = [
    addr(1, 1, "Acme warehouse", "12 Foundry Rd", "Silverwater", "2128", "WEST", "Warehouse desk", "02 9748 1100", "Dock 3, ring the bell."),
    addr(2, 1, "Chatswood store", "3 Victoria Ave", "Chatswood", "2067", "NORTH", "Mark Ellis", "0412 555 201"),
    addr(3, 1, "Hornsby store", "40 George St", "Hornsby", "2077", "NORTH", "Priya Raman", "0412 555 202"),
    addr(4, 1, "Kogarah site", "8 Railway Pde", "Kogarah", "2217", "SOUTH", "Site office", "0412 555 203", "Hard hats on site."),
    addr(5, 1, "Penrith yard", "22 Mulgoa Rd", "Penrith", "2750", null, "Yard manager", "0412 555 204"),
    addr(6, 2, "Bloom depot", "5 Flower Ln", "Alexandria", "2015", "SOUTH", "Bea Florez", "02 9310 4400"),
    addr(7, 2, "Mosman shop", "101 Military Rd", "Mosman", "2088", "NORTH", "Shop counter", "02 9969 1200"),
    addr(8, 2, "Cronulla shop", "14 Kingsway", "Cronulla", "2230", "SOUTH", "Shop counter", "02 9523 7700"),
    addr(9, 2, "Parramatta kiosk", "159 Church St", "Parramatta", "2150", null, "Kiosk", "0433 210 999"),
    addr(10, 3, "Coastal DC", "77 Botany Rd", "Mascot", "2020", "SOUTH", "Dispatch", "02 9700 3030", "Loading bay at the rear."),
    addr(11, 3, "Manly cafe", "9 The Corso", "Manly", "2095", "NORTH", "Jo (manager)", "0400 111 222"),
    addr(12, 3, "Dee Why cafe", "30 Pittwater Rd", "Dee Why", "2099", "NORTH", "Sam", "0400 111 333"),
    addr(13, 3, "Blacktown cafe", "2 Main St", "Blacktown", "2148", "WEST", "Lee", "0400 111 444"),
    addr(14, 3, "Bondi cafe", "180 Campbell Pde", "Bondi Beach", "2026", null, "Kim", "0400 111 555"),
  ];
  const items: ItemRec[] = [
    { id: 101, company_id: 1, sku: "TIL-PAL", name: "Pallet of tiles", weight_kg: 560, volume_m3: 1.2, pallet_spaces: 1 },
    { id: 102, company_id: 1, sku: "CEM-20", name: "Cement bags (20)", weight_kg: 490, volume_m3: 0.6, pallet_spaces: 1 },
    { id: 103, company_id: 1, sku: "TIM-B", name: "Timber bundle", weight_kg: 440, volume_m3: 1.8, pallet_spaces: 0 },
    { id: 104, company_id: 1, sku: "STL-R", name: "Steel beam rack", weight_kg: 1200, volume_m3: 2.5, pallet_spaces: 2 },
    { id: 105, company_id: 1, sku: "PNT-BX", name: "Box of paint tins", weight_kg: 25, volume_m3: 0.05, pallet_spaces: 0 },
    { id: 201, company_id: 2, sku: "FLW-CR", name: "Flower bucket crate", weight_kg: 30, volume_m3: 0.4, pallet_spaces: 0 },
    { id: 202, company_id: 2, sku: "POT-PAL", name: "Pot plant pallet", weight_kg: 370, volume_m3: 2.0, pallet_spaces: 1 },
    { id: 203, company_id: 2, sku: "SOIL-PAL", name: "Potting mix pallet", weight_kg: 360, volume_m3: 0.9, pallet_spaces: 1 },
    { id: 301, company_id: 3, sku: "COF-SK", name: "Coffee beans sack", weight_kg: 60, volume_m3: 0.12, pallet_spaces: 0 },
    { id: 302, company_id: 3, sku: "CUP-PAL", name: "Cup cartons pallet", weight_kg: 190, volume_m3: 2.2, pallet_spaces: 1 },
    { id: 303, company_id: 3, sku: "ESP-M", name: "Espresso machine", weight_kg: 150, volume_m3: 0.5, pallet_spaces: 0.5 },
    { id: 304, company_id: 3, sku: "MLK-CR", name: "Milk crates", weight_kg: 340, volume_m3: 0.8, pallet_spaces: 1 },
  ];
  const vehicles: S["VehicleRead"][] = [
    { id: 1, name: "Van 1", registration: "VAN-101", max_weight_kg: 1000, max_volume_m3: null, max_pallets: null, active: true, created_at: stamp(-300) },
    { id: 2, name: "Isuzu NPR", registration: "TRK-202", max_weight_kg: 2000, max_volume_m3: 12, max_pallets: null, active: true, created_at: stamp(-300) },
    { id: 3, name: "Hino 500", registration: "TRK-303", max_weight_kg: 3000, max_volume_m3: null, max_pallets: 8, active: true, created_at: stamp(-300) },
    { id: 4, name: "Box trailer", registration: "BOX-404", max_weight_kg: null, max_volume_m3: 20, max_pallets: 6, active: true, created_at: stamp(-300) },
    { id: 5, name: "Old ute", registration: "UTE-505", max_weight_kg: 600, max_volume_m3: null, max_pallets: null, active: false, created_at: stamp(-900) },
  ];
  const drivers: (S["DriverRead"] & { password?: string })[] = [
    { id: 1, user_id: "00000000-0000-4000-8000-000000000003", email: "driver1@freightco.example.com", name: "Dave Driver", phone: "0400 900 001", licence_number: "NSW-MR-11223", active: true, created_at: stamp(-300) },
    { id: 2, user_id: "00000000-0000-4000-8000-000000000004", email: "driver2@freightco.example.com", name: "Priya Singh", phone: "0400 900 002", licence_number: "NSW-HR-44556", active: true, created_at: stamp(-300) },
    { id: 3, user_id: "00000000-0000-4000-8000-000000000005", email: "sam.lee@freightco.example.com", name: "Sam Lee", phone: null, licence_number: null, active: false, created_at: stamp(-600) },
  ];
  return {
    companies, zones, addresses, items, vehicles, drivers,
    orders: [] as OrderRec[],
    plans: [] as PlanRec[],
    jobs: [] as JobRec[],
    pods: [] as PodRec[],
  };
}

export let db = makeDb();

let lineSeq = 5000;
let eventSeq = 9000;
let assignmentSeq = 7000;
let planSeq = 0;

const PATHS: Record<string, OrderStatus[]> = {
  draft: ["draft"],
  submitted: ["draft", "submitted"],
  accepted: ["draft", "submitted", "accepted"],
  rejected: ["draft", "submitted", "rejected"],
  cancelled: ["draft", "cancelled"],
  planned: ["draft", "submitted", "accepted", "planned"],
  picked_up: ["draft", "submitted", "accepted", "planned", "picked_up"],
  in_transit: ["draft", "submitted", "accepted", "planned", "picked_up", "in_transit"],
  delivered: ["draft", "submitted", "accepted", "planned", "picked_up", "in_transit", "delivered"],
  exception: ["draft", "submitted", "accepted", "planned", "picked_up", "exception"],
};

interface SeedOrder {
  id: number;
  company: number;
  from: number;
  to: number;
  day: number;
  status: OrderStatus;
  lines: [number, number][];
  window?: [string, string];
  ref?: string;
  notes?: string;
  note?: string; // note of the last event (reject reason, exception)
}

function seedOrder(o: SeedOrder): OrderRec {
  const created = stamp(o.day - 6, 10);
  const path = PATHS[o.status];
  // events spread between creation and the delivery date
  const times = path.map((_, i) => {
    if (i === 0) return created;
    if (i <= 2) return stamp(o.day - 5 + i, 11 + i);
    if (i === 3) return stamp(o.day - 1, 16);
    return stamp(o.day, 4 + i, 10 * i);
  });
  const events: EventRec[] = path.map((to, i) => ({
    id: ++eventSeq,
    from_status: i === 0 ? null : path[i - 1],
    to_status: to,
    actor: to === "draft" || to === "submitted" || to === "cancelled" ? customerActor(o.company)
      : to === "accepted" || to === "rejected" || to === "planned" ? DISPATCHER
      : driverActor(MOCK_DRIVER_ID),
    note: i === path.length - 1 && o.note ? o.note : null,
    created_at: times[i],
  }));
  const submittedAt = path.includes("submitted") ? times[1] : null;
  const deliveredAt = o.status === "delivered" ? times[times.length - 1] : null;
  const order: OrderRec = {
    id: o.id,
    reference: `ORD-${o.id}`,
    company_id: o.company,
    status: o.status,
    pickup_address_id: o.from,
    delivery_address_id: o.to,
    delivery_date: isoDay(o.day),
    window_start: o.window?.[0] ?? null,
    window_end: o.window?.[1] ?? null,
    customer_reference: o.ref ?? null,
    notes: o.notes ?? null,
    lines: o.lines.map(([item_id, quantity]) => ({ id: ++lineSeq, item_id, quantity })),
    events,
    quote: null,
    pod_ids: [],
    plan_id: null,
    created_at: created,
    updated_at: times[times.length - 1],
    submitted_at: submittedAt,
    delivered_at: deliveredAt,
  };
  if (submittedAt) order.quote = makeQuote(order, submittedAt);
  return order;
}

function makeQuote(order: OrderRec, at: string): QuoteRec {
  const zoneCode = address(order.delivery_address_id).zone;
  const zone = zoneCode ? db.zones.find((z) => z.code === zoneCode) : null;
  return {
    id: nextId(),
    zone_code: zone ? zone.code : null,
    rate: zone ? Number(zone.rate_per_kg) : DEFAULT_RATE_PER_KG,
    provisional: !zone,
    created_at: at,
  };
}

function seedPod(order: OrderRec, signedBy: string, driverId = MOCK_DRIVER_ID) {
  const pod: PodRec = {
    id: nextId(),
    order_id: order.id,
    signed_by: signedBy,
    note: null,
    created_at: order.delivered_at ?? now(),
    driver_id: driverId,
    photo: placeholderPhoto(`POD ${order.reference}`),
  };
  db.pods.push(pod);
  order.pod_ids.push(pod.id);
}

/** Reset the mock data to its seed (used by the tests). */
export function resetDb() {
  db = makeDb();
  lineSeq = 5000;
  eventSeq = 9000;
  assignmentSeq = 7000;
  planSeq = 0;
  const W = (a: string, b: string): [string, string] => [a, b];
  const seeds: SeedOrder[] = [
    // Today, NORTH: a locked plan with two loads (driver 1 has load 1).
    { id: 1001, company: 1, from: 1, to: 3, day: 0, status: "planned", lines: [[102, 1], [105, 6]], window: W("08:00", "12:00"), ref: "PO-7781", notes: "Leave at the rear roller door." },
    { id: 1002, company: 3, from: 10, to: 11, day: 0, status: "picked_up", lines: [[301, 5]], window: W("06:00", "09:00") },
    { id: 1018, company: 1, from: 1, to: 2, day: 0, status: "in_transit", lines: [[105, 8]], window: W("09:00", "13:00"), ref: "PO-7790" },
    { id: 1004, company: 3, from: 10, to: 12, day: 0, status: "delivered", lines: [[302, 1]], window: W("06:00", "10:00") },
    { id: 1003, company: 2, from: 6, to: 7, day: 0, status: "in_transit", lines: [[201, 4], [202, 1]], window: W("07:00", "11:00") },
    { id: 1021, company: 3, from: 10, to: 11, day: 0, status: "exception", lines: [[301, 2]], note: "Cafe closed, nobody to receive." },
    // Tomorrow, NORTH: accepted, waiting for a plan. FFD needs 4 vans of 1000 kg, 3 are enough.
    { id: 1005, company: 1, from: 1, to: 2, day: 1, status: "accepted", lines: [[101, 1], [102, 1]], window: W("07:00", "12:00"), ref: "PO-7802" },
    { id: 1006, company: 1, from: 1, to: 3, day: 1, status: "accepted", lines: [[103, 1]] },
    { id: 1007, company: 2, from: 6, to: 7, day: 1, status: "accepted", lines: [[202, 1], [203, 1]], window: W("08:00", "10:00") },
    { id: 1008, company: 3, from: 10, to: 11, day: 1, status: "accepted", lines: [[304, 1], [302, 1]], window: W("06:00", "08:00") },
    { id: 1009, company: 3, from: 10, to: 12, day: 1, status: "accepted", lines: [[303, 1]], notes: "Fragile: espresso machine." },
    // Tomorrow, SOUTH: the steel rack doesn't fit Van 1 (1000 kg).
    { id: 1010, company: 1, from: 1, to: 4, day: 1, status: "accepted", lines: [[104, 1], [105, 4]], window: W("07:00", "15:00"), ref: "PO-7810" },
    { id: 1011, company: 2, from: 6, to: 8, day: 1, status: "accepted", lines: [[201, 6]] },
    // Tomorrow, unzoned address: can't be batched until the address gets a zone.
    { id: 1012, company: 1, from: 1, to: 5, day: 1, status: "accepted", lines: [[102, 2]] },
    // Tomorrow, WEST: a draft plan already exists.
    { id: 1019, company: 3, from: 10, to: 13, day: 1, status: "accepted", lines: [[302, 2], [301, 4]] },
    { id: 1020, company: 3, from: 10, to: 13, day: 1, status: "accepted", lines: [[304, 2], [303, 1]], ref: "CAFE-WK48" },
    // In the queue.
    { id: 1013, company: 3, from: 10, to: 14, day: 2, status: "submitted", lines: [[301, 3], [303, 1]], window: W("06:00", "09:00") },
    { id: 1014, company: 2, from: 6, to: 7, day: 2, status: "submitted", lines: [[201, 10]], ref: "WEDDING-12" },
    { id: 1015, company: 1, from: 1, to: 2, day: 2, status: "submitted", lines: [[101, 2], [105, 10]], window: W("07:00", "11:00"), ref: "PO-7815" },
    { id: 1016, company: 3, from: 10, to: 13, day: 3, status: "submitted", lines: [[302, 1], [304, 1]] },
    { id: 1017, company: 2, from: 6, to: 9, day: 2, status: "rejected", lines: [[202, 3]], note: "Parramatta kiosk has no loading access for pallets." },
    // Delivered earlier (invoices for this month and last month).
    { id: 991, company: 1, from: 1, to: 2, day: -21, status: "delivered", lines: [[101, 1], [105, 4]] },
    { id: 992, company: 1, from: 1, to: 4, day: -14, status: "delivered", lines: [[102, 2]], ref: "PO-7702" },
    { id: 993, company: 2, from: 6, to: 8, day: -9, status: "delivered", lines: [[201, 8]] },
    { id: 994, company: 3, from: 10, to: 11, day: -6, status: "delivered", lines: [[301, 6], [303, 1]] },
    { id: 995, company: 1, from: 1, to: 3, day: -3, status: "delivered", lines: [[103, 2]] },
    { id: 996, company: 3, from: 10, to: 14, day: -38, status: "delivered", lines: [[302, 1]] },
    { id: 997, company: 1, from: 1, to: 2, day: -45, status: "delivered", lines: [[105, 20]], ref: "PO-7600" },
  ];
  db.orders = seeds.map(seedOrder);
  for (const o of db.orders) {
    if (o.status === "delivered") seedPod(o, ["J. Smith", "Mark Ellis", "Sam", "Jo", "Priya R."][o.id % 5]);
  }

  // Today's locked NORTH plan.
  const today = createPlanRecord(isoDay(0), "NORTH", 2, [1001, 1002, 1018, 1004, 1003, 1021], -1);
  today.status = "locked";
  today.method = "ortools";
  today.locked_at = stamp(-1, 16);
  today.loads = [
    loadOf(1, 2, 1, [1001, 1002, 1018, 1004]),
    loadOf(2, 3, 2, [1003, 1021]),
  ];
  // Tomorrow's WEST plan, saved as a draft (two loads, ready to edit).
  const west = createPlanRecord(isoDay(1), "WEST", 1, [1019, 1020], -0.02);
  saveDraft(west, "ortools");
}

function loadOf(number: number, vehicleId: number | null, driverId: number | null, orderIds: number[]): LoadRec {
  return {
    id: nextId(),
    number,
    vehicle_id: vehicleId,
    driver_id: driverId,
    assignments: orderIds.flatMap((oid) => order(oid).lines.map((l) => ({ id: ++assignmentSeq, order_line_id: l.id, quantity: l.quantity }))),
  };
}

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

export function order(id: number): OrderRec {
  const o = db.orders.find((x) => x.id === id);
  if (!o) throw httpError(404, "Order not found.");
  return o;
}
export function address(id: number): S["AddressRead"] {
  const a = db.addresses.find((x) => x.id === id);
  if (!a) throw httpError(404, "Address not found.");
  return a;
}
export const item = (id: number) => db.items.find((x) => x.id === id)!;
export const company = (id: number) => db.companies.find((x) => x.id === id)!;
export const vehicle = (id: number) => db.vehicles.find((x) => x.id === id);
export const driver = (id: number) => db.drivers.find((x) => x.id === id);
export function plan(id: number): PlanRec {
  const p = db.plans.find((x) => x.id === id);
  if (!p) throw httpError(404, "Plan not found.");
  return p;
}
export function job(id: string): JobRec {
  const j = db.jobs.find((x) => x.id === id);
  if (!j) throw httpError(404, "Job not found.");
  return j;
}
/** The order line and its order, by line id. */
export function lineById(lineId: number): { order: OrderRec; line: LineRec } {
  for (const o of db.orders) {
    const line = o.lines.find((l) => l.id === lineId);
    if (line) return { order: o, line };
  }
  throw httpError(404, "Order line not found.");
}

export const capacityOf = (v: S["VehicleRead"]): CapacityLimits => ({
  weight_kg: v.max_weight_kg, volume_m3: v.max_volume_m3, pallets: v.max_pallets,
});
const unitOf = (it: ItemRec): UsageTotals => ({ weight_kg: it.weight_kg, volume_m3: it.volume_m3, pallets: it.pallet_spaces });

// ---------------------------------------------------------------------------
// Serializers (records → API models)
// ---------------------------------------------------------------------------

function orderTotals(o: OrderRec) {
  return o.lines.reduce((t, l) => addUsage(t, unitOf(item(l.item_id)), l.quantity), emptyUsage());
}

function quoteRead(o: OrderRec): S["QuoteRead"] | null {
  if (!o.quote) return null;
  const t = orderTotals(o);
  const cubic = round2(Math.max(t.weight_kg, t.volume_m3 * 250));
  return {
    id: o.quote.id,
    zone_code: o.quote.zone_code,
    total_weight_kg: round2(t.weight_kg),
    total_volume_m3: round2(t.volume_m3),
    cubic_weight_kg: cubic,
    rate_per_kg: o.quote.rate.toFixed(4),
    amount: money(cubic * o.quote.rate),
    provisional: o.quote.provisional,
    created_at: o.quote.created_at,
  };
}

export function orderSummary(o: OrderRec): S["OrderSummary"] {
  const t = orderTotals(o);
  const delivery = address(o.delivery_address_id);
  return {
    id: o.id,
    reference: o.reference,
    status: o.status,
    company_id: o.company_id,
    company_name: company(o.company_id).name,
    delivery_date: o.delivery_date,
    window_start: o.window_start,
    window_end: o.window_end,
    customer_reference: o.customer_reference,
    pickup_label: address(o.pickup_address_id).label,
    delivery_label: delivery.label,
    delivery_suburb: delivery.suburb,
    zone: delivery.zone,
    line_count: o.lines.length,
    total_units: o.lines.reduce((n, l) => n + l.quantity, 0),
    total_weight_kg: round2(t.weight_kg),
    total_volume_m3: round2(t.volume_m3),
    total_pallet_spaces: round2(t.pallets),
    amount: quoteRead(o)?.amount ?? null,
    plan_id: o.plan_id,
    created_at: o.created_at,
    updated_at: o.updated_at,
  };
}

export function podRead(p: PodRec): S["PodRead"] {
  return {
    id: p.id, order_id: p.order_id, signed_by: p.signed_by, note: p.note, created_at: p.created_at,
    driver_name: driver(p.driver_id)?.name ?? null, photo_url: `/api/pods/${p.id}/photo`,
  };
}

export function orderRead(o: OrderRec): S["OrderRead"] {
  return {
    ...orderSummary(o),
    pickup_address: address(o.pickup_address_id),
    delivery_address: address(o.delivery_address_id),
    notes: o.notes,
    lines: o.lines.map((l) => {
      const it = item(l.item_id);
      return {
        id: l.id, item_id: it.id, item_name: it.name, item_sku: it.sku, quantity: l.quantity,
        unit_weight_kg: it.weight_kg, unit_volume_m3: it.volume_m3, unit_pallet_spaces: it.pallet_spaces,
      };
    }),
    events: o.events.map((e) => ({
      id: e.id, from_status: e.from_status, to_status: e.to_status, actor_id: e.actor?.id ?? null,
      actor_name: e.actor?.name ?? null, actor_role: e.actor?.role ?? null, note: e.note, created_at: e.created_at,
    })),
    quote: quoteRead(o),
    pods: o.pod_ids.map((id) => podRead(db.pods.find((p) => p.id === id)!)),
    submitted_at: o.submitted_at,
    delivered_at: o.delivered_at,
  };
}

export function opsAddress(a: S["AddressRead"]): S["OpsAddressRead"] {
  return { ...a, company_name: company(a.company_id).name };
}

function loadUsage(l: LoadRec): UsageTotals {
  return l.assignments.reduce((u, a) => addUsage(u, unitOf(item(lineById(a.order_line_id).line.item_id)), a.quantity), emptyUsage());
}

export function loadCapacity(p: PlanRec, l: LoadRec): CapacityLimits {
  const v = (l.vehicle_id != null && vehicle(l.vehicle_id)) || vehicle(p.vehicle_id)!;
  return capacityOf(v);
}

function roundUsage(u: UsageTotals): UsageTotals {
  return { weight_kg: round2(u.weight_kg), volume_m3: Math.round(u.volume_m3 * 1000) / 1000, pallets: round2(u.pallets) };
}

export function loadRead(p: PlanRec, l: LoadRec): S["LoadRead"] {
  const cap = loadCapacity(p, l);
  const usage = loadUsage(l);
  return {
    id: l.id,
    number: l.number,
    vehicle: l.vehicle_id != null ? vehicle(l.vehicle_id) ?? null : null,
    driver: l.driver_id != null ? driverRead(driver(l.driver_id)!) : null,
    capacity: { weight_kg: cap.weight_kg ?? null, volume_m3: cap.volume_m3 ?? null, pallets: cap.pallets ?? null },
    usage: roundUsage(usage),
    fill_percent: fillPercent(usage, cap),
    over_capacity: overDims(usage, cap).length > 0,
    lines: l.assignments.map((a) => {
      const { order: o, line } = lineById(a.order_line_id);
      const it = item(line.item_id);
      return {
        assignment_id: a.id, order_line_id: line.id, order_id: o.id, order_reference: o.reference,
        company_name: company(o.company_id).name, item_name: it.name, item_sku: it.sku,
        quantity: a.quantity, line_quantity: line.quantity,
        unit_weight_kg: it.weight_kg, unit_volume_m3: it.volume_m3, unit_pallet_spaces: it.pallet_spaces,
      };
    }),
  };
}

export function driverRead(d: S["DriverRead"] & { password?: string }): S["DriverRead"] {
  const { password: _password, ...rest } = d;
  return rest;
}

export function jobStatus(j: JobRec): S["JobStatus"] {
  const t = Date.now() - j.created_ms;
  if (t < j.queuedMs) return "queued";
  if (t < j.doneMs) return "running";
  return j.error ? "failed" : "succeeded";
}

export function jobRead(j: JobRec): S["JobRead"] {
  const status = jobStatus(j);
  return {
    id: j.id,
    kind: "solve",
    status,
    error: status === "failed" ? j.error : null,
    created_at: new Date(j.created_ms).toISOString(),
    started_at: status === "queued" ? null : new Date(j.created_ms + j.queuedMs).toISOString(),
    finished_at: status === "succeeded" || status === "failed" ? new Date(j.created_ms + j.doneMs).toISOString() : null,
    time_limit_s: j.time_limit_s,
    plan_id: j.plan_id,
  };
}

export function planSummary(p: PlanRec): S["PlanSummary"] {
  return {
    id: p.id, delivery_date: p.delivery_date, zone: p.zone, status: p.status, job_id: p.job_id,
    job_status: jobStatus(job(p.job_id)), method: p.method, order_count: p.order_ids.length,
    load_count: p.loads.length, created_at: p.created_at, locked_at: p.locked_at,
  };
}

export function planRead(p: PlanRec): S["PlanRead"] {
  return {
    ...planSummary(p),
    vehicle: vehicle(p.vehicle_id)!,
    order_ids: [...p.order_ids],
    loads: [...p.loads].sort((a, b) => a.number - b.number).map((l) => loadRead(p, l)),
  };
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

const ALLOWED: Record<OrderStatus, OrderStatus[]> = {
  draft: ["submitted", "cancelled"],
  submitted: ["accepted", "rejected", "cancelled"],
  accepted: ["planned"],
  planned: ["picked_up", "exception"],
  picked_up: ["in_transit", "exception"],
  in_transit: ["delivered", "exception"],
  rejected: [], cancelled: [], delivered: [], exception: [],
};

const LABEL: Record<OrderStatus, string> = {
  draft: "draft", submitted: "submitted", accepted: "accepted", rejected: "rejected", cancelled: "cancelled",
  planned: "planned", picked_up: "picked up", in_transit: "in transit", delivered: "delivered", exception: "exception",
};

/** The one place that changes an order's status (like app/lifecycle.py). 409 if not allowed. */
export function transition(o: OrderRec, to: OrderStatus, actor: Actor, note: string | null = null) {
  if (!ALLOWED[o.status].includes(to)) {
    throw httpError(409, `Can't change order ${o.reference} from ${LABEL[o.status]} to ${LABEL[to]}.`);
  }
  const at = now();
  o.events.push({ id: ++eventSeq, from_status: o.status, to_status: to, actor, note, created_at: at });
  o.status = to;
  o.updated_at = at;
  if (to === "delivered") o.delivered_at = at;
}

export const nextStatusesOf = (s: OrderStatus): OrderStatus[] =>
  ALLOWED[s].filter((x) => ["picked_up", "in_transit", "delivered", "exception"].includes(x));

export const actors = { dispatcher: DISPATCHER, driver: driverActor };

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------

/** One PackUnit per unit of every line of these orders, ids 0..n-1. */
function packUnits(orderIds: number[]): S["PackUnit"][] {
  const units: S["PackUnit"][] = [];
  for (const oid of orderIds) {
    const o = order(oid);
    for (const l of o.lines) {
      const it = item(l.item_id);
      for (let k = 0; k < l.quantity; k++) {
        units.push({
          id: units.length, order_id: o.id, order_reference: o.reference, order_line_id: l.id,
          item_name: it.name, item_sku: it.sku, weight_kg: it.weight_kg, volume_m3: it.volume_m3, pallets: it.pallet_spaces,
        });
      }
    }
  }
  return units;
}

function packedLoads(loads: number[][], units: S["PackUnit"][], cap: CapacityLimits): S["PackedLoad"][] {
  return loads.map((ids, i) => {
    const usage = totalsOf(ids.map((id) => units[id]));
    return { number: i + 1, unit_ids: ids, usage: roundUsage(usage), fill_percent: fillPercent(usage, cap) };
  });
}

/** FFD plus an exact search for fewer loads (standing in for CP-SAT). */
export function solve(orderIds: number[], cap: CapacityLimits, timeLimit = TIME_LIMIT_S): S["SolveResult"] {
  const units = packUnits(orderIds);
  const asUnits: Unit[] = units.map((u) => ({ id: u.id, weight_kg: u.weight_kg, volume_m3: u.volume_m3, pallets: u.pallets }));
  const totals = totalsOf(asUnits);
  const lb = lowerBounds(totals, cap);

  const f = ffd(asUnits, cap);
  const ffdOptimal = f.loads.length <= lb.overall;
  const ffdResult: S["MethodResult"] = {
    num_loads: f.loads.length,
    loads: packedLoads(f.loads, units, cap),
    solve_time_ms: Math.round((0.05 + units.length * 0.01) * 100) / 100,
    drop_order: f.order,
    optimal: ffdOptimal,
    status: "HEURISTIC",
  };

  let best = f.loads;
  let proven = ffdOptimal;
  for (let bins = lb.overall; bins < f.loads.length; bins++) {
    const r = exact(asUnits, cap, bins);
    if (r.loads) {
      best = r.loads;
      proven = bins === lb.overall || proven;
      break;
    }
    if (!r.exhausted) break; // node limit: no proof either way
    proven = true; // `bins` proven impossible; keep looking one higher
  }
  // proven === true here means every smaller count was ruled out (or we hit the bound)
  const ortools: S["MethodResult"] = {
    num_loads: best.length,
    loads: packedLoads(best, units, cap),
    solve_time_ms: proven ? 40 + units.length * 12 : timeLimit * 1000,
    drop_order: best.flat(),
    optimal: proven,
    status: proven ? "OPTIMAL" : "FEASIBLE",
  };
  return {
    capacity: { weight_kg: cap.weight_kg ?? null, volume_m3: cap.volume_m3 ?? null, pallets: cap.pallets ?? null },
    totals: roundUsage(totals),
    lower_bound: lb.overall,
    lower_bounds: { weight: lb.weight, volume: lb.volume, pallets: lb.pallets },
    units,
    ffd: ffdResult,
    ortools,
    recommended: ortools.num_loads <= ffdResult.num_loads ? "ortools" : "ffd",
    time_limit_s: timeLimit,
  };
}

/** Orders of a batch that a new plan would take. `zone` "none" = unzoned. */
export function batchOrders(date: string, zone: string | null): OrderRec[] {
  return db.orders.filter(
    (o) => o.status === "accepted" && o.plan_id == null && o.delivery_date === date &&
      address(o.delivery_address_id).zone === zone,
  );
}

/** Create the plan + job records (no validation). `agoDays` < 0 for seed data that finished long ago. */
function createPlanRecord(date: string, zone: string, vehicleId: number, orderIds: number[], agoDays = 0): PlanRec {
  const cap = capacityOf(vehicle(vehicleId)!);
  const id = ++planSeq;
  const created = Date.now() + agoDays * 86_400_000;
  const j: JobRec = {
    id: crypto.randomUUID(),
    plan_id: id,
    created_ms: created,
    queuedMs: 700,
    doneMs: 3000,
    time_limit_s: TIME_LIMIT_S,
    result: null,
    error: null,
  };
  j.result = solve(orderIds, cap);
  db.jobs.push(j);
  const p: PlanRec = {
    id, delivery_date: date, zone, status: "draft", vehicle_id: vehicleId, job_id: j.id, method: null,
    order_ids: orderIds, loads: [], created_at: new Date(created).toISOString(), locked_at: null,
  };
  db.plans.push(p);
  for (const oid of orderIds) order(oid).plan_id = id;
  return p;
}

/** POST /api/ops/plans: validate, reserve the batch, start the (mock) job. */
export function createPlan(body: { delivery_date?: string; zone?: string; vehicle_id?: number }): PlanRec {
  if (!body.delivery_date || !body.zone || body.vehicle_id == null) {
    throw validationError("delivery_date, zone and vehicle_id are required.");
  }
  const v = vehicle(body.vehicle_id);
  if (!v) throw httpError(404, "Vehicle not found.");
  if (!v.active) throw httpError(422, `${v.name} is inactive.`);
  const zone = db.zones.find((z) => z.code === body.zone);
  if (!zone) throw httpError(422, `Zone ${body.zone} doesn't exist.`);
  const orders = batchOrders(body.delivery_date, body.zone);
  if (!orders.length) {
    throw httpError(422, `There are no accepted, unplanned orders for ${body.delivery_date} in zone ${body.zone}.`);
  }
  const cap = capacityOf(v);
  const bad: S["UnitMisfit"][] = [];
  for (const o of orders) {
    for (const l of o.lines) {
      const it = item(l.item_id);
      const m = misfits([unitOf(it)], cap)[0];
      if (!m) continue;
      const parts = m.dims.map((dim) => {
        const f = { weight: ["weight_kg", "kg"], volume: ["volume_m3", "m³"], pallets: ["pallets", "pallets"] }[dim];
        const size = unitOf(it)[f[0] as keyof UsageTotals];
        return `${size} ${f[1]} > ${cap[f[0] as keyof CapacityLimits]} ${f[1]} capacity`;
      });
      bad.push({
        order_id: o.id, order_reference: o.reference, order_line_id: l.id, item_name: it.name, item_sku: it.sku,
        dimensions: m.dims, message: `${it.name} (SKU ${it.sku}): ${parts.join(", ")}`,
      });
    }
  }
  if (bad.length) {
    throw httpError(422, {
      message: `${bad.length} item${bad.length === 1 ? "" : "s"} can never fit ${v.name}. Choose a bigger vehicle profile or split the order.`,
      misfits: bad,
    } satisfies S["InfeasibleDetail"]);
  }
  return createPlanRecord(body.delivery_date, body.zone, v.id, orders.map((o) => o.id));
}

/** Write the loads of one method's solution (replaces existing loads). */
export function saveDraft(p: PlanRec, method: "ffd" | "ortools") {
  if (p.status === "locked") throw httpError(409, "This plan is locked.");
  const j = job(p.job_id);
  if (jobStatus(j) !== "succeeded" || !j.result) throw httpError(409, "The optimiser hasn't finished yet.");
  const res = method === "ortools" ? j.result.ortools : j.result.ffd;
  if (!res) throw httpError(409, "OR-Tools found no solution; save the FFD plan instead.");
  const units = j.result.units;
  p.loads = res.loads.map((pl) => {
    const perLine = new Map<number, number>();
    for (const uid of pl.unit_ids) perLine.set(units[uid].order_line_id, (perLine.get(units[uid].order_line_id) ?? 0) + 1);
    return {
      id: nextId(),
      number: pl.number,
      vehicle_id: null,
      driver_id: null,
      assignments: [...perLine].map(([order_line_id, quantity]) => ({ id: ++assignmentSeq, order_line_id, quantity })),
    };
  });
  p.method = method;
}

const usageText = (u: UsageTotals, cap: CapacityLimits) =>
  overDims(u, cap).map((d) => `${d.format(u[d.field])} > ${d.format(cap[d.field]!)}`).join(", ");

/** Move units of a line between loads (to_load_id null = a new load). */
export function moveLine(p: PlanRec, body: { order_line_id?: number; from_load_id?: number; to_load_id?: number | null; quantity?: number | null }) {
  if (p.status === "locked") throw httpError(409, "This plan is locked: loads can't be changed.");
  if (body.order_line_id == null || body.from_load_id == null) throw validationError("order_line_id and from_load_id are required.");
  if (body.quantity != null && !(Number.isInteger(body.quantity) && body.quantity >= 1)) {
    throw validationError("Input should be greater than or equal to 1", ["body", "quantity"]);
  }
  const from = p.loads.find((l) => l.id === body.from_load_id);
  if (!from) throw httpError(404, "Load not found in this plan.");
  const a = from.assignments.find((x) => x.order_line_id === body.order_line_id);
  if (!a) throw httpError(422, `That line isn't on load ${from.number}.`);
  const qty = body.quantity ?? a.quantity;
  if (qty > a.quantity) throw httpError(422, `Load ${from.number} only has ${a.quantity} of that line.`);
  let to = body.to_load_id != null ? p.loads.find((l) => l.id === body.to_load_id) : undefined;
  if (body.to_load_id != null && !to) throw httpError(404, "Target load not found in this plan.");
  if (to === from) throw httpError(422, "The line is already on that load.");
  const unit = unitOf(item(lineById(a.order_line_id).line.item_id));
  if (to) {
    const after = addUsage(loadUsage(to), unit, qty);
    const cap = loadCapacity(p, to);
    if (overDims(after, cap).length) {
      throw httpError(422, `Load ${to.number} would be over capacity: ${usageText(after, cap)}.`);
    }
  } else {
    const cap = loadCapacity(p, { id: 0, number: 0, vehicle_id: null, driver_id: null, assignments: [] });
    const after = addUsage(emptyUsage(), unit, qty);
    if (overDims(after, cap).length) throw httpError(422, `A new load would be over capacity: ${usageText(after, cap)}.`);
    to = { id: nextId(), number: p.loads.length + 1, vehicle_id: null, driver_id: null, assignments: [] };
    p.loads.push(to);
  }
  a.quantity -= qty;
  if (a.quantity === 0) from.assignments = from.assignments.filter((x) => x !== a);
  const existing = to.assignments.find((x) => x.order_line_id === a.order_line_id);
  if (existing) existing.quantity += qty;
  else to.assignments.push({ id: ++assignmentSeq, order_line_id: a.order_line_id, quantity: qty });
  // Empty loads are deleted and the rest renumbered.
  p.loads = p.loads.filter((l) => l.assignments.length).sort((x, y) => x.number - y.number);
  p.loads.forEach((l, i) => (l.number = i + 1));
}

export function lockPlan(p: PlanRec) {
  if (p.status === "locked") throw httpError(409, "This plan is already locked.");
  if (!p.loads.length) throw httpError(409, "Save a draft before locking the plan.");
  const over = p.loads.find((l) => overDims(loadUsage(l), loadCapacity(p, l)).length);
  if (over) throw httpError(409, `Load ${over.number} is over capacity. Move some lines first.`);
  for (const oid of p.order_ids) {
    const o = order(oid);
    if (o.status === "accepted") transition(o, "planned", DISPATCHER);
  }
  p.status = "locked";
  p.locked_at = now();
}

export function discardPlan(p: PlanRec) {
  if (p.status === "locked") throw httpError(409, "Locked plans can't be discarded.");
  for (const oid of p.order_ids) order(oid).plan_id = null;
  db.plans = db.plans.filter((x) => x !== p);
}

export function updateLoad(loadId: number, body: { vehicle_id?: number | null; driver_id?: number | null }): S["LoadRead"] {
  const p = db.plans.find((x) => x.loads.some((l) => l.id === loadId));
  if (!p) throw httpError(404, "Load not found.");
  const l = p.loads.find((x) => x.id === loadId)!;
  if ("vehicle_id" in body) {
    if (body.vehicle_id != null) {
      const v = vehicle(body.vehicle_id);
      if (!v) throw httpError(422, "Vehicle not found.");
      if (!v.active) throw httpError(422, `${v.name} is inactive.`);
      const u = loadUsage(l);
      if (overDims(u, capacityOf(v)).length) {
        throw httpError(422, `Load ${l.number} doesn't fit ${v.name}: ${usageText(u, capacityOf(v))}.`);
      }
    }
    l.vehicle_id = body.vehicle_id ?? null;
  }
  if ("driver_id" in body) {
    if (body.driver_id != null) {
      const d = driver(body.driver_id);
      if (!d) throw httpError(422, "Driver not found.");
      if (!d.active) throw httpError(422, `${d.name} is inactive.`);
    }
    l.driver_id = body.driver_id ?? null;
  }
  return loadRead(p, l);
}

// ---------------------------------------------------------------------------
// Invoices
// ---------------------------------------------------------------------------

export function invoiceLines(companyId: number, month: string): S["InvoiceLine"][] {
  return db.orders
    .filter((o) => o.company_id === companyId && o.status === "delivered" && o.delivered_at && monthOf(o.delivered_at) === month)
    .sort((a, b) => a.delivered_at!.localeCompare(b.delivered_at!))
    .map((o) => {
      const q = quoteRead(o)!;
      return {
        order_id: o.id, reference: o.reference, customer_reference: o.customer_reference, delivered_at: o.delivered_at!,
        delivery_suburb: address(o.delivery_address_id).suburb, zone_code: q.zone_code,
        total_weight_kg: q.total_weight_kg, total_volume_m3: q.total_volume_m3, cubic_weight_kg: q.cubic_weight_kg,
        rate_per_kg: q.rate_per_kg, amount: q.amount,
      };
    });
}

export function invoice(companyId: number, month: string): S["Invoice"] {
  const lines = invoiceLines(companyId, month);
  const c = db.companies.find((x) => x.id === companyId);
  if (!c) throw httpError(404, "Company not found.");
  return {
    company_id: c.id, company_name: c.name, month, lines, order_count: lines.length,
    total_amount: money(lines.reduce((s, l) => s + Number(l.amount), 0)),
  };
}

export function invoiceCsv(inv: S["Invoice"]): string {
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = [
    ["reference", "customer_reference", "delivered_at", "delivery_suburb", "zone", "weight_kg", "volume_m3", "cubic_weight_kg", "rate_per_kg", "amount"],
    ...inv.lines.map((l) => [l.reference, l.customer_reference, l.delivered_at, l.delivery_suburb, l.zone_code, l.total_weight_kg, l.total_volume_m3, l.cubic_weight_kg, l.rate_per_kg, l.amount]),
    ["TOTAL", "", "", "", "", "", "", "", "", inv.total_amount],
  ];
  return rows.map((r) => r.map(esc).join(",")).join("\r\n") + "\r\n";
}

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

export function driverOrder(l: LoadRec, o: OrderRec): S["DriverOrder"] {
  const lines = l.assignments
    .map((a) => ({ a, ...lineById(a.order_line_id) }))
    .filter((x) => x.order.id === o.id);
  return {
    order_id: o.id,
    reference: o.reference,
    status: o.status,
    load_id: l.id,
    company_name: company(o.company_id).name,
    delivery_date: o.delivery_date,
    window_start: o.window_start,
    window_end: o.window_end,
    pickup_address: address(o.pickup_address_id),
    delivery_address: address(o.delivery_address_id),
    notes: o.notes,
    lines: lines.map(({ a, line }) => {
      const it = item(line.item_id);
      return { item_name: it.name, item_sku: it.sku, quantity: a.quantity };
    }),
    total_weight_kg: round2(lines.reduce((s, { a, line }) => s + item(line.item_id).weight_kg * a.quantity, 0)),
    next_statuses: nextStatusesOf(o.status),
    pods: o.pod_ids.map((id) => podRead(db.pods.find((x) => x.id === id)!)),
  };
}

/** This driver's loads in locked plans, optionally for one date. */
export function driverLoads(driverId: number, date?: string) {
  const out: { plan: PlanRec; load: LoadRec }[] = [];
  for (const p of db.plans) {
    if (p.status !== "locked" || (date && p.delivery_date !== date)) continue;
    for (const l of p.loads) if (l.driver_id === driverId) out.push({ plan: p, load: l });
  }
  return out.sort((a, b) => a.load.number - b.load.number);
}

/** The order on one of this driver's loads (404 otherwise). */
export function driverOrderFor(driverId: number, orderId: number): S["DriverOrder"] {
  for (const { load: l } of driverLoads(driverId)) {
    const o = db.orders.find((x) => x.id === orderId);
    if (o && l.assignments.some((a) => lineById(a.order_line_id).order.id === orderId)) return driverOrder(l, o);
  }
  throw httpError(404, "Order not found on your loads.");
}

export function addPod(orderId: number, driverId: number, signedBy: string, note: string | null, photo: Blob): PodRec {
  const pod: PodRec = { id: nextId(), order_id: orderId, signed_by: signedBy, note, created_at: now(), driver_id: driverId, photo };
  db.pods.push(pod);
  order(orderId).pod_ids.push(pod.id);
  return pod;
}

resetDb();
