// Pure helpers of the portal area: status groups, totals, form validation and
// mapping API errors onto form fields. No React here, so it can be unit-tested
// with `node --test` (see logic.test.ts).
import {
  CLASS_NAMES, NO_PACKING_GROUP, checkAll, dgLabel, isGeneral, validateDg,
  type CarrierTag, type Container, type DgClass, type DgInfo, type DgLike, type Subsidiary, type T92Tag,
} from "../dg/rules.ts";
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

/** Client-side search on SKU, name, description and the DG label, class name or UN number. */
export function matchesItemSearch(item: Pick<Item, "sku" | "name" | "description"> & { dg?: DgLike }, search: string): boolean {
  const q = search.trim().toLowerCase();
  if (!q) return true;
  const fields = [item.sku, item.name, item.description ?? ""];
  if (!isGeneral(item.dg)) {
    fields.push(dgLabel(item.dg));
    if (item.dg?.dg_class) fields.push(CLASS_NAMES[item.dg.dg_class]);
    if (item.dg?.un_number) fields.push(`UN ${item.dg.un_number}`, `UN${item.dg.un_number}`);
  }
  return fields.some((s) => s.toLowerCase().includes(q));
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

/** Volume with enough decimals for small items: 0.003 m³ stays 0.003, not "0". */
export function formatVolume(m3: number): string {
  const digits = m3 !== 0 && Math.abs(m3) < 0.1 ? 3 : 2;
  return `${m3.toLocaleString(undefined, { maximumFractionDigits: digits })} m³`;
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
  dg: DgFormValues;
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
  return { ...e, ...validateDgForm(v.dg) };
}

// ---- Dangerous goods on the item form ------------------------------------------

/**
 * The item form's DG section. Fields the chosen class doesn't use (packing
 * group for Class 2, explosive code outside Class 1, ...) may keep stale
 * values while hidden; `dgFromForm` drops them.
 */
export interface DgFormValues {
  kind: "general" | "dg";
  /** General freight: food or food packaging. */
  food: boolean;
  /** General freight: a combustible liquid that isn't DG. */
  combustible: boolean;
  dg_class: DgClass | "";
  subsidiary: Subsidiary[];
  packing_group: "" | "I" | "II" | "III";
  un_number: string;
  explosive_code: string;
  container: Container;
  /** Class 6 / 9 goods that are fire-risk substances (exception 5). */
  fire_risk: boolean;
  /** false = Table 9.2 not checked yet (t92 null). */
  t92_checked: boolean;
  t92: T92Tag[];
  carrier_tags: CarrierTag[];
}

/** Field keys of the DG section (server 422 locs `dg.<field>` map onto these; `dg` = the section). */
export const DG_FIELDS = [
  "dg", "dg.dg_class", "dg.subsidiary", "dg.packing_group", "dg.un_number", "dg.explosive_code",
  "dg.container", "dg.fire_risk", "dg.t92", "dg.carrier_tags", "dg.food",
];

export const hasPackingGroup = (cls: string) => !!cls && !NO_PACKING_GROUP.has(cls);
/** Exception 5: only Class 6 and 9 goods can be marked as fire-risk substances. */
export const canBeFireRisk = (cls: string) => cls.startsWith("6") || cls === "9";

export function dgToForm(dg: DgLike): DgFormValues {
  const cls = dg?.dg_class ?? "";
  return {
    kind: cls ? "dg" : "general",
    food: !cls && !!dg?.food,
    combustible: !cls && !dg?.food && !!dg?.fire_risk,
    dg_class: cls,
    subsidiary: [...(dg?.subsidiary ?? [])],
    packing_group: dg?.packing_group ?? "",
    un_number: dg?.un_number ?? "",
    explosive_code: dg?.explosive_code ?? "",
    container: (cls && dg?.container) || "package",
    fire_risk: !!cls && !!dg?.fire_risk,
    t92_checked: !!cls && dg?.t92 != null,
    t92: [...(dg?.t92 ?? [])],
    carrier_tags: [...(dg?.carrier_tags ?? [])],
  };
}

/** What to send as the item's `dg`: null for general freight, else a full DgInfo. */
export function dgFromForm(f: DgFormValues): DgInfo | null {
  const base: DgInfo = {
    dg_class: null, subsidiary: [], packing_group: null, un_number: null, explosive_code: null,
    container: "package", t92: null, carrier_tags: [], food: false, fire_risk: false,
  };
  if (f.kind === "general") {
    if (!f.food && !f.combustible) return null;
    return { ...base, food: f.food, fire_risk: !f.food && f.combustible };
  }
  const c = f.dg_class;
  if (!c) return base; // validation stops this before it's sent
  const sorted = <T extends string>(xs: T[]) => [...new Set(xs)].sort();
  return {
    ...base,
    dg_class: c,
    subsidiary: sorted(f.subsidiary.filter((s) => s !== c)),
    packing_group: hasPackingGroup(c) ? f.packing_group || null : null,
    un_number: f.un_number.trim() || null,
    explosive_code: c === "1" ? f.explosive_code.trim().toUpperCase() || null : null,
    container: f.container,
    t92: f.t92_checked ? sorted(f.t92) : null,
    carrier_tags: sorted(f.carrier_tags),
    fire_risk: canBeFireRisk(c) && f.fire_risk,
  };
}

/** Which form field a `validateDg` message belongs to (unmatched ones go on the section). */
const DG_MESSAGE_FIELDS: [RegExp, string][] = [
  [/UN number/, "dg.un_number"],
  [/^Class 1 needs/, "dg.explosive_code"],
  [/no packing groups/, "dg.packing_group"],
  [/^Cylinders and aerosols/, "dg.container"],
  [/subsidiary hazard/, "dg.subsidiary"],
  [/^'Fire-risk'/, "dg.fire_risk"],
  [/Table 9\.2 tags|^Nitromethane/, "dg.t92"],
];

/** The DG section's errors, keyed like DG_FIELDS. Uses validateDg (the backend's rules). */
export function validateDgForm(f: DgFormValues): FieldErrors {
  const e: FieldErrors = {};
  if (f.kind === "general") {
    if (f.food && f.combustible) e["dg.food"] = "An item can't be both food and fire-risk goods.";
    return e;
  }
  if (!f.dg_class) e["dg.dg_class"] = "Choose the DG class (from the SDS, section 14).";
  if (f.un_number.trim() && !/^\d{4}$/.test(f.un_number.trim())) e["dg.un_number"] = "The UN number has 4 digits, e.g. 1263.";
  if (!f.dg_class) return e;
  if (f.subsidiary.filter((x) => x !== f.dg_class).length > 4) e["dg.subsidiary"] = "At most 4 subsidiary hazards.";
  for (const msg of validateDg(dgFromForm(f))) {
    const key = DG_MESSAGE_FIELDS.find(([re]) => re.test(msg))?.[1] ?? "dg";
    if (!e[key]) e[key] = msg;
  }
  return e;
}

/** "Pool chlorine (Class 5.1)"; general freight keeps its bare name (as the backend's DgConflict items). */
export function dgItemLabel(name: string, dg: DgLike): string {
  return isGeneral(dg) ? name : `${name} (${dgLabel(dg)})`;
}

export interface DgPairWarning {
  key: string;
  a: string;
  b: string;
  /** The first (most specific) reason; `reasons` has them all. */
  reason: string;
  reasons: string[];
}

/**
 * DG pairs among the order builder's chosen items: `incompatible` ones travel
 * on separate vehicles, `check` ones need the Table 9.2 details (a warning only).
 */
export function orderDgWarnings(
  lines: { itemId: string }[],
  itemsById: Map<number, { id: number; name: string; dg?: DgLike }>,
): { incompatible: DgPairWarning[]; check: DgPairWarning[] } {
  const seen = new Set<number>();
  const chosen: { id: number; name: string; dg?: DgLike }[] = [];
  for (const l of lines) {
    const item = l.itemId ? itemsById.get(Number(l.itemId)) : undefined;
    if (item && !seen.has(item.id)) {
      seen.add(item.id);
      chosen.push(item);
    }
  }
  const out = { incompatible: [] as DgPairWarning[], check: [] as DgPairWarning[] };
  for (const p of checkAll(chosen, (i) => i.dg)) {
    out[p.status].push({
      key: `${p.a.id}-${p.b.id}`,
      a: dgItemLabel(p.a.name, p.a.dg),
      b: dgItemLabel(p.b.name, p.b.dg),
      reason: p.reasons[0] ?? "",
      reasons: p.reasons,
    });
  }
  return out;
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
 * loc ["body", field, ...]) and one general message for the rest. A known
 * field may be a dotted path ("dg.un_number"): the longest known prefix of
 * the loc wins, so ["body", "dg", "t92", 0] lands on "dg.t92" (or "dg").
 */
export function splitApiErrors(detail: unknown, knownFields: string[]): { fields: FieldErrors; general: string[] } {
  const fields: FieldErrors = {};
  const general: string[] = [];
  if (!Array.isArray(detail)) return { fields, general };
  for (const issue of detail as ValidationIssue[]) {
    const loc = (issue.loc ?? []).filter((p) => p !== "body");
    const msg = String(issue.msg ?? "Invalid value.").replace(/^Value error, /, "");
    let field: string | undefined;
    for (let n = loc.length; n > 0 && !field; n--) {
      const path = loc.slice(0, n).join(".");
      if (typeof loc[0] === "string" && knownFields.includes(path)) field = path;
    }
    if (field && !fields[field]) fields[field] = msg;
    else general.push(loc.length ? `${loc.join(".")}: ${msg}` : msg);
  }
  return { fields, general };
}
