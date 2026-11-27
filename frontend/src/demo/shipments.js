// Helpers for building the client-side shipment list.
//
// A shipment in the browser:
//   { uid, name, weight, kind, palletType, lengthMm, widthMm, heightMm, stackable, dgClass, subsidiary }
// - `uid` is stable so React keys survive edits and removals; it stays in the browser.
// - `kind` is "pallet" (it sits on a pallet of `palletType`, an id from GET /api/reference, and
//   takes the pallet's footprint) or "loose" (its own `lengthMm` × `widthMm`).
// - `heightMm` is the total height, pallet included; `weight` the gross kg, pallet included.
// - `stackable`: may stand on (or carry) another stackable shipment with the same footprint.
// - `dgClass` is the dangerous goods class ("3", "5.1", …), "food", "fire_risk", or null for
//   general freight; `subsidiary` lists subsidiary hazards ("6.1", "8", …), only with a class.
// toRequest() turns the list into the POST /api/solve body (backend/app/demo_models.py).
import { SUBSIDIARIES } from "../dg/rules.ts";

export const MAX_SHIPMENTS = 40; // backend/app/demo_models.py MAX_SHIPMENTS
export const RANDOM_COUNT = 20;
export const DEFAULT_PALLET = "AU_STD";
/** What a pasted weight becomes: an Australian pallet, 1.2 m high, not stackable. */
export const PASTE_SIZE = { kind: "pallet", palletType: DEFAULT_PALLET, heightMm: 1200, stackable: false };

// The demo's item catalogue. Each item carries its own DG data (as on its safety data sheet),
// so a shipment named "Methanol" is always Class 3 with subsidiary 6.1 and "Rice" is always
// food, and its typical size: a pallet type and total height, or a loose length × width ×
// height (`lengths` lists the lengths it comes in), whether it stacks, and a gross weight range.
const pallet = (palletType, heightMm, stackable, kg) => ({ kind: "pallet", palletType, heightMm, stackable, kg });
const loose = (lengths, widthMm, heightMm, kg) => ({ kind: "loose", lengths, widthMm, heightMm, stackable: false, kg });
const item = (name, dgClass, subsidiary, size) => ({ name, dgClass, subsidiary, size });

