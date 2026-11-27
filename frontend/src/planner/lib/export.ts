// Load plan export: CSV text built from the planner's response (never recalculated), and a helper
// to save text as a file in the browser.
//
// The CSV has sections separated by a blank line: a summary (vehicle, fits, totals), capacity,
// axle loads, then one row per placement. Values are in mm, kg and m³ whatever the display units,
// so the file is easy to reuse. A split across trucks (fleetToCsv) has a summary, then one table each
// for the trucks, their axle loads and their placements, every row starting with its truck. Fields are quoted per RFC 4180, and text that a spreadsheet would
// run as a formula (=, +, -, @ first) is prefixed with an apostrophe.
import type { FleetResult, FreightKind, Placement, PlanRequest, PlanResult, ReferenceData } from "../api/types.ts";

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

const NOTE = "Planning estimate only: not compliance with the NTC Load Restraint Guide or mass limits.";

/** A placement's cells under PLACEMENT_HEADER, for a plan on `vehicleId`. */
function placementCells(vehicleId: string, request: PlanRequest, reference: ReferenceData): (p: Placement) => Cell[] {
  const vehicle = reference.vehicles[vehicleId];
  const deckName = (id: string) => vehicle?.decks.find((d) => d.id === id)?.name ?? id;
  const typeName = (kind: FreightKind, id: string) => (kind === "loose" ? "Loose item"
    : (kind === "container" ? reference.containers[id]?.name : reference.pallets[id]?.name) ?? id);
  const itemLabel = (id: string) => request.items.find((it) => it.id === id)?.label?.trim();
  return (p) => [
    p.unit_id, p.label?.trim() || itemLabel(p.item_id) || p.item_id, typeName(p.kind, p.type_id),
    deckName(p.deck_id), p.x_mm, p.y_mm, p.z_mm, p.length_mm, p.width_mm, p.height_mm, p.weight_kg,
    p.stack_level,
  ];
}

export function planToCsv(result: PlanResult, request: PlanRequest, reference: ReferenceData): string {
  const vehicle = reference.vehicles[result.vehicle_id];
  const cells = placementCells(result.vehicle_id, request, reference);
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
    ["Note", NOTE],
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
    ...result.placements.map(cells),
  ];
  return rows.map(csvRow).join(EOL) + EOL;
}

export const TRUCK_COLUMN = "Truck";

/**
 * A load split across trucks: a summary, then the trucks, their axle loads and their placements, each
 * as one table whose first column is the truck number (1 = Truck 1), so it filters and pivots easily.
 */
export function fleetToCsv(fleet: FleetResult, request: PlanRequest, reference: ReferenceData): string {
  const vehicle = reference.vehicles[fleet.vehicle_id];
  const cells = placementCells(fleet.vehicle_id, request, reference);
  const b = fleet.lower_bounds;
  const trucks = fleet.trucks.map((truck, i) => ({ truck, n: i + 1 }));

  const rows: Cell[][] = [
    ["Load plan: split across trucks"],
    ["Vehicle", fleet.vehicle_name],
    ["Vehicle ID", fleet.vehicle_id],
    ["Body", reference.bodies[fleet.body_type]?.name ?? fleet.body_type],
    ["Mass limits", `${SCHEME_NAMES[fleet.mass_scheme]} (${fleet.mass_scheme})`],
    ["Trucks", fleet.num_trucks],
    ["Fewest trucks proven", fleet.optimal],
    ["Fewest trucks possible", fleet.lower_bound],
    ["Fewest by weight", b.weight ?? null],
    ["Fewest by floor space", b.floor ?? null],
    ["Fewest by volume", b.volume ?? null],
    ["Method", fleet.method === "exact" ? "Exact solver" : "Truck by truck (not proven)"],
    ["Fits", fleet.fits],
    ...fleet.reasons.map((r): Cell[] => ["Problem", r]),
    ["Height limit (mm)", vehicle?.overall_height_limit_mm ?? null],
    ["Units placed", fleet.trucks.reduce((n, t) => n + t.placements.length, 0)],
    ["Units not placed", fleet.unplaced.length],
    ...(fleet.unplaced.length ? [["Not placed", fleet.unplaced.join("; ")] as Cell[]] : []),
    ["Note", NOTE],
    [],
    ["Trucks"],
    [TRUCK_COLUMN, "Fits", "Units", "Total weight (kg)", "Payload (%)", "Pallet spaces used", "Pallet spaces (%)",
     "Volume (m3)", "Volume (%)", "Tallest point (mm)", "Problems"],
    ...trucks.map(({ truck, n }): Cell[] => {
      const u = truck.utilisation;
      return [n, truck.fits, truck.placements.length, truck.total_weight_kg, u.payload_kg.pct, u.pallet_spaces.used,
              u.pallet_spaces.pct, u.volume_m3.used, u.volume_m3.pct, truck.max_load_height_mm, truck.reasons.join("; ")];
    }),
    [],
    ["Axle loads"],
    [TRUCK_COLUMN, "Axle group", "Load (kg)", "Limit (kg)", "Status"],
    ...trucks.flatMap(({ truck, n }) => truck.axle_loads.map((a): Cell[] =>
      [n, a.name, Math.round(a.load_kg), Math.round(a.limit_kg), a.status])),
    [],
    ["Placements"],
    [TRUCK_COLUMN, ...PLACEMENT_HEADER],
    ...trucks.flatMap(({ truck, n }) => truck.placements.map((p): Cell[] => [n, ...cells(p)])),
  ];
  return rows.map(csvRow).join(EOL) + EOL;
}

/** "load-plan-SEMI_TRAILER-2026-11-27.csv" (local date); with `trucks`, "load-plan-SEMI_TRAILER-3-trucks-2026-11-27.csv". */
export function planCsvFilename(vehicleId: string, date: Date = new Date(), trucks?: number): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const safeId = vehicleId.replace(/[^A-Za-z0-9_-]+/g, "_") || "vehicle";
  const split = trucks === undefined ? "" : `-${trucks}-${trucks === 1 ? "truck" : "trucks"}`;
  return `load-plan-${safeId}${split}-${day}.csv`;
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
