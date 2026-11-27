// Helpers for building the client-side shipment list.
// Each shipment gets a stable `uid` so React keys survive edits and removals.
// The uid stays in the browser: only { name, weight, dg_class, subsidiary,
// pallets } is sent to /solve. `pallets` is the number of pallet spaces the
// shipment takes (0 = loose freight); the truck views draw them on the deck. `dgClass` is the dangerous goods class ("3", "5.1", …),
// "food", "fire_risk", or null for general freight (the default).
// `subsidiary` lists subsidiary hazards ("6.1", "8", …): only with a class.
import { SUBSIDIARIES } from "./dg/rules.ts";

// The demo's item catalogue. Each item carries its own DG data (as on its
// safety data sheet), so a shipment named "Methanol" is always Class 3 with
// subsidiary 6.1, and "Rice" is always food.
const item = (name, dgClass = null, subsidiary = []) => ({ name, dgClass, subsidiary });
export const ITEMS = [
  // General freight
  item("Tiles"), item("Tyres"), item("Steel"), item("Books"), item("Glass"), item("Cement"),
  item("Fabric"), item("Parts"), item("Toys"), item("Pipes"), item("Timber"), item("Furniture"),
  // Food (not DG, but can't travel with 2.3, 6, 7 or 8)
  item("Rice", "food"), item("Fruit", "food"), item("Coffee", "food"), item("Flour", "food"),
  // Fire-risk goods (combustible, not DG)
  item("Diesel", "fire_risk"),
  // Dangerous goods
  item("Paint", "3"), item("Thinners", "3"), item("Methanol", "3", ["6.1"]),
  item("Acetyl chloride", "3", ["8"]), item("LPG cylinders", "2.1"),
  item("Oxygen cylinders", "2.2", ["5.1"]), item("Chlorine gas", "2.3", ["8"]),
  item("Matches", "4.1"), item("Calcium carbide", "4.3"), item("Pool chlorine", "5.1"),
  item("Hydrogen peroxide", "5.1", ["8"]), item("Pesticide", "6.1"), item("Battery acid", "8"),
  item("Nitric acid", "8", ["5.1"]), item("Lithium batteries", "9"),
];
const GENERAL_ITEMS = ITEMS.filter((i) => !i.dgClass);
const FOOD_ITEMS = ITEMS.filter((i) => i.dgClass === "food");
const HAZARD_ITEMS = ITEMS.filter((i) => i.dgClass && i.dgClass !== "food");
// Share of random shipments drawn from each group (the rest: general freight).
const HAZARD_SHARE = 0.35;
const FOOD_SHARE = 0.15;

/** The catalogue item a shipment name refers to ("methanol", "Methanol 07"), or undefined. */
export function itemByName(name) {
  const base = String(name ?? "").trim().replace(/\s+\d+$/, "").toLowerCase();
  return ITEMS.find((i) => i.name.toLowerCase() === base);
}

let lastUid = 0;
export const nextUid = () => ++lastUid;

const numbered = (name, i) => `${name} ${String(i + 1).padStart(2, "0")}`;

/** Automatic name for a general freight shipment at position `i` (0-based) in the list. */
export function autoName(i) {
  return numbered(GENERAL_ITEMS[i % GENERAL_ITEMS.length].name, i);
}

/** DgInfo for a demo class, as the backend builds it (Table 9.2: none of these; class 1 = 1.4S). */
export function demoDg(dgClass, subsidiary = []) {
  if (!dgClass) return null;
  if (dgClass === "food") return { food: true };
  if (dgClass === "fire_risk") return { fire_risk: true };
  return { dg_class: dgClass, subsidiary: [...subsidiary], t92: [], explosive_code: dgClass === "1" ? "1.4S" : null };
}

/** True for a real DG class (not general freight, food or fire-risk): only these take subsidiary hazards. */
export const isDgClass = (dgClass) => Boolean(dgClass) && dgClass !== "food" && dgClass !== "fire_risk";

export const MAX_SUBSIDIARY = 4;

/**
 * A shipment's hazard, made consistent the way the backend checks it:
 * no subsidiary hazards without a class, never the class itself, sorted,
 * unique, at most 4.
 */
export function normaliseHazard(dgClass, subsidiary = []) {
  const cls = dgClass || null;
  if (!isDgClass(cls)) return { dgClass: cls, subsidiary: [] };
  const subs = [...new Set(subsidiary)]
    .filter((s) => s !== cls && SUBSIDIARIES.includes(s))
    .sort((a, b) => SUBSIDIARIES.indexOf(a) - SUBSIDIARIES.indexOf(b))
    .slice(0, MAX_SUBSIDIARY);
  return { dgClass: cls, subsidiary: subs };
}

/** A random catalogue item: about a third dangerous goods (or fire-risk), some food, the rest general freight. */
export function randomItem(random = Math.random) {
  const r = random();
  const pool = r < HAZARD_SHARE ? HAZARD_ITEMS : r < HAZARD_SHARE + FOOD_SHARE ? FOOD_ITEMS : GENERAL_ITEMS;
  return pool[Math.floor(random() * pool.length)];
}

/** General freight shipments with automatic names, numbered from `startIndex`. */
export function shipmentsFromWeights(weights, startIndex = 0) {
  return weights.map((weight, k) => ({
    uid: nextUid(),
    name: autoName(startIndex + k),
    weight,
    dgClass: null,
    subsidiary: [],
    pallets: 1,
  }));
}

/**
 * Random shipments of catalogue items, each with the item's own DG data,
 * sized relative to the truck capacity: each weight is between 5% and 60%
 * of `capacity` (50–600 kg for a 1000 kg truck), so every shipment fits and
 * trucks hold a mix of two to several shipments. Each takes 1–3 pallet spaces.
 * Falls back to 1000 kg when no valid capacity is given.
 */
export function randomShipments(capacity = 1000, count = 20, random = Math.random) {
  const cap = capacity > 0 ? capacity : 1000;
  const min = Math.max(1, Math.round(cap * 0.05));
  const max = Math.max(min, Math.round(cap * 0.6));
  return Array.from({ length: count }, (_, i) => {
    const it = randomItem(random);
    return {
      uid: nextUid(),
      name: numbered(it.name, i),
      weight: Math.floor(min + random() * (max - min + 1)),
      dgClass: it.dgClass,
      subsidiary: [...it.subsidiary],
      pallets: 1 + Math.floor(random() * 3),
    };
  });
}

/**
 * Parse pasted text such as "560, 490, 440 370\n360".
 * Separators: commas, semicolons, spaces, tabs and newlines.
 * Returns { weights, invalid } where `invalid` lists the tokens that are not
 * whole numbers above 0.
 */
export function parseWeights(text) {
  const weights = [];
  const invalid = [];
  for (const token of text.split(/[\s,;]+/).filter(Boolean)) {
    if (/^\d+$/.test(token) && Number(token) > 0) weights.push(Number(token));
    else invalid.push(token);
  }
  return { weights, invalid };
}

// A small case where First-Fit Decreasing needs 4 trucks but 3 are enough:
// 560+440 | 490+360+150 | 370+340+190.
export const FFD_LOSES_EXAMPLE = {
  capacity: 1000,
  weights: [560, 490, 440, 370, 360, 340, 190, 150],
};
