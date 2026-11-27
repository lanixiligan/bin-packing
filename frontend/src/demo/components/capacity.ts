// Shipment colours and dangerous goods text shared by the table and the truck views (2D and 3D).
// Truck capacity itself comes from the vehicle (vehicle.ts) and the solve response.
//
// Pure functions only (no React, no DOM), so they can be unit-tested with node.

// Same shipment = same color in both panels, so you can compare them.
// Lightness 74% keeps the near-black labels (#0f172a) above 6:1 for every hue
// (WCAG AA needs 4.5:1; at 62% the blue hues only reached 3.5:1).
export function colorFor(id: number): string {
  const hue = (id * 137.508) % 360; // golden angle spreads colors nicely
  return `hsl(${hue}, 55%, 74%)`;
}

/** A shipment's dangerous goods: `dg_class` ("3", "food", "fire_risk", …) and `subsidiary` hazards. */
export interface DgLike {
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
export function dgTextOf(s: DgLike): string {
  return dgClassText(s.dg_class, s.subsidiary);
}

/** Placard code for a shipment ("food" → "F", "fire_risk" → "R"); null for none. */
export function dgCodeOf(s: Pick<DgLike, "dg_class">): string | null {
  const c = s.dg_class;
  if (!c) return null;
  return c === "food" ? "F" : c === "fire_risk" ? "R" : c;
}
