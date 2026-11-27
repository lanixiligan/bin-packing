// CSV import / export for freight rows.
//
// Columns: label, kind, type, quantity, weight_kg, height_mm, stackable, temp_controlled, stop.
// The header row is optional: with one, columns can come in any order (and a few common aliases
// are accepted); without one, they're read in the order above. Types match by id or name, ignoring
// case and punctuation ("hc40", "40' High cube", "40HC"), and the kind is inferred from the type
// when it's blank. Problems are reported per line in plain language; good lines still import.

import type { ReferenceData } from "../api/types.ts";
import { newRowId, type FreightRow } from "./freight.ts";

export const CSV_COLUMNS = [
  "label", "kind", "type", "quantity", "weight_kg", "height_mm", "stackable", "temp_controlled", "stop",
] as const;
type Column = (typeof CSV_COLUMNS)[number];

const ALIASES: Record<string, Column> = {
  label: "label", name: "label", description: "label", item: "label",
  kind: "kind",
  type: "type", typeid: "type", pallettype: "type", containertype: "type",
  quantity: "quantity", qty: "quantity", count: "quantity", units: "quantity",
  weightkg: "weight_kg", weight: "weight_kg", grossweightkg: "weight_kg", grossweight: "weight_kg", kg: "weight_kg",
  heightmm: "height_mm", height: "height_mm", mm: "height_mm",
  stackable: "stackable", stack: "stackable",
  tempcontrolled: "temp_controlled", temp: "temp_controlled", refrigerated: "temp_controlled", reefer: "temp_controlled",
  stop: "stop", drop: "stop",
};

export interface CsvProblem {
  /** 1-based line in the pasted text or file. */
  line: number;
  /** Plain language, starting "Line N: ". */
  message: string;
}

export interface CsvParseResult {
  rows: FreightRow[];
  problems: CsvProblem[];
  /** True when the first line was read as a header. */
  header: boolean;
}

interface CsvRecord {
  line: number;
  cells: string[];
}

/** Splits CSV text into records, honouring quotes ("a, b", "say ""hi""") and newlines in quotes. */
export function parseRecords(text: string): CsvRecord[] {
  const records: CsvRecord[] = [];
  let cells: string[] = [];
  let cell = "";
  let quoted = false;
  let line = 1;
  let start = 1;
  const src = text.replace(/^\uFEFF/, "");
  const endRecord = () => {
    cells.push(cell);
    if (cells.some((c) => c.trim() !== "")) records.push({ line: start, cells });
    cells = [];
    cell = "";
  };
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        if (ch === "\n") line++;
        cell += ch;
      }
    } else if (ch === '"' && cell.trim() === "") {
      cell = "";
      quoted = true;
    } else if (ch === ",") {
      cells.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      endRecord();
      line++;
      start = line;
    } else {
      cell += ch;
    }
  }
  if (cell !== "" || cells.length) endRecord();
  return records;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

interface TypeMatch {
  kind: FreightRow["kind"];
  id: string;
}

/** Lookup from normalised ids, names and short forms to reference types. */
function typeIndex(ref: ReferenceData): Map<string, TypeMatch> {
  const index = new Map<string, TypeMatch>();
  const add = (key: string, m: TypeMatch) => {
    const k = norm(key);
    if (k && !index.has(k)) index.set(k, m);
  };
  for (const p of Object.values(ref.pallets)) {
    const m = { kind: "pallet" as const, id: p.id };
    add(p.id, m);
    add(p.name, m);
    add(p.name.replace(/\s*\(.*\)\s*/, ""), m); // "Euro (EUR / EPAL)" -> "Euro"
  }
  add("au", { kind: "pallet", id: ref.pallet_defaults.default_pallet });
  add("australian", { kind: "pallet", id: ref.pallet_defaults.default_pallet });
  for (const c of Object.values(ref.containers)) {
    const m = { kind: "container" as const, id: c.id };
    add(c.id, m);
    add(c.name, m);
    const short = /^([A-Z]+)(\d+)$/.exec(c.id); // HC40 -> 40HC
    if (short) add(`${short[2]}${short[1]}`, m);
  }
  return index;
}

const TRUE = new Set(["yes", "y", "true", "t", "1"]);
const FALSE = new Set(["no", "n", "false", "f", "0", ""]);

