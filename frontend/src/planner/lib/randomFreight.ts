// Random freight for trying the planner: 6–10 lines of AU pallets drawn from a small catalogue
// where each item carries its own dangerous goods data (as on its safety data sheet), so "Paint"
// is always Class 3 and "Rice" is always food. Based on the old demo's catalogue.
//
// Pass a seeded `random` (see `seededRandom`) for repeatable lists, e.g. in tests.

import type { DgInfo, ReferenceData } from "../api/types.ts";
import { normalise, type DgClass, type Subsidiary } from "../../dg/rules.ts";
import { newRow, type FreightRow } from "./freight.ts";

export interface CatalogueItem {
  label: string;
  /** null = general freight. */
  dg: DgInfo | null;
}

const general = (label: string): CatalogueItem => ({ label, dg: null });
const food = (label: string): CatalogueItem => ({
  label, dg: normalise({ dg_class: null, subsidiary: [], t92: [], container: "package", food: true, fire_risk: false }),
});
const hazard = (label: string, dg_class: DgClass, subsidiary: Subsidiary[] = []): CatalogueItem => ({
  label, dg: normalise({ dg_class, subsidiary, t92: [], container: "package", food: false, fire_risk: false }),
});

export const GENERAL_ITEMS: CatalogueItem[] = [
  general("Timber"), general("Tiles"), general("Steel"), general("Books"), general("Tyres"),
  general("Cement"), general("Furniture"), general("Pipes"),
];
export const FOOD_ITEMS: CatalogueItem[] = [food("Rice"), food("Flour"), food("Coffee")];
export const DG_ITEMS: CatalogueItem[] = [
  hazard("Paint", "3"), hazard("Methanol", "3", ["6.1"]), hazard("Pool chlorine", "5.1"),
  hazard("Battery acid", "8"), hazard("Pesticide", "6.1"), hazard("LPG cylinders", "2.1"),
  hazard("Lithium batteries", "9"),
];
export const CATALOGUE: CatalogueItem[] = [...GENERAL_ITEMS, ...FOOD_ITEMS, ...DG_ITEMS];

/** A small, fast seeded random number generator (mulberry32): numbers in [0, 1). */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A whole number from min to max inclusive, in steps of `step`. */
const between = (random: () => number, min: number, max: number, step = 1) =>
  min + step * Math.floor(random() * (Math.floor((max - min) / step) + 1));

/** `n` different items from `pool`, in random order. */
function pick<T>(random: () => number, pool: T[], n: number): T[] {
  const left = [...pool];
  const out: T[] = [];
  while (out.length < n && left.length) out.push(left.splice(Math.floor(random() * left.length), 1)[0]);
  return out;
}

export interface RandomFreightOptions {
  /** Random numbers in [0, 1); defaults to Math.random. */
  random?: () => number;
}

/**
 * 6–10 freight lines of different catalogue items: 2–4 dangerous goods, up to one food line and
 * the rest general freight, in random order. AU standard pallets, 300–1,000 kg and 1.0–1.6 m tall,
 * 1–3 per line, some stackable.
 */
export function randomFreight(ref: ReferenceData | null, { random = Math.random }: RandomFreightOptions = {}): FreightRow[] {
  const count = between(random, 6, 10);
  const nDg = between(random, 2, 4);
  const nFood = between(random, 0, 1);
  const items = pick(random, [
    ...pick(random, DG_ITEMS, nDg),
    ...pick(random, FOOD_ITEMS, nFood),
    ...pick(random, GENERAL_ITEMS, count - nDg - nFood),
  ], count);
  const typeId = ref && !ref.pallets.AU_STD ? ref.pallet_defaults.default_pallet : "AU_STD";
  return items.map((it) => newRow(ref, {
    label: it.label,
    kind: "pallet",
    type_id: typeId,
    quantity: between(random, 1, 3),
    gross_weight_kg: between(random, 300, 1000, 10),
    height_mm: between(random, 1000, 1600, 50),
    stackable: random() < 0.4,
    dg: it.dg,
  }));
}
