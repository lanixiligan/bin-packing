// Freight rows as edited in the table, and their validation into API FreightItems.
//
// A row keeps numbers as `number | null` (null = empty field while typing). `validateRows` turns
// rows into the request's items, or explains in plain language what to fix, per field. The
// backend still checks everything again (and owns the real rules); this only catches typos early.

import type { FreightItem, ReferenceData } from "../api/types.ts";
import { MAX_UNITS } from "../api/types.ts";

export interface FreightRow {
  /** Stable row id (also the API item id). */
  id: string;
  label: string;
  kind: "pallet" | "container";
  type_id: string;
  quantity: number | null;
  /** Per unit, kg, incl. pallet tare. */
  gross_weight_kg: number | null;
  /** Pallets only, mm incl. the pallet. */
  height_mm: number | null;
  stackable: boolean;
  temp_controlled: boolean;
  stop: number | null;
}

export type RowField = "label" | "type_id" | "quantity" | "gross_weight_kg" | "height_mm" | "stop";
/** Errors per row id, then per field: plain-language messages. */
export type RowErrors = Record<string, Partial<Record<RowField, string>>>;

export interface Validation {
  /** The request items when every row is valid, else null. */
  items: FreightItem[] | null;
  errors: RowErrors;
  /** Problems with the list as a whole (empty, too many units). */
  listErrors: string[];
}

let counter = 0;
/** A fresh row id that's unique within this page. */
export function newRowId(): string {
  counter += 1;
  return `line-${Date.now().toString(36)}-${counter}`;
}

/** A sensible new row: 1 × AU standard pallet, 500 kg, 1.2 m tall. */
export function newRow(ref: ReferenceData | null, overrides: Partial<FreightRow> = {}): FreightRow {
  return {
    id: newRowId(),
    label: "",
    kind: "pallet",
    type_id: ref?.pallet_defaults.default_pallet ?? "AU_STD",
    quantity: 1,
    gross_weight_kg: 500,
    height_mm: 1200,
    stackable: false,
    temp_controlled: false,
    stop: null,
    ...overrides,
  };
}

/** The rows a first visit starts with, so a plan shows straight away. */
export function sampleRows(ref: ReferenceData | null): FreightRow[] {
  return [
    newRow(ref, { label: "General freight", quantity: 10, gross_weight_kg: 800, height_mm: 1200 }),
    newRow(ref, { label: "Cartons", quantity: 6, gross_weight_kg: 350, height_mm: 900, stackable: true }),
  ];
}

const metres = (mm: number) => `${(mm / 1000).toLocaleString("en-AU", { maximumFractionDigits: 2 })} m`;

export function validateRows(rows: FreightRow[], ref: ReferenceData | null): Validation {
  const errors: RowErrors = {};
  const listErrors: string[] = [];
  if (rows.length === 0) listErrors.push("Add at least one line of freight.");

  for (const r of rows) {
    const e: Partial<Record<RowField, string>> = {};
    const table = r.kind === "pallet" ? ref?.pallets : ref?.containers;
    if (ref && !table?.[r.type_id]) e.type_id = `Pick a ${r.kind} type.`;
    if (r.quantity == null || !Number.isInteger(r.quantity) || r.quantity < 1) {
      e.quantity = "Enter how many, a whole number from 1.";
    } else if (r.quantity > 200) {
      e.quantity = "At most 200 per line: split it into more lines.";
    }
    if (r.gross_weight_kg == null || !(r.gross_weight_kg > 0)) {
      e.gross_weight_kg = "Enter the weight of one unit in kg.";
    } else if (r.kind === "pallet" && ref) {
      const p = ref.pallets[r.type_id];
      const max = p?.max_gross_kg ?? ref.pallet_defaults.max_gross_kg;
      if (r.gross_weight_kg > max) {
        e.gross_weight_kg = `This pallet weighs ${r.gross_weight_kg.toLocaleString("en-AU")} kg; one pallet is limited to ${max.toLocaleString("en-AU")} kg.`;
      }
    }
    if (r.kind === "pallet") {
      if (r.height_mm == null || !(r.height_mm > 0)) {
        e.height_mm = "Enter the pallet's height in mm, including the pallet.";
      } else if (ref && r.height_mm > ref.pallet_defaults.max_stack_height_mm) {
        e.height_mm = `This pallet is ${metres(r.height_mm)} tall; the max stack height is ${metres(ref.pallet_defaults.max_stack_height_mm)}.`;
      }
    }
    if (r.stop != null && (!Number.isInteger(r.stop) || r.stop < 1 || r.stop > 50)) {
      e.stop = "Stop is a whole number from 1 (first drop), or blank.";
    }
    if (Object.keys(e).length) errors[r.id] = e;
  }

  const units = rows.reduce((n, r) => n + (r.quantity ?? 0), 0);
  if (units > MAX_UNITS) listErrors.push(`That's ${units} units; one plan takes at most ${MAX_UNITS}. Split the freight into smaller plans.`);

  const ok = Object.keys(errors).length === 0 && listErrors.length === 0;
  return { items: ok ? rows.map(toItem) : null, errors, listErrors };
}

export function toItem(r: FreightRow): FreightItem {
  return {
    id: r.id,
    label: r.label,
    kind: r.kind,
    type_id: r.type_id,
    quantity: r.quantity ?? 1,
    gross_weight_kg: r.gross_weight_kg ?? 0,
    height_mm: r.kind === "pallet" ? r.height_mm : null,
    stackable: r.stackable,
    temp_controlled: r.temp_controlled,
    stop: r.stop,
  };
}
