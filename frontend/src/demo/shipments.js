// Helpers for building the client-side shipment list.
//
// A shipment in the browser:
//   { uid, name, weight, kind, palletType, lengthMm, widthMm, heightMm, stackable }
// - `uid` is stable so React keys survive edits and removals; it stays in the browser.
// - `kind` is "pallet" (it sits on a pallet of `palletType`, an id from GET /api/reference, and
//   takes the pallet's footprint) or "loose" (its own `lengthMm` × `widthMm`).
// - `heightMm` is the total height, pallet included; `weight` the gross kg, pallet included.
// - `stackable`: may stand on (or carry) another stackable shipment with the same footprint.
// toRequest() turns the list into the POST /api/solve body (backend/app/demo_models.py).

export const MAX_SHIPMENTS = 40; // backend/app/demo_models.py MAX_SHIPMENTS
export const RANDOM_COUNT = 20;
export const DEFAULT_PALLET = "AU_STD";
/** What a pasted weight becomes: an Australian pallet, 1.2 m high, not stackable. */
export const PASTE_SIZE = { kind: "pallet", palletType: DEFAULT_PALLET, heightMm: 1200, stackable: false };

// The demo's item catalogue: each item has its typical size (a pallet type and total height,
// or a loose length × width × height, where `lengths` lists the lengths it comes in), whether
// it stacks, and a gross weight range.
const pallet = (palletType, heightMm, stackable, kg) => ({ kind: "pallet", palletType, heightMm, stackable, kg });
const loose = (lengths, widthMm, heightMm, kg) => ({ kind: "loose", lengths, widthMm, heightMm, stackable: false, kg });
const item = (name, size) => ({ name, size });

export const ITEMS = [
  item("Tiles", pallet("AU_STD", 900, false, [600, 1000])),
  item("Tyres", pallet("AU_STD", 1800, false, [200, 400])),
  item("Steel", loose([2400, 3000, 4000], 500, 300, [500, 1000])),
  item("Books", pallet("AU_STD", 1200, true, [400, 800])),
  item("Glass", pallet("EURO", 1600, false, [300, 700])),
  item("Cement", pallet("AU_STD", 1000, true, [700, 1000])),
  item("Fabric", pallet("EURO", 1400, true, [150, 400])),
  item("Parts", pallet("ISO_UK", 1200, true, [200, 600])),
  item("Toys", pallet("AU_STD", 1600, false, [100, 300])),
  // Pipes come up to 6 m: a long one only fits the bigger vehicles.
  item("Pipes", loose([3000, 4000, 4600, 6000], 400, 300, [150, 400])),
  item("Timber", loose([2400, 3600, 4200, 5400], 600, 500, [300, 700])),
  item("Furniture", pallet("AU_STD", 1800, false, [150, 400])),
  item("Rice", pallet("EURO", 1000, true, [500, 900])),
  item("Fruit", pallet("AU_STD", 1600, false, [400, 800])),
  item("Coffee", pallet("AU_STD", 1200, true, [400, 800])),
  item("Flour", pallet("AU_STD", 1000, true, [600, 1000])),
  item("Paint", pallet("AU_STD", 1200, true, [300, 700])),
];

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

/** Automatic name for a shipment at position `i` (0-based) in the list. */
export function autoName(i) {
  return numbered(ITEMS[i % ITEMS.length].name, i);
}

/** A random catalogue item. */
export function randomItem(random = Math.random) {
  return ITEMS[Math.floor(random() * ITEMS.length)];
}

/** Shipments with automatic names (each on an AU pallet, 1.2 m high), numbered from `startIndex`. */
export function shipmentsFromWeights(weights, startIndex = 0) {
  return weights.map((weight, k) => ({
    uid: nextUid(),
    name: autoName(startIndex + k),
    weight,
    ...PASTE_SIZE,
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
 * `count` random shipments of catalogue items, each with a size near its typical one: weights within the item's range (to 5 kg), heights ±10 % (to 50 mm),
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
 * and no pallet type.
 */
export function toRequest({ vehicleId, bodyType = null, shipments }) {
  return {
    vehicle_id: vehicleId,
    body_type: bodyType ?? null,
    shipments: shipments.map((s) => ({
      name: String(s.name).trim(),
      weight: Number(s.weight),
      kind: s.kind,
      ...(s.kind === "loose"
        ? { length_mm: Number(s.lengthMm), width_mm: Number(s.widthMm) }
        : { pallet_type: s.palletType || DEFAULT_PALLET }),
      height_mm: Number(s.heightMm),
      stackable: Boolean(s.stackable),
    })),
  };
}
