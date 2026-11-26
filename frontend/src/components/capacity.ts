// Capacity helpers shared by the truck views (2D and 3D) and the ops pages.
//
// A capacity is either a plain number (the 1D demo: kg only) or an object with
// optional limits per dimension, as in the API's `Capacity`:
//   { weight_kg?: number | null, volume_m3?: number | null, pallets?: number | null }
// A null/undefined limit means "not limited in this dimension".
//
// Pure functions only (no React, no DOM), so they can be unit-tested with node.

export type Dim = "weight" | "volume" | "pallets";

export interface CapacityLimits {
  weight_kg?: number | null;
  volume_m3?: number | null;
  pallets?: number | null;
}

export interface UsageTotals {
  weight_kg: number;
  volume_m3: number;
  pallets: number;
}

export interface DimInfo {
  dim: Dim;
  field: keyof UsageTotals;
  label: string;
  /** Short label for tight spaces (truck columns). */
  short: string;
  unit: string;
  format(n: number): string;
}

const num = (n: number, max: number) => n.toLocaleString(undefined, { maximumFractionDigits: max });

export const DIMS: DimInfo[] = [
  { dim: "weight", field: "weight_kg", label: "Weight", short: "kg", unit: "kg", format: (n) => `${num(n, 1)} kg` },
  { dim: "volume", field: "volume_m3", label: "Volume", short: "m³", unit: "m³", format: (n) => `${num(n, 2)} m³` },
  {
    dim: "pallets", field: "pallets", label: "Pallets", short: "pal", unit: "pallets",
    format: (n) => `${num(n, 1)} pallet${n === 1 ? "" : "s"}`,
  },
];

/** Tolerance for float sums (0.1 + 0.2 must still fit 0.3). */
export const EPS = 1e-9;

/** The limit of `dim`, or null when not limited. */
export function limitOf(cap: CapacityLimits | null | undefined, dim: Dim): number | null {
  if (!cap) return null;
  const v = cap[DIMS.find((d) => d.dim === dim)!.field];
  return v != null && v > 0 ? v : null;
}

/** The dimensions this capacity limits, in display order (weight, volume, pallets). */
export function limitedDims(cap: CapacityLimits | null | undefined): DimInfo[] {
  return DIMS.filter((d) => limitOf(cap, d.dim) != null);
}

export const emptyUsage = (): UsageTotals => ({ weight_kg: 0, volume_m3: 0, pallets: 0 });

export function addUsage(a: UsageTotals, b: UsageTotals, times = 1): UsageTotals {
  return {
    weight_kg: a.weight_kg + b.weight_kg * times,
    volume_m3: a.volume_m3 + b.volume_m3 * times,
    pallets: a.pallets + b.pallets * times,
  };
}

/** Usage as a fraction (0..1+) of capacity per limited dimension. */
export function fractions(usage: UsageTotals, cap: CapacityLimits): Partial<Record<Dim, number>> {
  const out: Partial<Record<Dim, number>> = {};
  for (const d of limitedDims(cap)) out[d.dim] = usage[d.field] / limitOf(cap, d.dim)!;
  return out;
}

/** Fill % per limited dimension (null where not limited), rounded to 0.1. */
export function fillPercent(usage: UsageTotals, cap: CapacityLimits): { weight: number | null; volume: number | null; pallets: number | null } {
  const f = fractions(usage, cap);
  const pct = (x: number | undefined) => (x == null ? null : Math.round(x * 1000) / 10);
  return { weight: pct(f.weight), volume: pct(f.volume), pallets: pct(f.pallets) };
}

/** The dimension closest to (or furthest over) its limit, and that fraction. */
export function bindingDim(usage: UsageTotals, cap: CapacityLimits): { dim: Dim | null; fraction: number } {
  let best: { dim: Dim | null; fraction: number } = { dim: null, fraction: 0 };
  for (const [dim, frac] of Object.entries(fractions(usage, cap)) as [Dim, number][]) {
    if (best.dim == null || frac > best.fraction) best = { dim, fraction: frac };
  }
  return best;
}

/** True when `usage + add` stays within every limited dimension. */
export function fits(usage: UsageTotals, add: UsageTotals, cap: CapacityLimits): boolean {
  return limitedDims(cap).every((d) => usage[d.field] + add[d.field] <= limitOf(cap, d.dim)! + EPS);
}

/** Limited dimensions in which `usage` exceeds the capacity. */
export function overDims(usage: UsageTotals, cap: CapacityLimits): DimInfo[] {
  return limitedDims(cap).filter((d) => usage[d.field] > limitOf(cap, d.dim)! + EPS);
}

