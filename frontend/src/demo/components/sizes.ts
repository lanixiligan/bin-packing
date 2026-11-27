// Shipment sizes: short labels ("AU · 1.2 m", "6.0 × 0.4 × 0.3 m"), footprints, and the checks
// the server makes before solving (a shipment that can never fit the vehicle), so the table can
// flag a row as soon as it is typed.
//
// Works on the browser's shipments (camelCase: kind, palletType, lengthMm, …) and on the solve
// response's (snake_case: pallet_type, length_mm, …).
// Pure functions only (no React, no DOM), so they can be unit-tested with node.
import { dgTextOf, type DgLike } from "./capacity.ts";
import type { DemoDeck, VehicleFit } from "./vehicle.ts";

/** Footprint of a pallet type (the reference's pallets, or the built-in fallback below). */
export interface PalletSize {
  length_mm: number;
  width_mm: number;
}
export type Pallets = Record<string, PalletSize>;

/** Common pallets, so labels and checks work before GET /api/reference has answered. */
export const KNOWN_PALLETS: Pallets = {
  AU_STD: { length_mm: 1165, width_mm: 1165 },
  EURO: { length_mm: 1200, width_mm: 800 },
  ISO_UK: { length_mm: 1200, width_mm: 1000 },
  NA: { length_mm: 1219, width_mm: 1016 },
  ASIA: { length_mm: 1100, width_mm: 1100 },
  SQUARE: { length_mm: 1067, width_mm: 1067 },
};

const SHORT: Record<string, string> = { AU_STD: "AU", EURO: "Euro", ISO_UK: "ISO", NA: "NA", ASIA: "Asia", SQUARE: "Square" };

/** Short pallet name for the table: "AU", "Euro", …; the id itself for an unknown type. */
export const palletShort = (id: string | null | undefined): string => (id ? SHORT[id] ?? id : "AU");

/** mm as metres with one or two decimals: 1200 → "1.2", 6000 → "6.0", 2480 → "2.48". */
export function metres(mm: number): string {
  return (mm / 1000).toLocaleString("en-AU", { minimumFractionDigits: 1, maximumFractionDigits: 2 });
}

/** A shipment from the browser list or from the solve response. */
export interface SizedLike {
  kind?: "pallet" | "loose" | string;
  palletType?: string | null;
  pallet_type?: string | null;
  lengthMm?: number | string | null;
  widthMm?: number | string | null;
  heightMm?: number | string | null;
  length_mm?: number | null;
  width_mm?: number | null;
  height_mm?: number | null;
  weight?: number | string;
  stackable?: boolean;
}

const n = (v: unknown) => Number(v);
const palletOf = (s: SizedLike) => s.palletType ?? s.pallet_type ?? null;
const heightOf = (s: SizedLike) => n(s.heightMm ?? s.height_mm);

/** "AU · 1.2 m" for a pallet, "6.0 × 0.4 × 0.3 m" for a loose item (length × width × height). */
export function sizeLabel(s: SizedLike): string {
  if (s.kind === "loose") {
    return `${metres(n(s.lengthMm ?? s.length_mm))} × ${metres(n(s.widthMm ?? s.width_mm))} × ${metres(heightOf(s))} m`;
  }
  return `${palletShort(palletOf(s))} · ${metres(heightOf(s))} m`;
}

/** The same, spelt out for screen readers: "AU pallet, 1.2 m high" or "6.0 × 0.4 × 0.3 m loose". */
export function sizeSpoken(s: SizedLike): string {
  return s.kind === "loose" ? `${sizeLabel(s)} loose` : `${palletShort(palletOf(s))} pallet, ${metres(heightOf(s))} m high`;
}

/** Footprint [length, width] in mm, or null when unknown (a pallet type that isn't known yet). */
export function footprintOf(s: SizedLike, pallets: Pallets = KNOWN_PALLETS): [number, number] | null {
  if (s.kind === "loose") {
    const l = n(s.lengthMm ?? s.length_mm);
    const w = n(s.widthMm ?? s.width_mm);
    return l > 0 && w > 0 ? [l, w] : null;
  }
  const p = pallets[palletOf(s) ?? "AU_STD"];
  return p ? [p.length_mm, p.width_mm] : null;
}

/** Volume in m³, 0 when a size is missing. */
export function volumeOf(s: SizedLike, pallets: Pallets = KNOWN_PALLETS): number {
  const fp = footprintOf(s, pallets);
  const h = heightOf(s);
  return fp && h > 0 ? (fp[0] * fp[1] * h) / 1e9 : 0;
}

