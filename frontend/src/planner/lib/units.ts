// Display-only unit conversion. Data stays in mm / kg / m³; these helpers format it.
//
// Two display systems:
//   "mm-kg": 1,165 mm · 22,000 kg (the default: what loaders and carriers quote)
//   "m-t":   1.17 m   · 22.0 t
// Volume is always m³. Numbers use en-AU grouping; render them with tabular numerals (CSS).

import { createContext, useContext } from "react";

export type UnitSystem = "mm-kg" | "m-t";

const nf = (max: number, min = 0) =>
  new Intl.NumberFormat("en-AU", { maximumFractionDigits: max, minimumFractionDigits: min });
const int = nf(0);
const one = nf(1, 1);
const two = nf(2, 2);

export function formatLength(mm: number, system: UnitSystem = "mm-kg"): string {
  return system === "m-t" ? `${two.format(mm / 1000)} m` : `${int.format(Math.round(mm))} mm`;
}

export function formatWeight(kg: number, system: UnitSystem = "mm-kg"): string {
  return system === "m-t" ? `${one.format(kg / 1000)} t` : `${int.format(Math.round(kg))} kg`;
}

export function formatVolume(m3: number): string {
  return `${one.format(m3)} m³`;
}

export function formatPercent(pct: number): string {
  return `${int.format(Math.round(pct))} %`;
}

/** Plain number with grouping (counts, pallet spaces with up to 1 dp, TEU with up to 2). */
export function formatCount(n: number, maxDecimals = 1): string {
  return nf(maxDecimals).format(n);
}

/** "1,165 × 1,165 mm" (or metres). */
export function formatFootprint(lengthMm: number, widthMm: number, system: UnitSystem = "mm-kg"): string {
  if (system === "m-t") return `${two.format(lengthMm / 1000)} × ${two.format(widthMm / 1000)} m`;
  return `${int.format(lengthMm)} × ${int.format(widthMm)} mm`;
}

// ---- Context ---------------------------------------------------------------

export interface Units {
  system: UnitSystem;
  setSystem(system: UnitSystem): void;
  length(mm: number): string;
  weight(kg: number): string;
  volume(m3: number): string;
  footprint(lengthMm: number, widthMm: number): string;
  /** Unit label for inputs entered in mm / kg (inputs always take mm and kg). */
  lengthUnit: "mm" | "m";
  weightUnit: "kg" | "t";
}

export const UnitsContext = createContext<Units | null>(null);
export const UNITS_STORAGE_KEY = "load-planner.units";

export function unitsFor(system: UnitSystem, setSystem: (s: UnitSystem) => void): Units {
  return {
    system,
    setSystem,
    length: (mm) => formatLength(mm, system),
    weight: (kg) => formatWeight(kg, system),
    volume: formatVolume,
    footprint: (l, w) => formatFootprint(l, w, system),
    lengthUnit: system === "m-t" ? "m" : "mm",
    weightUnit: system === "m-t" ? "t" : "kg",
  };
}

/** The current display units; mm/kg outside a provider (handy in tests). */
export function useUnits(): Units {
  return useContext(UnitsContext) ?? unitsFor("mm-kg", () => {});
}
