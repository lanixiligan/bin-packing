// Helpers for building the client-side shipment list.
// Each shipment gets a stable `uid` so React keys survive edits and removals.
// The uid stays in the browser: only { name, weight, dg_class } is sent to /solve.
// `dgClass` is the dangerous goods class ("3", "5.1", …), "food", "fire_risk",
// or null for general freight (the default).
import { CLASS_NAMES, DG_CLASSES } from "./dg/rules.ts";

const CARGO = ["Tiles", "Paint", "Rice", "Tyres", "Steel", "Books", "Fruit",
  "Glass", "Cement", "Fabric", "Parts", "Toys", "Coffee", "Pipes", "Wood"];

let lastUid = 0;
export const nextUid = () => ++lastUid;

/** Automatic name for the shipment at position `i` (0-based) in the list. */
export function autoName(i) {
  return `${CARGO[i % CARGO.length]} ${String(i + 1).padStart(2, "0")}`;
}

/** Choices for a shipment's DG class, as sent to /api/solve (class 1 = 1.4S in the demo). */
export const DG_OPTIONS = [
  { value: "food", label: "Food" },
  { value: "fire_risk", label: "Fire-risk goods" },
  ...DG_CLASSES.map((c) => ({ value: c, label: `${c} ${c === "1" ? "Explosives (1.4S)" : CLASS_NAMES[c]}` })),
];

/** DgInfo for a demo class, as the backend builds it (Table 9.2: none of these; class 1 = 1.4S). */
export function demoDg(dgClass) {
  if (!dgClass) return null;
  if (dgClass === "food") return { food: true };
  if (dgClass === "fire_risk") return { fire_risk: true };
  return { dg_class: dgClass, t92: [], explosive_code: dgClass === "1" ? "1.4S" : null };
}

// Classes the random generator mixes in: common ones, with conflicts between
// them (3 with 5.1, 2.1 with 5.1 and 8, 6.1 and 8 with food).
const RANDOM_DG = ["3", "5.1", "8", "6.1", "2.1", "food"];
const RANDOM_DG_SHARE = 0.35;

/** A random DG class for about a third of the shipments, else null. */
export function randomDgClass(random = Math.random) {
  return random() < RANDOM_DG_SHARE ? RANDOM_DG[Math.floor(random() * RANDOM_DG.length)] : null;
}

/** Shipments with automatic names, numbered from `startIndex`. */
export function shipmentsFromWeights(weights, startIndex = 0, dgClasses = []) {
  return weights.map((weight, k) => ({
    uid: nextUid(),
    name: autoName(startIndex + k),
    weight,
    dgClass: dgClasses[k] ?? null,
  }));
}

/**
 * Random shipments sized relative to the truck capacity: each weight is
 * between 5% and 60% of `capacity` (50–600 kg for a 1000 kg truck), so every
 * shipment fits and trucks hold a mix of two to several shipments.
 * Falls back to 1000 kg when no valid capacity is given.
 * With `{ dg: true }` about a third of them get a random DG class.
 */
export function randomShipments(capacity = 1000, count = 20, { dg = false } = {}) {
  const cap = capacity > 0 ? capacity : 1000;
  const min = Math.max(1, Math.round(cap * 0.05));
  const max = Math.max(min, Math.round(cap * 0.6));
  return shipmentsFromWeights(
    Array.from({ length: count }, () => Math.floor(min + Math.random() * (max - min + 1))),
    0,
    dg ? Array.from({ length: count }, () => randomDgClass()) : [],
  );
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