/** True when an l × w footprint fits on the deck, as given or turned 90°. */
export const fitsDeck = (l: number, w: number, d: DemoDeck) =>
  (l <= d.length_mm && w <= d.width_mm) || (w <= d.length_mm && l <= d.width_mm);

export interface FitProblems {
  /** Longer or wider than every deck, even turned. */
  tooLong: boolean;
  /** Taller than the inside height. */
  tooTall: boolean;
  /** Heavier than the payload. */
  tooHeavy: boolean;
  /** One plain sentence per problem, for the row. */
  messages: string[];
}

/**
 * Why a shipment can never go on the vehicle, mirroring the server's checks: its footprint is
 * longer or wider than every deck in both orientations, it is taller than the inside height, or
 * heavier than the payload. Sizes that are missing or not numbers yet are not flagged here.
 */
export function fitProblems(s: SizedLike, fit: VehicleFit | null, pallets: Pallets = KNOWN_PALLETS): FitProblems {
  const out: FitProblems = { tooLong: false, tooTall: false, tooHeavy: false, messages: [] };
  if (!fit || fit.decks.length === 0) return out;
  const fp = footprintOf(s, pallets);
  if (fp && !fit.decks.some((d) => fitsDeck(fp[0], fp[1], d))) {
    out.tooLong = true;
    const d = fit.decks[0];
    out.messages.push(fit.decks.length === 1
      ? `Too long or wide for the ${metres(d.length_mm)} × ${metres(d.width_mm)} m deck, even turned.`
      : "Too long or wide for every deck, even turned.");
  }
  const inside = Math.max(...fit.decks.map((d) => d.height_mm));
  const h = heightOf(s);
  if (h > inside) {
    out.tooTall = true;
    out.messages.push(`Taller than the ${metres(inside)} m inside height.`);
  }
  const kg = n(s.weight);
  if (kg > fit.payloadKg) {
    out.tooHeavy = true;
    out.messages.push(`Heavier than the ${fit.payloadKg.toLocaleString("en-AU")} kg payload.`);
  }
  return out;
}

const MAX_DIMENSION_MM = 20_000; // backend/app/demo_models.py

const wholeIn = (v: unknown, lo: number, hi: number) => {
  const x = Number(v);
  return v !== "" && v != null && Number.isInteger(x) && x >= lo && x <= hi;
};

/**
 * What is missing or wrong in a shipment's own fields (before any fit check), or "": a name,
 * a whole kg above 0, whole mm sizes above 0, a pallet type for a pallet.
 */
export function inputProblem(s: SizedLike & { name?: string }): string {
  if (!String(s.name ?? "").trim()) return "needs a name";
  if (!wholeIn(s.weight, 1, 100_000)) return "needs a whole-number weight above 0 kg";
  if (s.kind === "loose" && !(wholeIn(s.lengthMm, 1, MAX_DIMENSION_MM) && wholeIn(s.widthMm, 1, MAX_DIMENSION_MM))) {
    return "needs a length and width in whole mm";
  }
  if (s.kind !== "loose" && !palletOf(s)) return "needs a pallet type";
  if (!wholeIn(s.heightMm, 1, MAX_DIMENSION_MM)) return "needs a height in whole mm";
  return "";
}

// ---- Labels for the truck views ---------------------------------------------------------

/** A placed shipment from the solve response. */
export type PlacedShipment = SizedLike & DgLike & { id: number; name: string; weight: number };

/** "Paint 01, AU pallet, 1.2 m high, 420 kg, Class 3" */
export function describeItem(s: PlacedShipment): string {
  const dg = dgTextOf(s);
  return `${s.name}, ${sizeSpoken(s)}, ${s.weight.toLocaleString("en-AU")} kg${dg ? `, ${dg}` : ""}`;
}

/**
 * The label of a column drawn on a deck: one item, or a stack bottom first with its height.
 * "Pipes 03, 4.6 × 0.4 × 0.3 m loose, 250 kg, truck 1 of 2"
 * "Stack of 2, 2.4 m high: level 1, Paint 01, …; level 2, Paint 02, …; truck 1 of 2"
 */
export function columnLabel(items: PlacedShipment[], topMm: number, truck: number, numTrucks: number): string {
  const where = `truck ${truck} of ${numTrucks}`;
  if (items.length === 1) return `${describeItem(items[0])}, ${where}`;
  const levels = items.map((s, k) => `level ${k + 1}, ${describeItem(s)}`).join("; ");
  return `Stack of ${items.length}, ${metres(topMm)} m high: ${levels}; ${where}`;
}
