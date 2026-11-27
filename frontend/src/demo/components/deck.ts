// Deck geometry for the truck views (2D plan and 3D trucks), from the solve response.
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

export interface DeckPlan {
  /** px per mm, the same for every deck (and every truck of the vehicle). */
  scale: number;
  /** Widest deck in px. */
  width: number;
  decks: (DeckBox & { widthPx: number; lengthPx: number })[];
}

/**
 * One scale for the vehicle's decks drawn top-down, cab end up: the widest deck is at most
 * `maxWidthPx` wide and all decks end to end (with DECK_GAP_MM between) at most `maxLengthPx` long.
 */
export function deckPlan(decks: DeckBox[], { maxWidthPx = 80, maxLengthPx = 340 } = {}): DeckPlan {
  const widest = Math.max(1, ...decks.map((d) => d.width_mm));
  const total = decks.reduce((s, d) => s + d.length_mm, 0) + DECK_GAP_MM * Math.max(0, decks.length - 1);
  const scale = Math.min(maxWidthPx / widest, maxLengthPx / Math.max(1, total));
  return {
    scale,
    width: widest * scale,
    decks: decks.map((d) => ({ ...d, widthPx: d.width_mm * scale, lengthPx: d.length_mm * scale })),
  };
}

/** A footprint drawn on a deck, in px from the deck's top-left (cab end, driver's side). */
export interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

/** Where a placement's footprint is drawn: x down the deck, y across it. */
export function rectOf(p: Pick<PlacementLike, "x_mm" | "y_mm" | "length_mm" | "width_mm">, scale: number): Rect {
  return { top: p.x_mm * scale, left: p.y_mm * scale, width: p.width_mm * scale, height: p.length_mm * scale };
}

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

/** Floor area (m²) of what has been placed so far: stacked items count once. */
export function floorUsedM2(shipments: PlacedLike[]): number {
  return shipments
    .filter((s) => s.placement.level === 0)
    .reduce((sum, s) => sum + (s.placement.length_mm * s.placement.width_mm) / 1e6, 0);
}
