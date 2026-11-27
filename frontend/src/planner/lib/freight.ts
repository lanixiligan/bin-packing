// Freight rows as edited in the table, and their validation into API FreightItems.
//
// A row keeps numbers as `number | null` (null = empty field while typing). `validateRows` turns
// rows into the request's items, or explains in plain language what to fix, per field. The
// backend still checks everything again (and owns the real rules); this only catches typos early.

import type { DgInfo, FreightItem, FreightKind, ReferenceData } from "../api/types.ts";
import { isGeneral, normalise, validateDg, type DgClass, type DgLike, type Subsidiary } from "../../dg/rules.ts";
import type { ExampleLine, ShipmentExample } from "../../examples/shipmentExamples.ts";
import { LOOSE_TYPE, MAX_HEIGHT_MM, MAX_LOOSE_SIDE_MM, MAX_UNIT_WEIGHT_KG, MAX_UNITS } from "../api/types.ts";

export interface FreightRow {
  /** Stable row id (also the API item id). */
  id: string;
  label: string;
  /** "loose": a long or odd item with its own size (type_id "LOOSE"). */
  kind: FreightKind;
  type_id: string;
  quantity: number | null;
  /** Per unit, kg, incl. pallet tare. */
  gross_weight_kg: number | null;
  /** Loose items only, mm. */
  length_mm: number | null;
  width_mm: number | null;
  /** Pallets (mm incl. the pallet) and loose items. */
  height_mm: number | null;
  stackable: boolean;
  temp_controlled: boolean;
  /** Dangerous goods data; null = general freight. */
  dg: DgInfo | null;
}

export type RowField = "label" | "type_id" | "quantity" | "gross_weight_kg" | "length_mm" | "width_mm" | "height_mm" | "dg";
/** Errors per row id, then per field: plain-language messages. */
export type RowErrors = Record<string, Partial<Record<RowField, string>>>;

export interface Validation {
  /** The request items when every row is valid, else null. */
  items: FreightItem[] | null;
  errors: RowErrors;
  /** Problems with the list as a whole (empty, too many units). */
  listErrors: string[];
}

/** Most lines one plan takes (backend/app/planner/models.py PlanRequest.items). */
export const MAX_LINES = 100;

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
    length_mm: null,
    width_mm: null,
    height_mm: 1200,
    stackable: false,
    temp_controlled: false,
    dg: null,
    ...overrides,
  };
}

/** Starting sizes for a line switched to a loose item: a 3 m bundle. */
export const LOOSE_DEFAULTS = { length_mm: 3000, width_mm: 1000, height_mm: 500 } as const;

/** A loose row: its own length × width × height instead of a pallet type. */
export function newLooseRow(ref: ReferenceData | null, overrides: Partial<FreightRow> = {}): FreightRow {
  return newRow(ref, { kind: "loose", type_id: LOOSE_TYPE, ...LOOSE_DEFAULTS, ...overrides });
}

/** The rows a first visit starts with, so a plan shows straight away. */
export function sampleRows(ref: ReferenceData | null): FreightRow[] {
  return [
    newRow(ref, { label: "General freight", quantity: 10, gross_weight_kg: 800, height_mm: 1200 }),
    newRow(ref, { label: "Cartons", quantity: 6, gross_weight_kg: 350, height_mm: 900, stackable: true }),
  ];
}

/**
 * The DG data of an example line: "food", "fire_risk", a class ("3", "5.1"…) with its subsidiary
 * hazards, or null for general freight. t92: [] answers "none of Table 9.2's specific goods apply".
 */
function exampleDg(line: ExampleLine): DgInfo | null {
  if (!line.dgClass) return null;
  const base: DgLike = { subsidiary: [], t92: [], container: "package", food: false, fire_risk: false };
  if (line.dgClass === "food") return normalise({ ...base, food: true });
  if (line.dgClass === "fire_risk") return normalise({ ...base, fire_risk: true });
  const dgClass = line.dgClass as DgClass;
  return normalise({ ...base, dg_class: dgClass, subsidiary: line.subsidiary as Subsidiary[],
    explosive_code: dgClass === "1" ? "1.4S" : null });
}

/** The rows of an example load (src/examples/shipmentExamples.ts): one row per line, `count` → quantity. */
export function exampleRows(example: ShipmentExample, ref: ReferenceData | null): FreightRow[] {
  return example.lines.map((line) => {
    const common = {
      label: line.name, quantity: line.count, gross_weight_kg: line.weightKg, height_mm: line.heightMm,
      stackable: line.stackable, dg: exampleDg(line),
    };
    return line.palletType
      ? newRow(ref, { ...common, kind: "pallet", type_id: line.palletType })
      : newLooseRow(ref, { ...common, length_mm: line.lengthMm ?? null, width_mm: line.widthMm ?? null });
  });
}

/**
 * Parse pasted text such as "560, 490, 440 370\n360".
 * Separators: commas, semicolons, spaces, tabs and newlines. `invalid` lists the tokens that are
 * not whole numbers above 0.
 */
export function parseWeights(text: string): { weights: number[]; invalid: string[] } {
  const weights: number[] = [];
  const invalid: string[] = [];
  for (const token of text.split(/[\s,;]+/).filter(Boolean)) {
    if (/^\d+$/.test(token) && Number(token) > 0) weights.push(Number(token));
    else invalid.push(token);
  }
  return { weights, invalid };
}

/**
 * One row per pasted weight: 1 × AU standard pallet, 1.2 m high, not stackable, named
 * "General freight 01", "General freight 02"… counting on from `start` (the lines already listed).
 */
