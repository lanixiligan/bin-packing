// Pallet deck geometry for the truck views (2D plan and 3D trailer).
//
// Drawing only: the solver still counts pallet SPACES (capacity.pallets,
// shipment.pallets). This file turns those counts into a floor plan at real
// size, using Australian standard sizes: a CHEP pallet is 1165 × 1165 mm and
// a deck is 2400 mm wide, so two pallets fit side by side. The deck length
// follows from the truck's pallet limit (or from the load when unlimited).
//
// Pure functions only (no React, no DOM), so they can be unit-tested with node.
import { EPS, limitOf, type CapacityLimits, type ShipmentLike } from "./capacity.ts";

export const PALLET_MM = 1165;
export const DECK_WIDTH_MM = 2400;
/** Clearance between rows (and at the cab and rear ends). */
export const ROW_GAP_MM = 50;
/** Height of the load on a pallet in the 3D view. */
export const LOAD_MM = 1200;
/** Rows drawn for an unlimited deck, at least (so a tiny load doesn't look like a ute). */
const MIN_ROWS = 2;

export interface Deck {
  /** Pallets side by side: 2, or 1 for a single-slot deck. */
  across: number;
  rows: number;
  /** Usable pallet slots (an odd limit leaves the last row half used). */
  slots: number;
  lengthMm: number;
  widthMm: number;
  /** True when the slots come from a pallet limit, false when sized to the load. */
  limited: boolean;
}

const lengthFor = (rows: number) => rows * PALLET_MM + (rows + 1) * ROW_GAP_MM;

/**
 * The deck of a truck with `maxPallets` pallet spaces (null = not limited:
 * sized to `loadedPallets`, at least two rows).
 */
export function deckFor(maxPallets: number | null | undefined, loadedPallets = 0): Deck {
  const limited = maxPallets != null && maxPallets > 0;
  if (limited) {
    const slots = Math.ceil(maxPallets - EPS);
    const across = slots === 1 ? 1 : 2;
    const rows = Math.ceil(slots / across);
    return { across, rows, slots, lengthMm: lengthFor(rows), widthMm: DECK_WIDTH_MM, limited };
  }
  const rows = Math.max(MIN_ROWS, Math.ceil(Math.ceil(loadedPallets - EPS) / 2));
  return { across: 2, rows, slots: rows * 2, lengthMm: lengthFor(rows), widthMm: DECK_WIDTH_MM, limited };
}

const palletsOf = (s: ShipmentLike) => (s.pallets != null && s.pallets > EPS ? s.pallets : 0);

/** True when a truck should be drawn as a pallet deck: a pallet limit, or any shipment on pallets. */
export function usesDeck(shipments: ShipmentLike[], cap: number | CapacityLimits | null | undefined): boolean {
  if (cap != null && typeof cap === "object" && limitOf(cap, "pallets") != null) return true;
  return shipments.some((s) => palletsOf(s) > 0);
}

/** The deck of one truck: its pallet limit, or sized to all of its shipments (stable while dropping). */
export function truckDeck(shipments: ShipmentLike[], cap: number | CapacityLimits | null | undefined): Deck {
  const limit = cap != null && typeof cap === "object" ? limitOf(cap, "pallets") : null;
  return deckFor(limit, shipments.reduce((sum, s) => sum + palletsOf(s), 0));
}

export interface PalletPiece {
  /** Shipment id (several pieces share it when a shipment has several pallets). */
  id: number;
  slot: number;
  row: number;
  /** 0 = left (driver's side), 1 = right. */
  col: number;
  /** Part of the slot's length taken, 0..1 from the cab end: [0, 1] for a whole pallet. */
  from: number;
  to: number;
  /** Past the last slot: the load is over the deck's pallet capacity. */
  over: boolean;
  /** True for the shipment's first piece (the one that carries its label and focus). */
  first: boolean;
}

export interface DeckLayout<S extends ShipmentLike = ShipmentLike> {
  pieces: PalletPiece[];
  /** Shipments without pallets (loose freight): not placed on the deck. */
  loose: S[];
  /** Rows drawn: the deck's rows, plus any rows of over-capacity pieces past the rear. */
  rows: number;
}

/**
 * Places shipments on the deck in list order: whole pallets take the next
 * free slot, front (cab end) to back, left then right in each row. A
 * fractional remainder (0.5 of a space) shares a slot along its length with
 * another fraction when one has room, else it starts a free slot. Pieces past
 * the deck's last slot are marked `over`.
 */
export function layoutPallets<S extends ShipmentLike>(shipments: S[], deck: Deck): DeckLayout<S> {
  const fill: number[] = []; // used length (0..1) per slot index, growing past deck.slots when over
  const pieces: PalletPiece[] = [];
  const loose: S[] = [];

  const freeSlot = () => {
    let i = 0;
    while ((fill[i] ?? 0) > EPS) i++;
    return i;
  };
  const place = (id: number, slot: number, size: number, first: boolean) => {
    const from = fill[slot] ?? 0;
    fill[slot] = from + size;
    pieces.push({
      id, slot, row: Math.floor(slot / deck.across), col: slot % deck.across,
      from, to: from + size, over: slot >= deck.slots, first,
    });
  };

  for (const s of shipments) {
    const p = palletsOf(s);
    if (p === 0) {
      loose.push(s);
      continue;
    }
    let whole = Math.floor(p + EPS);
    const frac = p - whole > EPS ? p - whole : 0;
    let first = true;
    for (; whole > 0; whole--) {
      place(s.id, freeSlot(), 1, first);
      first = false;
    }
    if (frac > 0) {
      let slot = fill.findIndex((f) => f > EPS && f + frac <= 1 + EPS);
      if (slot < 0) slot = freeSlot();
      place(s.id, slot, frac, first);
    }
  }

  const lastRow = pieces.reduce((m, pc) => Math.max(m, pc.row), -1);
  return { pieces, loose, rows: Math.max(deck.rows, lastRow + 1) };
}

/** "2 pallet spaces of 1165 × 1165 mm", or "" for loose freight. */
export function palletFootprint(pallets: number | null | undefined): string {
  if (!pallets || pallets <= EPS) return "";
  const n = pallets.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return `${n} pallet space${pallets === 1 ? "" : "s"} of ${PALLET_MM} × ${PALLET_MM} mm`;
}

/** "13.4 × 2.4 m deck, 22 pallet spaces" for labels and screen readers. */
export function describeDeck(deck: Deck): string {
  const m = (mm: number) => (mm / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 });
  return `${m(deck.lengthMm)} × ${m(deck.widthMm)} m deck, ${deck.slots} pallet space${deck.slots === 1 ? "" : "s"}`;
}