/** ceil(total / limit) per limited dimension, and the max over them. */
export function lowerBounds(totals: UsageTotals, cap: CapacityLimits): {
  overall: number;
  weight: number | null;
  volume: number | null;
  pallets: number | null;
} {
  const lb = (dim: Dim) => {
    const limit = limitOf(cap, dim);
    if (limit == null) return null;
    const field = DIMS.find((d) => d.dim === dim)!.field;
    return Math.ceil(totals[field] / limit - EPS);
  };
  const weight = lb("weight");
  const volume = lb("volume");
  const pallets = lb("pallets");
  const overall = Math.max(0, weight ?? 0, volume ?? 0, pallets ?? 0);
  return { overall, weight, volume, pallets };
}

/** "Weight 800 of 1,000 kg, volume 6.2 of 12 m³": for labels and screen readers. */
export function describeUsage(usage: UsageTotals, cap: CapacityLimits): string {
  return limitedDims(cap)
    .map((d, i) => {
      const label = i === 0 ? d.label : d.label.toLowerCase();
      return `${label} ${num(usage[d.field], 2)} of ${d.format(limitOf(cap, d.dim)!)}`;
    })
    .join(", ");
}

/** "Pallet of tiles: 560 kg, 1.2 m³, 1 pallet". Dimensions that are zero are left out (except weight). */
export function describeSize(size: UsageTotals): string {
  return DIMS.filter((d) => d.dim === "weight" || size[d.field] > 0)
    .map((d) => d.format(size[d.field]))
    .join(", ");
}

// ---------------------------------------------------------------------------
// Geometry for the truck views
// ---------------------------------------------------------------------------

// Same shipment = same color in both panels, so you can compare them.
// Lightness 72% keeps near-black labels at 5.6:1 or better for every hue
// (WCAG AA needs 4.5:1; at 62% the blue hues only reached 3.5:1).
export function colorFor(id: number): string {
  const hue = (id * 137.508) % 360; // golden angle spreads colors nicely
  return `hsl(${hue}, 65%, 72%)`;
}

/** One block/crate in a truck: the demo's { id, name, weight } plus optional volume/pallets. */
export interface ShipmentLike {
  id: number;
  name: string;
  weight: number;
  volume?: number;
  pallets?: number;
}

export const sizeOf = (s: ShipmentLike): UsageTotals => ({
  weight_kg: s.weight,
  volume_m3: s.volume ?? 0,
  pallets: s.pallets ?? 0,
});

/**
 * How much of the truck each shipment takes up, as a fraction of the truck
 * (0..1), for drawing block heights (2D) or crate lengths (3D).
 *
 * * 1D (`capacity` is a number): weight / capacity, exactly as in the demo.
 * * Multi-dimension: each shipment is sized by its own binding dimension (its
 *   largest fraction of any limit), then the stack is scaled so that a full
 *   truck adds up to the truck's binding fill: the stack is as tall as the
 *   fullest dimension, and it never overflows because of mixed shapes.
 */
export function shipmentFractions(shipments: ShipmentLike[], capacity: number | CapacityLimits): Map<number, number> {
  const out = new Map<number, number>();
  if (typeof capacity === "number") {
    for (const s of shipments) out.set(s.id, s.weight / capacity);
    return out;
  }
  const own = shipments.map((s) => {
    const f = Object.values(fractions(sizeOf(s), capacity));
    return f.length ? Math.max(...f) : 0;
  });
  const total = own.reduce((a, b) => a + b, 0);
  const usage = shipments.reduce((u, s) => addUsage(u, sizeOf(s)), emptyUsage());
  const binding = bindingDim(usage, capacity).fraction;
  const scale = total > 0 ? Math.min(1, binding / total) : 0;
  shipments.forEach((s, i) => out.set(s.id, own[i] * scale));
  return out;
}

export interface TruckLike<S extends ShipmentLike = ShipmentLike> {
  shipments: S[];
}

/**
 * State of a multi-dimension truck at this point of the drop animation:
 * usage of the shipments that have dropped so far, the binding fill % (floored,
 * so 100% only shows when completely full) and whether the full load is over.
 */
export function truckFill<S extends ShipmentLike>(truck: TruckLike<S>, cap: CapacityLimits, step: number, dropIndex: Record<number, number>) {
  const visible = truck.shipments.filter((s) => dropIndex[s.id] < step);
  const usage = visible.reduce((u, s) => addUsage(u, sizeOf(s)), emptyUsage());
  const full = truck.shipments.reduce((u, s) => addUsage(u, sizeOf(s)), emptyUsage());
  const binding = bindingDim(usage, cap);
  return {
    visible,
    usage,
    full,
    fill: Math.floor(100 * binding.fraction + EPS),
    bindingDim: binding.dim,
    done: visible.length === truck.shipments.length,
    over: overDims(full, cap).length > 0,
  };
}