export function weightRows(weights: number[], ref: ReferenceData | null, start = 0): FreightRow[] {
  const typeId = ref && !ref.pallets.AU_STD ? ref.pallet_defaults.default_pallet : "AU_STD";
  return weights.map((w, i) => newRow(ref, {
    label: `General freight ${String(start + i + 1).padStart(2, "0")}`,
    type_id: typeId, quantity: 1, gross_weight_kg: w, height_mm: 1200, stackable: false,
  }));
}

const kg = (n: number) => `${n.toLocaleString("en-AU", { maximumFractionDigits: 0 })} kg`;
const metres = (mm: number) => `${(mm / 1000).toLocaleString("en-AU", { maximumFractionDigits: 2 })} m`;

export function validateRows(rows: FreightRow[], ref: ReferenceData | null): Validation {
  const errors: RowErrors = {};
  const listErrors: string[] = [];
  if (rows.length === 0) listErrors.push("Add at least one line of freight.");

  for (const r of rows) {
    const e: Partial<Record<RowField, string>> = {};
    const loose = r.kind === "loose";
    const table = r.kind === "pallet" ? ref?.pallets : ref?.containers;
    if (ref && !loose && !table?.[r.type_id]) e.type_id = `Pick a ${r.kind} type.`;
    if (r.quantity == null || !Number.isInteger(r.quantity) || r.quantity < 1) {
      e.quantity = "Enter how many, a whole number from 1.";
    } else if (r.quantity > 200) {
      e.quantity = "At most 200 per line: split it into more lines.";
    }
    if (r.gross_weight_kg == null || !(r.gross_weight_kg > 0)) {
      e.gross_weight_kg = `Enter the weight of one ${loose ? "item" : r.kind} in kg.`;
    } else if (r.gross_weight_kg > MAX_UNIT_WEIGHT_KG) {
      e.gross_weight_kg = `One unit can weigh at most ${kg(MAX_UNIT_WEIGHT_KG)}.`;
    } else if (r.kind === "pallet" && ref) {
      const p = ref.pallets[r.type_id];
      const max = p?.max_gross_kg ?? ref.pallet_defaults.max_gross_kg;
      const tare = ref.pallet_defaults.tare_kg;
      if (r.gross_weight_kg > max) {
        e.gross_weight_kg = `This pallet weighs ${kg(r.gross_weight_kg)}; one pallet is limited to ${kg(max)}.`;
      } else if (r.gross_weight_kg < tare) {
        e.gross_weight_kg = `That's lighter than an empty pallet (${kg(tare)}): include the pallet in the weight.`;
      }
    } else if (r.kind === "container" && ref) {
      const c = ref.containers[r.type_id];
      if (c?.max_gross_kg != null && r.gross_weight_kg > c.max_gross_kg) {
        e.gross_weight_kg = `This container weighs ${kg(r.gross_weight_kg)}; a ${c.name} is limited to ${kg(c.max_gross_kg)} gross.`;
      } else if (c?.tare_kg != null && r.gross_weight_kg < c.tare_kg) {
        e.gross_weight_kg = `An empty ${c.name} weighs ${kg(c.tare_kg)}: enter the gross weight, including the container.`;
      }
    }
    // Containers have a fixed height, so their height field is ignored.
    if (r.kind === "pallet") {
      if (r.height_mm == null || !(r.height_mm > 0)) {
        e.height_mm = "Enter the pallet's height in mm, including the pallet.";
      } else if (ref && r.height_mm > ref.pallet_defaults.max_stack_height_mm) {
        e.height_mm = `This pallet is ${metres(r.height_mm)} tall; the max stack height is ${metres(ref.pallet_defaults.max_stack_height_mm)}.`;
      }
    }
    // Loose items bring their own size: all three sides, whole millimetres, within what the planner takes.
    if (loose) {
      const side = (field: "length_mm" | "width_mm" | "height_mm", name: string, max: number) => {
        const v = r[field];
        if (v == null || !(v > 0)) e[field] = `Enter the item's ${name} in mm.`;
        else if (v > max) e[field] = `That's ${metres(v)}; the ${name} can be at most ${metres(max)}.`;
      };
      side("length_mm", "length", MAX_LOOSE_SIDE_MM);
      side("width_mm", "width", MAX_LOOSE_SIDE_MM);
      side("height_mm", "height", MAX_HEIGHT_MM);
    }
    const dgProblems = validateDg(r.dg);
    if (dgProblems.length) e.dg = dgProblems.join(" ");
    if (Object.keys(e).length) errors[r.id] = e;
  }

  const units = rows.reduce((n, r) => n + (r.quantity ?? 0), 0);
  if (units > MAX_UNITS) listErrors.push(`That's ${units} units; one plan takes at most ${MAX_UNITS}. Split the freight into smaller plans.`);

  const ok = Object.keys(errors).length === 0 && listErrors.length === 0;
  return { items: ok ? rows.map(toItem) : null, errors, listErrors };
}

export function toItem(r: FreightRow): FreightItem {
  const loose = r.kind === "loose";
  const mm = (v: number | null) => (v == null ? null : Math.round(v));
  return {
    id: r.id,
    label: r.label,
    kind: r.kind,
    type_id: loose ? LOOSE_TYPE : r.type_id,
    // The backend takes a length and width on loose items only, so other kinds leave them out.
    ...(loose ? { length_mm: mm(r.length_mm), width_mm: mm(r.width_mm) } : {}),
    quantity: r.quantity ?? 1,
    gross_weight_kg: r.gross_weight_kg ?? 0,
    height_mm: loose ? mm(r.height_mm) : r.kind === "pallet" ? r.height_mm : null,
    stackable: r.stackable,
    temp_controlled: r.temp_controlled,
    dg: isGeneral(r.dg) ? null : normalise(r.dg),
  };
}
