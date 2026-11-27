// Deck geometry for the 3D truck view (TruckScene3D.jsx), from lib/sceneData.ts. Originally
// from the bin packing demo.
//
// The solver places every shipment on a deck (placement.x_mm along the deck from the cab end,
// y_mm across from the driver's side, z_mm up; length_mm × width_mm already turned). These
// helpers only scale and group what came back; they never move anything.
//
// Pure functions only (no React, no DOM), so they can be unit-tested with node.

export interface DeckBox {
  id: string;
  name: string;
  length_mm: number;
  width_mm: number;
  height_mm: number;
}

export interface PlacementLike {
  deck_id: string;
  x_mm: number;
  y_mm: number;
  z_mm: number;
  length_mm: number;
  width_mm: number;
  height_mm: number;
  stack_base: number;
  level: number;
}

export interface PlacedLike {
  id: number;
  placement: PlacementLike;
}

/** Room drawn between two decks (the coupling), in mm at the deck scale. */
export const DECK_GAP_MM = 700;

/** A column on the deck: a floor item and whatever stands on it, bottom first. */
export interface Column<S extends PlacedLike = PlacedLike> {
  key: string;
  deckId: string;
  /** Bottom first (level 0, 1, …). */
  items: S[];
  /** The floor item's placement: the column's footprint. */
  base: PlacementLike;
  /** Top of the column above the deck floor, mm. */
  topMm: number;
}

/** A truck's shipments grouped into columns (by deck and stack_base), in floor order. */
export function stackColumns<S extends PlacedLike>(shipments: S[]): Column<S>[] {
  const byKey = new Map<string, S[]>();
  for (const s of shipments) {
    const key = `${s.placement.deck_id}:${s.placement.stack_base}`;
    const list = byKey.get(key);
    if (list) list.push(s);
    else byKey.set(key, [s]);
  }
  return [...byKey.entries()].map(([key, items]) => {
    const sorted = [...items].sort((a, b) => a.placement.level - b.placement.level);
    const base = sorted[0].placement;
    return {
      key,
      deckId: base.deck_id,
      items: sorted,
      base,
      topMm: Math.max(...sorted.map((s) => s.placement.z_mm + s.placement.height_mm)),
    };
  });
}