export const ITEMS = [
  // General freight
  item("Tiles", null, [], pallet("AU_STD", 900, false, [600, 1000])),
  item("Tyres", null, [], pallet("AU_STD", 1800, false, [200, 400])),
  item("Steel", null, [], loose([2400, 3000, 4000], 500, 300, [500, 1000])),
  item("Books", null, [], pallet("AU_STD", 1200, true, [400, 800])),
  item("Glass", null, [], pallet("EURO", 1600, false, [300, 700])),
  item("Cement", null, [], pallet("AU_STD", 1000, true, [700, 1000])),
  item("Fabric", null, [], pallet("EURO", 1400, true, [150, 400])),
  item("Parts", null, [], pallet("ISO_UK", 1200, true, [200, 600])),
  item("Toys", null, [], pallet("AU_STD", 1600, false, [100, 300])),
  // Pipes come up to 6 m: a long one only fits the bigger vehicles.
  item("Pipes", null, [], loose([3000, 4000, 4600, 6000], 400, 300, [150, 400])),
  item("Timber", null, [], loose([2400, 3600, 4200, 5400], 600, 500, [300, 700])),
  item("Furniture", null, [], pallet("AU_STD", 1800, false, [150, 400])),
  // Food (not DG, but can't travel with 2.3, 6, 7 or 8)
  item("Rice", "food", [], pallet("EURO", 1000, true, [500, 900])),
  item("Fruit", "food", [], pallet("AU_STD", 1600, false, [400, 800])),
  item("Coffee", "food", [], pallet("AU_STD", 1200, true, [400, 800])),
  item("Flour", "food", [], pallet("AU_STD", 1000, true, [600, 1000])),
  // Fire-risk goods (combustible, not DG)
  item("Diesel", "fire_risk", [], pallet("AU_STD", 1200, false, [800, 1000])),
  // Dangerous goods
  item("Paint", "3", [], pallet("AU_STD", 1200, true, [300, 700])),
  item("Thinners", "3", [], pallet("AU_STD", 1200, true, [300, 600])),
  item("Methanol", "3", ["6.1"], pallet("AU_STD", 1300, false, [600, 1000])),
  item("Acetyl chloride", "3", ["8"], pallet("SQUARE", 1000, false, [200, 500])),
  item("LPG cylinders", "2.1", [], pallet("AU_STD", 1400, false, [300, 600])),
  item("Oxygen cylinders", "2.2", ["5.1"], pallet("AU_STD", 1600, false, [400, 700])),
  item("Chlorine gas", "2.3", ["8"], pallet("AU_STD", 1400, false, [400, 800])),
  item("Matches", "4.1", [], pallet("AU_STD", 1200, true, [150, 300])),
  item("Calcium carbide", "4.3", [], pallet("SQUARE", 1000, true, [400, 800])),
  item("Pool chlorine", "5.1", [], pallet("AU_STD", 1100, true, [400, 800])),
  item("Hydrogen peroxide", "5.1", ["8"], pallet("AU_STD", 1200, false, [500, 1000])),
  item("Pesticide", "6.1", [], pallet("AU_STD", 1200, true, [300, 700])),
  item("Battery acid", "8", [], pallet("AU_STD", 1000, false, [500, 900])),
  item("Nitric acid", "8", ["5.1"], pallet("AU_STD", 1100, false, [500, 900])),
  item("Lithium batteries", "9", [], pallet("EURO", 1200, false, [300, 700])),
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

/** The item's typical size as shipment fields: a pallet, or loose at its usual (longest that fits) length. */
export function typicalSize(it, maxLengthMm = Infinity) {
  const { size } = it;
  if (size.kind === "pallet") {
    return { kind: "pallet", palletType: size.palletType, heightMm: size.heightMm, stackable: size.stackable };
  }
  const fits = size.lengths.filter((l) => l <= maxLengthMm);
  const lengthMm = fits.length ? fits[fits.length - 1] : size.lengths[0];
  return { kind: "loose", lengthMm, widthMm: size.widthMm, heightMm: size.heightMm, stackable: false };
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

/** General freight shipments with automatic names (each on an AU pallet, 1.2 m high), numbered from `startIndex`. */
export function shipmentsFromWeights(weights, startIndex = 0) {
  return weights.map((weight, k) => ({
    uid: nextUid(),
    name: autoName(startIndex + k),
    weight,
    ...PASTE_SIZE,
    dgClass: null,
    subsidiary: [],
  }));
}

const roundTo = (n, step) => Math.round(n / step) * step;
const between = (lo, hi, random) => lo + random() * (hi - lo);

/** The length (mm) of a random loose item: any length it comes in that fits, the longer ones less often. */
function randomLength(lengths, maxLengthMm, random) {
  const fits = lengths.filter((l) => l <= maxLengthMm);
  const pool = fits.length ? fits : lengths.slice(0, 1);
  // The longest length shows up a quarter as often as the others.
  if (pool.length > 1 && random() < 0.75) return pool[Math.floor(random() * (pool.length - 1))];
  return pool[pool.length - 1];
}

/**
 * `count` random shipments of catalogue items, each with the item's own DG data and a size
 * near its typical one: weights within the item's range (to 5 kg), heights ±10 % (to 50 mm),
 * loose lengths from those the item comes in. `fit` keeps every shipment loadable on the chosen
 * vehicle: lengths up to `maxLengthMm` and heights up to `maxHeightMm` (a stackable item keeps
 * room for a second one on top). Defaults fit the 8 t rigid (4.8 m deck, 2.7 m inside).
 */
export function randomShipments(count = RANDOM_COUNT, random = Math.random, fit = {}) {
  const { maxLengthMm = 4800, maxHeightMm = 2700 } = fit;
  return Array.from({ length: count }, (_, i) => {
    const it = randomItem(random);
    const { size } = it;
    const [lo, hi] = size.kg;
    const cap = size.stackable ? maxHeightMm / 2 : maxHeightMm;
    const heightMm = Math.max(300, Math.min(roundTo(size.heightMm * between(0.9, 1.1, random), 50), Math.floor(cap / 50) * 50));
    const dims = size.kind === "pallet"
      ? { kind: "pallet", palletType: size.palletType }
      : { kind: "loose", lengthMm: randomLength(size.lengths, maxLengthMm, random), widthMm: size.widthMm };
    return {
      uid: nextUid(),
      name: numbered(it.name, i),
      weight: roundTo(between(lo, hi, random), 5),
      ...dims,
      heightMm,
      stackable: size.stackable,
      dgClass: it.dgClass,
      subsidiary: [...it.subsidiary],
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

/**
 * The POST /api/solve body for these shipments (backend/app/demo_models.py SolveRequest).
 * Pallets send their pallet type and no length or width; loose items send length and width
 * and no pallet type. dg_class and subsidiary only go with dangerous goods.
 */
export function toRequest({ vehicleId, bodyType = null, ruleSet = "adg", shipments }) {
  return {
    vehicle_id: vehicleId,
    body_type: bodyType ?? null,
    rule_set: ruleSet,
    shipments: shipments.map((s) => ({
      name: String(s.name).trim(),
      weight: Number(s.weight),
      kind: s.kind,
      ...(s.kind === "loose"
        ? { length_mm: Number(s.lengthMm), width_mm: Number(s.widthMm) }
        : { pallet_type: s.palletType || DEFAULT_PALLET }),
      height_mm: Number(s.heightMm),
      stackable: Boolean(s.stackable),
      ...(s.dgClass ? { dg_class: s.dgClass } : {}),
      ...(s.dgClass && s.subsidiary?.length ? { subsidiary: [...s.subsidiary] } : {}),
    })),
  };
}
