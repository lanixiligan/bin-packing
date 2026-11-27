// The deck geometry behind the 3D truck view (TruckScene3D.jsx).
import { describe, expect, it } from "vitest";
import { stackColumns, type PlacedLike, type PlacementLike } from "./deck.ts";

/** A unit on the medium rigid's deck: an AU pallet footprint unless told otherwise. */
const unit = (id: number, p: Partial<PlacementLike>): PlacedLike => ({
  id,
  placement: { deck_id: "body", x_mm: 0, y_mm: 0, z_mm: 0, length_mm: 1165, width_mm: 1165, height_mm: 900,
    stack_base: id, level: 0, ...p },
});

describe("stackColumns", () => {
  it("makes one column per floor position, bottom first, with its height", () => {
    const shipments = [
      unit(2, { stack_base: 1, level: 1, z_mm: 900 }), // listed before its base on purpose
      unit(1, { stack_base: 1 }),
      unit(3, { x_mm: 1165 }),
    ];
    const cols = stackColumns(shipments);
    expect(cols).toHaveLength(2);
    const stack = cols.find((c) => c.items.length === 2)!;
    expect(stack.items.map((s) => s.id)).toEqual([1, 2]);
    expect(stack.topMm).toBe(1800);
    expect(stack.deckId).toBe("body");
  });
});
