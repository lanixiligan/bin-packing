import { describe, expect, it } from "vitest";
import type { FleetResult, PlanRequest } from "../api/types.ts";
import fleetReal from "../../__fixtures__/fleet-real.json";
import { fleetSample, planMultidrop, reference } from "../test/fixtures.ts";
import {
  boundTotals, dropIndexOf, fleetScene, isLit, lineLit, litFromIds, litIds, truckCapacity,
} from "./sceneData.ts";

const { request, result: fleet } = fleetSample;

describe("truckCapacity", () => {
  it("is what the split solver packs against: payload, decks up to the stack cap, floor capped by pallet spaces", () => {
    // Medium rigid, tautliner: 4.8 × 2.4 m deck, 8 pallet spaces; the 1.8 m max stack height is the lowest cap.
    expect(truckCapacity(reference, "RIGID_MEDIUM", "TAUTLINER")).toEqual({
      weight_kg: 8000,
      decks: [{ id: "body", name: expect.any(String), length_mm: 4800, width_mm: 2400, height_mm: 1800 }],
      floor_m2: 10.86, // 8 × 1165² mm², less than the 11.52 m² deck
      volume_m3: 20.74, // 11.52 m² × 1.8 m
    });
    expect(truckCapacity(reference, "NOPE", null)).toBeNull();
  });
});

