// Pure helpers of the portal area: status groups, totals, form validation and
// mapping API errors onto form fields. No React here, so it can be unit-tested
// with `node --test` (see logic.test.ts).
import type { Item, Order, OrderEvent, OrderStatus, OrderSummary } from "./types.ts";

// ---- Status groups (orders list filter) ------------------------------------

export type StatusGroup = "all" | "drafts" | "active" | "delivered" | "closed";

export const STATUS_GROUPS: { value: StatusGroup; label: string; statuses: OrderStatus[] }[] = [
  { value: "all", label: "All orders", statuses: [] },
  { value: "drafts", label: "Drafts", statuses: ["draft"] },
  { value: "active", label: "Active", statuses: ["submitted", "accepted", "planned", "picked_up", "in_transit"] },
  { value: "delivered", label: "Delivered", statuses: ["delivered"] },
  { value: "closed", label: "Closed", statuses: ["rejected", "cancelled", "exception"] },
];

export function statusesForGroup(group: string | null | undefined): OrderStatus[] {
  return STATUS_GROUPS.find((g) => g.value === group)?.statuses ?? [];
}

export function isStatusGroup(value: string | null | undefined): value is StatusGroup {
  return STATUS_GROUPS.some((g) => g.value === value);
}

/** Client-side search on the order reference and the customer's own reference. */
export function matchesSearch(order: Pick<OrderSummary, "reference" | "customer_reference">, search: string): boolean {
  const q = search.trim().toLowerCase();
  if (!q) return true;
  return order.reference.toLowerCase().includes(q) || (order.customer_reference ?? "").toLowerCase().includes(q);
}

/** Client-side search on SKU, name and description. */
export function matchesItemSearch(item: Pick<Item, "sku" | "name" | "description">, search: string): boolean {
  const q = search.trim().toLowerCase();
  if (!q) return true;
  return [item.sku, item.name, item.description ?? ""].some((s) => s.toLowerCase().includes(q));
}

// ---- Order actions -----------------------------------------------------------

export const canEdit = (s: OrderStatus) => s === "draft";
export const canSubmit = (s: OrderStatus) => s === "draft";
export const canCancel = (s: OrderStatus) => s === "draft" || s === "submitted";

/** The latest event that moved the order into `status` (e.g. the rejection with its reason). */
export function lastEventTo(events: OrderEvent[], status: OrderStatus): OrderEvent | undefined {
  for (let i = events.length - 1; i >= 0; i--) if (events[i].to_status === status) return events[i];
  return undefined;
}

/** Timeline oldest first (the API already sends it that way; this keeps it robust). */
export function sortEvents(events: OrderEvent[]): OrderEvent[] {
  return [...events].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id - b.id);
}

// ---- Totals -------------------------------------------------------------------

export interface Totals {
  units: number;
  weightKg: number;
  volumeM3: number;
  pallets: number;
}

/** Totals of builder lines, looking up the per-unit figures in `items` by id. */
export function lineTotals(
  lines: { itemId: number | null; quantity: number }[],
  itemsById: Map<number, Pick<Item, "weight_kg" | "volume_m3" | "pallet_spaces">>,
): Totals {
  const t: Totals = { units: 0, weightKg: 0, volumeM3: 0, pallets: 0 };
  for (const line of lines) {
    const item = line.itemId == null ? undefined : itemsById.get(line.itemId);
    if (!item || !Number.isFinite(line.quantity) || line.quantity <= 0) continue;
    t.units += line.quantity;
    t.weightKg += item.weight_kg * line.quantity;
    t.volumeM3 += item.volume_m3 * line.quantity;
    t.pallets += item.pallet_spaces * line.quantity;
  }
  return t;
}

/** Totals of a stored order's lines (per-unit figures are copied onto each line). */
export function orderLineTotals(order: Pick<Order, "lines">): Totals {
  return order.lines.reduce<Totals>(
    (t, l) => ({
      units: t.units + l.quantity,
      weightKg: t.weightKg + l.unit_weight_kg * l.quantity,
      volumeM3: t.volumeM3 + l.unit_volume_m3 * l.quantity,
      pallets: t.pallets + l.unit_pallet_spaces * l.quantity,
    }),
    { units: 0, weightKg: 0, volumeM3: 0, pallets: 0 },
  );
}

