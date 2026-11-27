// Short size labels for the truck overview and 3D view ("AU pallet, 1.2 m high", "6.0 × 0.4 × 0.3 m
// loose") and the screen reader text of a unit or a stack. Originally from the bin packing
// demo: only the label helpers the truck views use.
//
// Pure functions only (no React, no DOM), so they can be unit-tested with node.
import { dgTextOf, type DgLike } from "./capacity.ts";

const SHORT: Record<string, string> = { AU_STD: "AU", EURO: "Euro", ISO_UK: "ISO", NA: "NA", ASIA: "Asia", SQUARE: "Square" };

/** Short pallet name: "AU", "Euro", …; the id itself for an unknown type. */
export const palletShort = (id: string | null | undefined): string => (id ? SHORT[id] ?? id : "AU");

/** mm as metres with one or two decimals: 1200 → "1.2", 6000 → "6.0", 2480 → "2.48". */
export function metres(mm: number): string {
  return (mm / 1000).toLocaleString("en-AU", { minimumFractionDigits: 1, maximumFractionDigits: 2 });
}

/** A unit as the truck views see it (lib/sceneData.ts). */
export interface SizedLike {
  kind?: "pallet" | "loose" | string;
  pallet_type?: string | null;
  length_mm?: number | null;
  width_mm?: number | null;
  height_mm?: number | null;
}

const n = (v: unknown) => Number(v);

/** "AU · 1.2 m" for a pallet, "6.0 × 0.4 × 0.3 m" for a loose item (length × width × height). */
export function sizeLabel(s: SizedLike): string {
  if (s.kind === "loose") return `${metres(n(s.length_mm))} × ${metres(n(s.width_mm))} × ${metres(n(s.height_mm))} m`;
  return `${palletShort(s.pallet_type)} · ${metres(n(s.height_mm))} m`;
}

/** The same, spelt out for screen readers: "AU pallet, 1.2 m high" or "6.0 × 0.4 × 0.3 m loose". */
export function sizeSpoken(s: SizedLike): string {
  return s.kind === "loose" ? `${sizeLabel(s)} loose` : `${palletShort(s.pallet_type)} pallet, ${metres(n(s.height_mm))} m high`;
}

/** A placed unit. */
export type PlacedShipment = SizedLike & DgLike & { id: number; name: string; weight: number };

/** "Paint 1, AU pallet, 1.2 m high, 420 kg, Class 3" */
export function describeItem(s: PlacedShipment): string {
  const dg = dgTextOf(s);
  return `${s.name}, ${sizeSpoken(s)}, ${s.weight.toLocaleString("en-AU")} kg${dg ? `, ${dg}` : ""}`;
}
