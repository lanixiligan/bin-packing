// A small multi-dimension bin packer for the in-browser mock API (and its
// tests). The real solver is the backend's (FFD + OR-Tools CP-SAT); this one
// only has to produce believable results for the UI:
//   * ffd():   First-Fit Decreasing by each unit's largest fraction of capacity.
//   * exact(): a depth-first search for a packing into exactly `bins` loads,
//              with a node limit, standing in for CP-SAT.
// Both keep dangerous goods apart: units whose DG data conflicts (ADG Table
// 9.1 / 9.2, see ../dg/rules.ts) never share a load.
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
import { dgConflicts, dgKey, type DgLike } from "../dg/rules.ts";

export interface Unit extends UsageTotals {
  id: number;
  /** Dangerous goods data; null/undefined = general freight. */
  dg?: DgLike;
}

/**
 * A cached "do these two DG profiles conflict?" test by DG key ("" = general
 * freight, which goes with anything; equal keys are the same product).
 */
export function conflictCheck(): (a: DgLike, b: DgLike) => boolean {
  const cache = new Map<string, boolean>();
  return (a, b) => {
    const ka = dgKey(a), kb = dgKey(b);
    if (!ka || !kb || ka === kb) return false;
    const key = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
    let v = cache.get(key);
    if (v === undefined) {
      v = dgConflicts(a, b);
      cache.set(key, v);
    }
    return v;
  };
}

/** Can a unit with `dg` join a bin holding these DG profiles (by key)? */
const dgFits = (held: Map<string, DgLike>, dg: DgLike, clash: (a: DgLike, b: DgLike) => boolean) => {
  if (!dgKey(dg)) return true;
  for (const other of held.values()) if (clash(other, dg)) return false;
  return true;
};

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
  const clash = conflictCheck();
  const loads: { ids: number[]; usage: UsageTotals; dgs: Map<string, DgLike> }[] = [];
  const order: number[] = [];
  for (const u of sortedDesc(units, cap)) {
    let target = loads.find((l) => fits(l.usage, u, cap) && dgFits(l.dgs, u.dg, clash));
    if (!target) {
      target = { ids: [], usage: emptyUsage(), dgs: new Map() };
      loads.push(target);
    }
    target.ids.push(u.id);
    target.usage = addUsage(target.usage, u);
    const k = dgKey(u.dg);
    if (k) target.dgs.set(k, u.dg);
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
  const keys = sorted.map((u) => dgKey(u.dg));
  const clash = conflictCheck();
  const usage: UsageTotals[] = Array.from({ length: bins }, emptyUsage);
  const assign: number[][] = Array.from({ length: bins }, () => []);
  // DG profiles in each bin, with how many units carry them (for backtracking)
  const held: Map<string, { dg: DgLike; n: number }>[] = Array.from({ length: bins }, () => new Map());
  const dgOk = (b: number, i: number) => {
    if (!keys[i]) return true;
    for (const h of held[b].values()) if (clash(h.dg, sorted[i].dg)) return false;
    return true;
  };
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
    const k = keys[i];
    for (let b = 0; b < Math.min(bins, used + 1); b++) {
      // Bins with the same usage and the same DG profiles are interchangeable: same subtree.
      const key = `${usage[b].weight_kg.toFixed(6)}|${usage[b].volume_m3.toFixed(6)}|${usage[b].pallets.toFixed(6)}`
        + `|${[...held[b].keys()].sort().join("|")}`;
      if (tried.includes(key)) continue;
      tried.push(key);
      if (!fits(usage[b], u, cap) || !dgOk(b, i)) continue;
      usage[b] = addUsage(usage[b], u);
      assign[b].push(u.id);
      if (k) {
        const h = held[b].get(k);
        if (h) h.n++;
        else held[b].set(k, { dg: u.dg, n: 1 });
      }
      if (place(i + 1, Math.max(used, b + 1))) return true;
      usage[b] = addUsage(usage[b], u, -1);
      assign[b].pop();
      if (k) {
        const h = held[b].get(k)!;
        if (--h.n === 0) held[b].delete(k);
      }
      if (aborted) return false;
    }
    return false;
  };

  const found = bins > 0 && place(0, 0);
  return { loads: found ? assign.filter((a) => a.length) : null, exhausted: !found && !aborted };
}

export const totalsOf = (units: UsageTotals[]): UsageTotals =>
  units.reduce((t, u) => addUsage(t, u), emptyUsage());
