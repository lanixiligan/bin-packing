// A small multi-dimension bin packer for the in-browser mock API (and its
// tests). The real solver is the backend's (FFD + OR-Tools CP-SAT); this one
// only has to produce believable results for the UI:
//   * ffd():   First-Fit Decreasing by each unit's largest fraction of capacity.
//   * exact(): a depth-first search for a packing into exactly `bins` loads,
//              with a node limit, standing in for CP-SAT.
// Imports use explicit .ts extensions so `node --test` can run it directly.
import {
  EPS,
  addUsage,
  emptyUsage,
  fits,
  fractions,
  limitOf,
  limitedDims,
  type CapacityLimits,
  type UsageTotals,
} from "../components/capacity.ts";

export interface Unit extends UsageTotals {
  id: number;
}

/** Each unit's largest fraction of the capacity: the FFD sort key. */
export function unitSize(u: UsageTotals, cap: CapacityLimits): number {
  const f = Object.values(fractions(u, cap));
  return f.length ? Math.max(...f) : 0;
}

/** Units that can never fit, with the dimensions they exceed. */
export function misfits<U extends UsageTotals>(units: U[], cap: CapacityLimits): { unit: U; dims: ("weight" | "volume" | "pallets")[] }[] {
  const out: { unit: U; dims: ("weight" | "volume" | "pallets")[] }[] = [];
  for (const u of units) {
    const dims = limitedDims(cap)
      .filter((d) => u[d.field] > limitOf(cap, d.dim)! + EPS)
      .map((d) => d.dim);
    if (dims.length) out.push({ unit: u, dims });
  }
  return out;
}

function sortedDesc(units: Unit[], cap: CapacityLimits): Unit[] {
  return [...units].sort((a, b) => unitSize(b, cap) - unitSize(a, cap) || a.id - b.id);
}

/** First-Fit Decreasing. Returns the loads (unit ids in loading order) and the placement order. */
export function ffd(units: Unit[], cap: CapacityLimits): { loads: number[][]; order: number[] } {
  const loads: { ids: number[]; usage: UsageTotals }[] = [];
  const order: number[] = [];
  for (const u of sortedDesc(units, cap)) {
    let target = loads.find((l) => fits(l.usage, u, cap));
    if (!target) {
      target = { ids: [], usage: emptyUsage() };
      loads.push(target);
    }
    target.ids.push(u.id);
    target.usage = addUsage(target.usage, u);
    order.push(u.id);
  }
  return { loads: loads.map((l) => l.ids), order };
}

/**
 * Try to pack the units into exactly `bins` loads. Returns the loads, or null
 * if none was found; `exhausted` is true when the search proved there is none
 * (it didn't hit the node limit).
 */
export function exact(units: Unit[], cap: CapacityLimits, bins: number, nodeLimit = 200_000): { loads: number[][] | null; exhausted: boolean } {
  const sorted = sortedDesc(units, cap);
  const usage: UsageTotals[] = Array.from({ length: bins }, emptyUsage);
  const assign: number[][] = Array.from({ length: bins }, () => []);
  let nodes = 0;
  let aborted = false;

  const place = (i: number, used: number): boolean => {
    if (i === sorted.length) return true;
    if (++nodes > nodeLimit) {
      aborted = true;
      return false;
    }
    const u = sorted[i];
    const tried: string[] = [];
    // Only one empty bin is ever tried (the bins are interchangeable).
    for (let b = 0; b < Math.min(bins, used + 1); b++) {
      const key = `${usage[b].weight_kg.toFixed(6)}|${usage[b].volume_m3.toFixed(6)}|${usage[b].pallets.toFixed(6)}`;
      if (tried.includes(key)) continue; // same usage as a bin already tried: same subtree
      tried.push(key);
      if (!fits(usage[b], u, cap)) continue;
      usage[b] = addUsage(usage[b], u);
      assign[b].push(u.id);
      if (place(i + 1, Math.max(used, b + 1))) return true;
      usage[b] = addUsage(usage[b], u, -1);
      assign[b].pop();
      if (aborted) return false;
    }
    return false;
  };

  const found = bins > 0 && place(0, 0);
  return { loads: found ? assign.filter((a) => a.length) : null, exhausted: !found && !aborted };
}

export const totalsOf = (units: UsageTotals[]): UsageTotals =>
  units.reduce((t, u) => addUsage(t, u), emptyUsage());
