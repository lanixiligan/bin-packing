// Helpers for building the client-side shipment list.
// Each shipment gets a stable `uid` so React keys survive edits and removals.
// The uid stays in the browser: only { name, weight } is sent to /solve.

const CARGO = ["Tiles", "Paint", "Rice", "Tyres", "Steel", "Books", "Fruit",
  "Glass", "Cement", "Fabric", "Parts", "Toys", "Coffee", "Pipes", "Wood"];

let lastUid = 0;
export const nextUid = () => ++lastUid;

/** Automatic name for the shipment at position `i` (0-based) in the list. */
export function autoName(i) {
  return `${CARGO[i % CARGO.length]} ${String(i + 1).padStart(2, "0")}`;
}

/** Shipments with automatic names, numbered from `startIndex`. */
export function shipmentsFromWeights(weights, startIndex = 0) {
  return weights.map((weight, k) => ({
    uid: nextUid(),
    name: autoName(startIndex + k),
    weight,
  }));
}

export function randomShipments(count = 20, min = 50, max = 600) {
  return shipmentsFromWeights(
    Array.from({ length: count }, () => Math.floor(min + Math.random() * (max - min + 1)))
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