/** Parses CSV text into freight rows, with a plain-language problem for every line it can't use. */
export function parseCsv(text: string, ref: ReferenceData, makeId: () => string = newRowId): CsvParseResult {
  const records = parseRecords(text);
  const problems: CsvProblem[] = [];
  const rows: FreightRow[] = [];
  if (records.length === 0) return { rows, problems, header: false };

  // Header: at least two cells name known columns.
  const first = records[0].cells.map((c) => ALIASES[norm(c)]);
  const header = first.filter(Boolean).length >= 2;
  const columns: (Column | undefined)[] = header ? first : [...CSV_COLUMNS];
  if (header && !first.includes("type") && !first.includes("kind")) {
    problems.push({ line: records[0].line, message: `Line ${records[0].line}: the header has no "type" column.` });
  }
  const types = typeIndex(ref);

  for (const rec of header ? records.slice(1) : records) {
    const at = `Line ${rec.line}`;
    const get = (col: Column) => {
      const i = columns.indexOf(col);
      return i >= 0 ? (rec.cells[i] ?? "").trim() : "";
    };
    const issues: string[] = [];

    // Kind and type.
    const kindText = norm(get("kind"));
    let kind: FreightRow["kind"] | null = null;
    if (["pallet", "pallets", "p"].includes(kindText)) kind = "pallet";
    else if (["container", "containers", "c"].includes(kindText)) kind = "container";
    else if (kindText) issues.push(`kind should be "pallet" or "container", not "${get("kind")}"`);

    const typeText = get("type");
    let typeId = "";
    if (typeText) {
      const m = types.get(norm(typeText));
      if (!m) issues.push(`type "${typeText}" isn't a pallet or container type we know`);
      else if (kind && m.kind !== kind) issues.push(`"${typeText}" is a ${m.kind} type, not a ${kind}`);
      else {
        kind = m.kind;
        typeId = m.id;
      }
    } else if (kind === "pallet") {
      typeId = ref.pallet_defaults.default_pallet;
    } else {
      issues.push("type is missing");
    }

    // Numbers.
    const number = (col: Column, name: string, opts: { required: boolean; whole?: boolean; min?: number; max?: number }) => {
      const raw = get(col);
      const cleaned = raw.replace(/[\s,_]/g, "").replace(/(kg|mm)$/i, "");
      if (cleaned === "") {
        if (opts.required) issues.push(`${name} is missing`);
        return null;
      }
      const n = Number(cleaned);
      if (!Number.isFinite(n)) {
        issues.push(`${name} "${raw}" isn't a number`);
        return null;
      }
      if ((opts.whole && !Number.isInteger(n)) || (opts.min != null && n < opts.min) || (opts.max != null && n > opts.max)) {
        const range = opts.max != null ? `from ${opts.min} to ${opts.max}` : `from ${opts.min}`;
        issues.push(`${name} should be ${opts.whole ? "a whole number" : "a number"} ${range}, not "${raw}"`);
        return null;
      }
      return n;
    };
    const quantity = get("quantity") === "" ? 1 : number("quantity", "quantity", { required: true, whole: true, min: 1 });
    const weight = number("weight_kg", "weight", { required: true, min: 0.001 });
    const height = kind === "container" ? null : number("height_mm", "height", { required: true, min: 1 });
    const stop = number("stop", "stop", { required: false, whole: true, min: 1, max: 50 });

    // Yes / no.
    const flag = (col: Column, name: string) => {
      const raw = get(col);
      const v = raw.toLowerCase();
      if (TRUE.has(v)) return true;
      if (FALSE.has(v)) return false;
      issues.push(`${name} should be yes or no, not "${raw}"`);
      return false;
    };
    const stackable = flag("stackable", "stackable");
    const temp = flag("temp_controlled", "temp-controlled");

    if (issues.length) {
      for (const issue of issues) problems.push({ line: rec.line, message: `${at}: ${issue}.` });
      continue;
    }
    rows.push({
      id: makeId(),
      label: get("label"),
      kind: kind!,
      type_id: typeId,
      quantity,
      gross_weight_kg: weight,
      height_mm: height,
      stackable: kind === "pallet" && stackable,
      temp_controlled: temp,
      stop,
    });
  }
  return { rows, problems, header };
}

const quote = (v: string) => (/[",\r\n]/.test(v) || v !== v.trim() ? `"${v.replace(/"/g, '""')}"` : v);
const num = (n: number | null) => (n == null ? "" : String(n));

/** Rows as CSV with a header row; parseCsv reads it back to the same rows (new ids). */
export function toCsv(rows: FreightRow[]): string {
  const lines = [CSV_COLUMNS.join(",")];
  for (const r of rows) {
    lines.push([
      quote(r.label),
      r.kind,
      quote(r.type_id),
      num(r.quantity),
      num(r.gross_weight_kg),
      r.kind === "pallet" ? num(r.height_mm) : "",
      r.kind === "pallet" && r.stackable ? "yes" : "no",
      r.temp_controlled ? "yes" : "no",
      num(r.stop),
    ].join(","));
  }
  return `${lines.join("\n")}\n`;
}
