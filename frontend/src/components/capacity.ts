// Capacity helpers shared by the truck views (2D and 3D).
//
// A capacity is either a plain number (kg only) or, when the trucks also have a
// pallet limit, an object { weight_kg, pallets } (a null/undefined limit means
// "not limited in this dimension").
//
// Pure functions only (no React, no DOM), so they can be unit-tested with node.

export type Dim = "weight" | "pallets";

export interface CapacityLimits {
  weight_kg?: number | null;
  pallets?: number | null;
}

export interface UsageTotals {
  weight_kg: number;
  pallets: number;
}

export interface DimInfo {
  dim: Dim;
  field: keyof UsageTotals;
  label: string;
  /** Short label for tight spaces (truck columns). */
  short: string;
  format(n: number): string;
}

const num = (n: number, max: number) => n.toLocaleString(undefined, { maximumFractionDigits: max });

export const DIMS: DimInfo[] = [
  { dim: "weight", field: "weight_kg", label: "Weight", short: "kg", format: (n) => `${num(n, 1)} kg` },
  { dim: "pallets", field: "pallets", label: "Pallets", short: "pal", format: (n) => `${num(n, 1)} pallet${n === 1 ? "" : "s"}` },
];

/** Tolerance for float sums (0.1 + 0.2 must still fit 0.3). */
export const EPS = 1e-9;

/** The limit of `dim`, or null when not limited. */
export function limitOf(cap: CapacityLimits | null | undefined, dim: Dim): number | null {
  if (!cap) return null;
  const v = cap[DIMS.find((d) => d.dim === dim)!.field];
  return v != null && v > 0 ? v : null;
}

/** The dimensions this capacity limits, in display order (weight, pallets). */
export function limitedDims(cap: CapacityLimits | null | undefined): DimInfo[] {
  return DIMS.filter((d) => limitOf(cap, d.dim) != null);
}

export const emptyUsage = (): UsageTotals => ({ weight_kg: 0, pallets: 0 });

export function addUsage(a: UsageTotals, b: UsageTotals): UsageTotals {
  return { weight_kg: a.weight_kg + b.weight_kg, pallets: a.pallets + b.pallets };
}

/** Usage as a fraction (0..1+) of capacity per limited dimension. */
export function fractions(usage: UsageTotals, cap: CapacityLimits): Partial<Record<Dim, number>> {
  const out: Partial<Record<Dim, number>> = {};
  for (const d of limitedDims(cap)) out[d.dim] = usage[d.field] / limitOf(cap, d.dim)!;
  return out;
}

/** The dimension closest to (or furthest over) its limit, and that fraction. */
export function bindingDim(usage: UsageTotals, cap: CapacityLimits): { dim: Dim | null; fraction: number } {
  let best: { dim: Dim | null; fraction: number } = { dim: null, fraction: 0 };
  for (const [dim, frac] of Object.entries(fractions(usage, cap)) as [Dim, number][]) {
    if (best.dim == null || frac > best.fraction) best = { dim, fraction: frac };
  }
  return best;
}

/** Limited dimensions in which `usage` exceeds the capacity. */
export function overDims(usage: UsageTotals, cap: CapacityLimits): DimInfo[] {
  return limitedDims(cap).filter((d) => usage[d.field] > limitOf(cap, d.dim)! + EPS);
}

/** "Weight 800 of 1,000 kg, pallets 6 of 8 pallets": for labels and screen readers. */
export function describeUsage(usage: UsageTotals, cap: CapacityLimits): string {
  return limitedDims(cap)
    .map((d, i) => {
      const label = i === 0 ? d.label : d.label.toLowerCase();
      return `${label} ${num(usage[d.field], 2)} of ${d.format(limitOf(cap, d.dim)!)}`;
    })
    .join(", ");
}

/** "560 kg, 2 pallets" ("560 kg" for loose freight). */
export function describeSize(size: UsageTotals): string {
  return DIMS.filter((d) => d.dim === "weight" || size[d.field] > 0)
    .map((d) => d.format(size[d.field]))
    .join(", ");
}

// ---------------------------------------------------------------------------
// Shipments in the truck views
// ---------------------------------------------------------------------------

// Same shipment = same color in both panels, so you can compare them.
// Lightness 72% keeps near-black labels at 5.6:1 or better for every hue
// (WCAG AA needs 4.5:1; at 62% the blue hues only reached 3.5:1).
export function colorFor(id: number): string {
  const hue = (id * 137.508) % 360; // golden angle spreads colors nicely
  return `hsl(${hue}, 65%, 72%)`;
}

/**
 * One shipment of the /api/solve response: { id, name, weight }, with its
 * pallet spaces when it has any, and its dangerous goods: `dg_class` ("3",
 * "food", "fire_risk", …) and `subsidiary` hazards.
 */
export interface ShipmentLike {
  id: number;
  name: string;
  weight: number;
  pallets?: number;
  dg_class?: string | null;
  subsidiary?: string[] | null;
}

/**
 * Text for a DG class: "Class 3", "Class 3 (sub 6.1, 8)", "Class 1.4S" (the
 * demo's class 1), "Food", "Fire-risk"; "" for none.
 */
export function dgClassText(dgClass: string | null | undefined, subsidiary: readonly string[] | null = []): string {
  if (!dgClass) return "";
  if (dgClass === "food") return "Food";
  if (dgClass === "fire_risk") return "Fire-risk";
  const subs = subsidiary?.length ? ` (sub ${subsidiary.join(", ")})` : "";
  return `Class ${dgClass === "1" ? "1.4S" : dgClass}${subs}`;
}

/** The DG text shown for a shipment; "" for general freight. */
export function dgTextOf(s: Pick<ShipmentLike, "dg_class" | "subsidiary">): string {
  return dgClassText(s.dg_class, s.subsidiary);
}

/** Placard code for a shipment ("food" → "F", "fire_risk" → "R"); null for none. */
export function dgCodeOf(s: Pick<ShipmentLike, "dg_class">): string | null {
  const c = s.dg_class;
  if (!c) return null;
  return c === "food" ? "F" : c === "fire_risk" ? "R" : c;
}

export const sizeOf = (s: ShipmentLike): UsageTotals => ({ weight_kg: s.weight, pallets: s.pallets ?? 0 });

export interface TruckLike<S extends ShipmentLike = ShipmentLike> {
  shipments: S[];
}

/**
 * State of a truck at this point of the drop animation: usage of the
 * shipments that have dropped so far, the binding fill % (floored, so 100%
 * only shows when completely full) and whether the full load is over.
 */
export function truckFill<S extends ShipmentLike>(truck: TruckLike<S>, cap: CapacityLimits, step: number, dropIndex: Record<number, number>) {
  const visible = truck.shipments.filter((s) => dropIndex[s.id] < step);
  const usage = visible.reduce((u, s) => addUsage(u, sizeOf(s)), emptyUsage());
  const full = truck.shipments.reduce((u, s) => addUsage(u, sizeOf(s)), emptyUsage());
  return {
    visible,
    usage,
    full,
    fill: Math.floor(100 * bindingDim(usage, cap).fraction + EPS),
    done: visible.length === truck.shipments.length,
    over: overDims(full, cap).length > 0,
  };
}
