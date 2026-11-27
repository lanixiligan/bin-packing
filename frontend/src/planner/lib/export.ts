// Load plan export: CSV text built from the planner's response (never recalculated), and a helper
// to save text as a file in the browser.
//
// The CSV has sections separated by a blank line: a summary (vehicle, fits, totals), capacity,
// axle loads, then one row per placement. Values are in mm, kg and m³ whatever the display units,
// so the file is easy to reuse. Fields are quoted per RFC 4180, and text that a spreadsheet would
// run as a formula (=, +, -, @ first) is prefixed with an apostrophe.
import type { FreightKind, PlanRequest, PlanResult, ReferenceData } from "../api/types.ts";

const EOL = "\r\n";

type Cell = string | number | boolean | null | undefined;

/** One CSV field: numbers as-is (rounded to 2 dp), text quoted when it needs to be. */
export function csvCell(value: Cell): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(Math.round(value * 100) / 100) : "";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  let text = value;
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]|^\s|\s$/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const csvRow = (cells: Cell[]) => cells.map(csvCell).join(",");

const SCHEME_NAMES = { GML: "General Mass Limits", HML: "Higher Mass Limits" } as const;

export const PLACEMENT_HEADER = [
  "Unit", "Item", "Type", "Deck", "X (mm)", "Y (mm)", "Z (mm)", "Length (mm)", "Width (mm)", "Height (mm)",
  "Weight (kg)", "Level",
];

export function planToCsv(result: PlanResult, request: PlanRequest, reference: ReferenceData): string {
  const vehicle = reference.vehicles[result.vehicle_id];
  const deckName = (id: string) => vehicle?.decks.find((d) => d.id === id)?.name ?? id;
  const typeName = (kind: FreightKind, id: string) => (kind === "loose" ? "Loose item"
    : (kind === "container" ? reference.containers[id]?.name : reference.pallets[id]?.name) ?? id);
  const itemLabel = (id: string) => request.items.find((it) => it.id === id)?.label?.trim();
  const u = result.utilisation;

  const rows: Cell[][] = [
    ["Load plan"],
    ["Vehicle", result.vehicle_name],
    ["Vehicle ID", result.vehicle_id],
    ["Body", reference.bodies[result.body_type]?.name ?? result.body_type],
    ["Mass limits", `${SCHEME_NAMES[result.mass_scheme]} (${result.mass_scheme})`],
    ["Fits", result.fits],
    ...result.reasons.map((r): Cell[] => ["Problem", r]),
    ["Total weight (kg)", result.total_weight_kg],
    ["Tallest point (mm)", result.max_load_height_mm],
    ["Height limit (mm)", vehicle?.overall_height_limit_mm ?? null],
    ["Units placed", result.placements.length],
    ["Units not placed", result.unplaced.length],
    ...(result.unplaced.length ? [["Not placed", result.unplaced.join("; ")] as Cell[]] : []),
    ["Note", "Planning estimate only: not compliance with the NTC Load Restraint Guide or mass limits."],
    [],
    ["Capacity", "Used", "Available", "Percent"],
    ["Pallet spaces", u.pallet_spaces.used, u.pallet_spaces.available, u.pallet_spaces.pct],
    ["TEU", u.teu.used, u.teu.available, u.teu.pct],
    ["Payload (kg)", u.payload_kg.used, u.payload_kg.available, u.payload_kg.pct],
    ["Volume (m3)", u.volume_m3.used, u.volume_m3.available, u.volume_m3.pct],
    [],
    ["Axle group", "Load (kg)", "Limit (kg)", "Status"],
    ...result.axle_loads.map((a): Cell[] => [a.name, Math.round(a.load_kg), Math.round(a.limit_kg), a.status]),
    [],
    ["Placements"],
    PLACEMENT_HEADER,
    ...result.placements.map((p): Cell[] => [
      p.unit_id, p.label?.trim() || itemLabel(p.item_id) || p.item_id, typeName(p.kind, p.type_id),
      deckName(p.deck_id), p.x_mm, p.y_mm, p.z_mm, p.length_mm, p.width_mm, p.height_mm, p.weight_kg,
      p.stack_level,
    ]),
  ];
  return rows.map(csvRow).join(EOL) + EOL;
}

/** "load-plan-SEMI_TRAILER-2026-11-27.csv" (local date). */
export function planCsvFilename(vehicleId: string, date: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const safeId = vehicleId.replace(/[^A-Za-z0-9_-]+/g, "_") || "vehicle";
  return `load-plan-${safeId}-${day}.csv`;
}

/** Save text as a file: a Blob behind a temporary object URL, revoked once the download starts. */
export function downloadText(filename: string, text: string, mime = "text/plain;charset=utf-8"): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  link.style.display = "none";
  document.body.appendChild(link);
  try {
    link.click();
  } finally {
    link.remove();
    // Some browsers read the URL after click() returns; revoke on the next tick.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}