/** m³ from L × W × H in centimetres, rounded to 4 decimals (null if any side is missing). */
export function volumeFromCm(l: string, w: string, h: string): number | null {
  const dims = [l, w, h].map((s) => Number(s));
  if ([l, w, h].some((s) => s.trim() === "") || dims.some((d) => !Number.isFinite(d) || d <= 0)) return null;
  return Math.round(((dims[0] * dims[1] * dims[2]) / 1_000_000) * 10_000) / 10_000;
}

// ---- Validation -------------------------------------------------------------

export type FieldErrors = Record<string, string>;

const isBlank = (s: string | null | undefined) => !s || s.trim() === "";

function numberError(raw: string, opts: { required?: boolean; gt?: number; ge?: number; le?: number; integer?: boolean }): string | null {
  if (raw.trim() === "") return opts.required ? "Required." : null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return "Enter a number.";
  if (opts.integer && !Number.isInteger(n)) return "Enter a whole number.";
  if (opts.gt != null && !(n > opts.gt)) return `Must be more than ${opts.gt}.`;
  if (opts.ge != null && !(n >= opts.ge)) return `Must be ${opts.ge} or more.`;
  if (opts.le != null && !(n <= opts.le)) return `Must be ${opts.le.toLocaleString("en-AU")} or less.`;
  return null;
}

export interface ItemFormValues {
  sku: string;
  name: string;
  description: string;
  weight_kg: string;
  volume_m3: string;
  pallet_spaces: string;
}

export function validateItem(v: ItemFormValues): FieldErrors {
  const e: FieldErrors = {};
  if (isBlank(v.sku)) e.sku = "Enter a SKU.";
  else if (v.sku.trim().length > 64) e.sku = "At most 64 characters.";
  if (isBlank(v.name)) e.name = "Enter a name.";
  else if (v.name.trim().length > 200) e.name = "At most 200 characters.";
  if (v.description.length > 1000) e.description = "At most 1000 characters.";
  const w = numberError(v.weight_kg, { required: true, gt: 0, le: 100_000 });
  if (w) e.weight_kg = w;
  const vol = numberError(v.volume_m3, { ge: 0, le: 1_000 });
  if (vol) e.volume_m3 = vol;
  const p = numberError(v.pallet_spaces, { ge: 0, le: 100 });
  if (p) e.pallet_spaces = p;
  return e;
}

export interface AddressFormValues {
  label: string;
  contact_name: string;
  phone: string;
  line1: string;
  line2: string;
  suburb: string;
  state: string;
  postcode: string;
  country: string;
  notes: string;
}

export function validateAddress(v: AddressFormValues): FieldErrors {
  const e: FieldErrors = {};
  const req: [keyof AddressFormValues, string, number][] = [
    ["label", "Enter a label, e.g. “Main warehouse”.", 100],
    ["line1", "Enter the street address.", 200],
    ["suburb", "Enter the suburb.", 100],
    ["state", "Enter the state.", 50],
  ];
  for (const [field, msg, max] of req) {
    if (isBlank(v[field])) e[field] = msg;
    else if (v[field].trim().length > max) e[field] = `At most ${max} characters.`;
  }
  const pc = v.postcode.trim();
  if (!pc) e.postcode = "Enter the postcode.";
  else if (pc.length < 3 || pc.length > 10) e.postcode = "3 to 10 characters.";
  if (v.country.trim().length !== 2) e.country = "Two-letter country code, e.g. AU.";
  if (v.contact_name.length > 200) e.contact_name = "At most 200 characters.";
  if (v.phone.length > 50) e.phone = "At most 50 characters.";
  if (v.line2.length > 200) e.line2 = "At most 200 characters.";
  if (v.notes.length > 1000) e.notes = "At most 1000 characters.";
  return e;
}