describe("fleetScene", () => {
  const scene = fleetScene(fleet, reference, request)!;

  it("numbers the units truck by truck and works out each truck's load, floor and height", () => {
    expect(scene.num_trucks).toBe(2);
    expect(scene.vehicle_name).toBe("Medium rigid (8 t)");
    const [t1, t2] = scene.trucks;
    expect(t1).toMatchObject({ truck: 1, load: 5400, empty: 2600, fill_percent: 67.5, floor_used_m2: 10.86,
      floor_percent: 100, max_height_mm: 1200 });
    expect(t2).toMatchObject({ truck: 2, load: 3600, empty: 4400, fill_percent: 45, floor_used_m2: 6.79,
      floor_percent: 62.5, max_height_mm: 1100 });
    expect(t1.shipments.map((s) => s.id)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(t2.shipments.map((s) => s.unitId)).toEqual(["chlor#1", "chlor#2", "cem#5", "cem#6", "chlor#3"]);
  });

  it("gives each unit its line's name, colour index and dangerous goods, and its placement as returned", () => {
    const paint = scene.trucks[0].shipments[0];
    expect(paint).toMatchObject({
      id: 0, name: "Paint 1", lineName: "Paint", line: 0, itemId: "paint", unitId: "paint#1",
      weight: 450, kind: "pallet", pallet_type: "AU_STD", stackable: true, dg_class: "3", subsidiary: [],
      length_mm: 1165, width_mm: 1165, height_mm: 1200,
      placement: { deck_id: "body", x_mm: 0, y_mm: 0, z_mm: 0, length_mm: 1165, width_mm: 1165, height_mm: 1200,
        rotated: false, stack_base: 0, level: 0 },
    });
    const cement = scene.trucks[1].shipments[2];
    expect(cement).toMatchObject({ name: "Cement 5", line: 2, dg_class: null });
  });

  it("drops the units truck by truck, floor first, and maps freight lines to units and back", () => {
    expect(scene.drop_order).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(dropIndexOf(scene)[12]).toBe(12);
    expect(scene.idsByItem.get("paint")).toEqual([0, 1, 6, 7]);
    expect(scene.idsByItem.get("chlor")).toEqual([8, 9, 12]);
    expect(scene.idsByItem.get("cem")).toEqual([2, 3, 4, 5, 10, 11]);
    expect(scene.unitIds[10]).toBe("cem#5");
    expect(scene.itemIds[10]).toBe("cem");
  });

  it("puts a stacked unit after the floor, on its column's base", () => {
    // Paint 2 stood on Paint 1 instead of beside it.
    const t = fleet.trucks[0];
    const stacked: FleetResult = {
      ...fleet,
      trucks: [{
        ...t,
        placements: t.placements.map((p) => (p.unit_id === "paint#2"
          ? { ...p, y_mm: 0, z_mm: 1200, stack_id: 1, stack_level: 1 } : p)),
      }],
    };
    const [truck] = fleetScene(stacked, reference, request)!.trucks;
    const last = truck.shipments[truck.shipments.length - 1];
    expect(last).toMatchObject({ unitId: "paint#2", placement: { level: 1, stack_base: 0, z_mm: 1200 } });
    expect(truck.max_height_mm).toBe(2400);
    expect(truck.floor_used_m2).toBe(9.5); // 7 footprints: the stacked one takes no floor
  });

  it("reads a one-truck plan as a fleet of one", () => {
    const one = fleetScene(planMultidrop.result, reference, planMultidrop.request)!;
    expect(one.num_trucks).toBe(1);
    expect(one.trucks[0].shipments).toHaveLength(planMultidrop.result.placements.length);
    expect(one.trucks[0].load).toBe(planMultidrop.result.total_weight_kg);
  });
});

describe("hover link", () => {
  const scene = fleetScene(fleet, reference, request)!;

  it("lights every unit of a hovered freight line", () => {
    expect(litIds(scene, lineLit("chlor"))).toEqual([8, 9, 12]);
    expect(isLit(lineLit("chlor"), { unit_id: "chlor#2", item_id: "chlor" })).toBe(true);
    expect(litIds(scene, null)).toBeNull();
    expect(litIds(scene, lineLit("not-on-a-truck"))).toBeNull();
  });

  it("turns hovered units into their unit ids and freight lines", () => {
    const lit = litFromIds(scene, [2, 3])!;
    expect(lit).toEqual({ items: ["cem"], units: ["cem#1", "cem#2"] });
    expect(litIds(scene, lit)).toEqual([2, 3]);
    expect(litFromIds(scene, null)).toBeNull();
  });
});

// The real split solver's answer (fleet-sample.json is hand-made, so its bounds aren't computed).
const real = fleetReal as unknown as { request: PlanRequest; result: FleetResult };

describe("real split", () => {
  it("puts every stacked unit on its column's floor unit", () => {
    const scene = fleetScene(real.result, reference, real.request)!;
    const upper = scene.trucks.flatMap((t) => t.shipments).filter((s) => s.placement.level > 0);
    expect(upper.map((s) => s.unitId)).toEqual(["cartons#2", "cartons#4", "cartons#6"]);
    for (const s of upper) {
      const base = scene.trucks[0].shipments.find((b) => b.id === s.placement.stack_base)!;
      expect(base.placement).toMatchObject({ level: 0, x_mm: s.placement.x_mm, y_mm: s.placement.y_mm });
      expect(dropIndexOf(scene)[base.id]).toBeLessThan(dropIndexOf(scene)[s.id]);
    }
  });
});

describe("boundTotals", () => {
  it("gives the totals behind each lower bound, over what one truck holds", () => {
    const t = boundTotals(real.result, reference)!;
    expect(t.weight).toEqual({ total: 12150, capacity: 8000 });
    // Pool chlorine and steel (9 AU pallets) and the 4.5 × 0.3 m pipes can't stack.
    expect(t.floor.total).toBeCloseTo((9 * 1165 * 1165 + 3 * 4500 * 300) / 1e6, 6);
    expect(t.floor.capacity).toBe(10.86);
    expect(t.volume.capacity).toBe(20.74);
    // Each bound the solver gave is ⌈total ÷ capacity⌉.
    for (const key of ["weight", "floor", "volume"] as const) {
      expect(Math.ceil(t[key].total / t[key].capacity)).toBe(real.result.lower_bounds[key]);
    }
  });

  it("counts each unit's weight in whole kg, rounded up, as the backend's weight bound does", () => {
    // 17 × 470.5 kg is 7,998.5 kg raw, but the backend counts 17 × 471 = 8,007 kg: 2 trucks, not 1.
    const truck = real.result.trucks[0];
    const placements = Array.from({ length: 17 }, (_, i) => ({ ...truck.placements[0], unit_id: `x#${i + 1}`, weight_kg: 470.5 }));
    const t = boundTotals({ ...real.result, trucks: [{ ...truck, placements }] }, reference)!;
    expect(t.weight.total).toBe(8007);
  });
});