export interface BuilderLine {
  key: string;
  itemId: string;
  quantity: string;
}

export interface OrderFormValues {
  pickup_address_id: string;
  delivery_address_id: string;
  delivery_date: string;
  window_start: string;
  window_end: string;
  customer_reference: string;
  notes: string;
  lines: BuilderLine[];
}

/** Client-side checks that mirror the API's (plus "not in the past"). Keys: field names, `lines`, `line:<key>`. */
export function validateOrder(v: OrderFormValues, today: string): FieldErrors {
  const e: FieldErrors = {};
  if (!v.pickup_address_id) e.pickup_address_id = "Choose a pickup address.";
  if (!v.delivery_address_id) e.delivery_address_id = "Choose a delivery address.";
  else if (v.delivery_address_id === v.pickup_address_id) e.delivery_address_id = "Pickup and delivery addresses must be different.";
  if (!v.delivery_date) e.delivery_date = "Choose a delivery date.";
  else if (!/^\d{4}-\d{2}-\d{2}$/.test(v.delivery_date)) e.delivery_date = "Use the format YYYY-MM-DD.";
  else if (v.delivery_date < today) e.delivery_date = "The delivery date can't be in the past.";
  if (v.window_start && v.window_end && v.window_start >= v.window_end) e.window_end = "The window must end after it starts.";
  if (v.customer_reference.length > 64) e.customer_reference = "At most 64 characters.";
  if (v.notes.length > 1000) e.notes = "At most 1000 characters.";
  if (v.lines.length === 0) e.lines = "Add at least one item.";
  const seen = new Set<string>();
  for (const line of v.lines) {
    if (!line.itemId) e[`line:${line.key}`] = "Choose an item.";
    else if (seen.has(line.itemId)) e[`line:${line.key}`] = "This item is already on the order; change its quantity instead.";
    else {
      const q = numberError(line.quantity, { required: true, ge: 1, le: 10_000, integer: true });
      if (q) e[`line:${line.key}`] = `Quantity: ${q.toLowerCase()}`;
    }
    if (line.itemId) seen.add(line.itemId);
  }
  if (v.lines.length > 100) e.lines = "At most 100 lines per order.";
  return e;
}

/** Lines that are complete enough to price (item chosen, positive whole quantity). */
export function pricedLines(lines: BuilderLine[]): { item_id: number; quantity: number }[] {
  const out: { item_id: number; quantity: number }[] = [];
  const seen = new Set<number>();
  for (const l of lines) {
    const id = Number(l.itemId);
    const q = Number(l.quantity);
    if (!l.itemId || !Number.isInteger(q) || q < 1 || q > 10_000 || seen.has(id)) continue;
    seen.add(id);
    out.push({ item_id: id, quantity: q });
  }
  return out;
}

/** "09:00:00" → "09:00" for <input type="time">. */
export const timeInput = (t: string | null | undefined) => (t ? t.slice(0, 5) : "");

/** Empty string → null (for nullable text fields). */
export const orNull = (s: string) => (s.trim() === "" ? null : s.trim());

// ---- API errors on form fields ------------------------------------------------

interface ValidationIssue {
  loc?: (string | number)[];
  msg: string;
}

/**
 * Split an API error detail into per-field messages (FastAPI 422 lists with
 * loc ["body", field, ...]) and one general message for the rest.
 */
export function splitApiErrors(detail: unknown, knownFields: string[]): { fields: FieldErrors; general: string[] } {
  const fields: FieldErrors = {};
  const general: string[] = [];
  if (!Array.isArray(detail)) return { fields, general };
  for (const issue of detail as ValidationIssue[]) {
    const loc = (issue.loc ?? []).filter((p) => p !== "body");
    const msg = String(issue.msg ?? "Invalid value.").replace(/^Value error, /, "");
    const field = typeof loc[0] === "string" ? loc[0] : undefined;
    if (field && knownFields.includes(field) && !fields[field]) fields[field] = msg;
    else general.push(loc.length ? `${loc.join(".")}: ${msg}` : msg);
  }
  return { fields, general };
}
