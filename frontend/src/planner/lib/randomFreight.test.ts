import { describe, expect, it } from "vitest";
import { isGeneral, normalise } from "../../dg/rules.ts";
import { reference } from "../test/fixtures.ts";
import { validateRows } from "./freight.ts";
import { CATALOGUE, LOOSE_ITEMS, randomFreight, seededRandom } from "./randomFreight.ts";

const strip = <T extends { id: string }>(rows: T[]) => rows.map(({ id: _id, ...r }) => r);

describe("seededRandom", () => {
  it("repeats for the same seed and stays in [0, 1)", () => {
    const a = seededRandom(42), b = seededRandom(42), c = seededRandom(7);
    const xs = Array.from({ length: 50 }, a);
    expect(Array.from({ length: 50 }, b)).toEqual(xs);
    expect(Array.from({ length: 50 }, c)).not.toEqual(xs);
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
  });
});

describe("randomFreight", () => {
  it("is repeatable with a seed", () => {
    const a = randomFreight(reference, { random: seededRandom(1) });
    const b = randomFreight(reference, { random: seededRandom(1) });
    expect(strip(a)).toEqual(strip(b));
    expect(new Set(a.map((r) => r.id)).size).toBe(a.length);
  });

  it.each(Array.from({ length: 40 }, (_, seed) => seed))("gives a valid mix of DG and general lines (seed %i)", (seed) => {
    const rows = randomFreight(reference, { random: seededRandom(seed) });
    expect(rows.length).toBeGreaterThanOrEqual(6);
    expect(rows.length).toBeLessThanOrEqual(10);
    const dg = rows.filter((r) => r.dg?.dg_class);
    expect(dg.length).toBeGreaterThanOrEqual(2);
    expect(rows.some((r) => isGeneral(r.dg))).toBe(true);
    expect(new Set(rows.map((r) => r.label)).size).toBe(rows.length);
    for (const r of rows) {
      if (r.dg) expect(r.dg).toEqual(normalise(r.dg));
      if (r.kind === "loose") continue; // checked in "adds the occasional loose line"
      expect(r).toMatchObject({ kind: "pallet", type_id: "AU_STD", length_mm: null, width_mm: null });
      expect(r.gross_weight_kg).toBeGreaterThanOrEqual(300);
      expect(r.gross_weight_kg).toBeLessThanOrEqual(1000);
      expect(r.height_mm).toBeGreaterThanOrEqual(1000);
      expect(r.height_mm).toBeLessThanOrEqual(1600);
    }
    const v = validateRows(rows, reference);
    expect(v.errors).toEqual({});
    expect(v.items).not.toBeNull();
  });

  it("adds the occasional loose line: pipes or timber with a realistic size", () => {
    const lists = Array.from({ length: 40 }, (_, seed) => randomFreight(reference, { random: seededRandom(seed) }));
    const loose = lists.flat().filter((r) => r.kind === "loose");
    const withLoose = lists.filter((rows) => rows.some((r) => r.kind === "loose")).length;
    // Occasional: some lists have one, most lines are still pallets.
    expect(withLoose).toBeGreaterThanOrEqual(5);
    expect(withLoose).toBeLessThan(40);
    expect(loose.length).toBeLessThan(lists.flat().length / 4);
    expect(new Set(loose.map((r) => r.label))).toEqual(new Set(["Pipes", "Timber"]));
    for (const r of loose) {
      const spec = LOOSE_ITEMS[r.label];
      expect(r).toMatchObject({ type_id: "LOOSE", dg: null });
      expect(r.length_mm).toBeGreaterThanOrEqual(spec.length[0]);
      expect(r.length_mm).toBeLessThanOrEqual(6000);
      expect(r.width_mm).toBeGreaterThanOrEqual(spec.width[0]);
      expect(r.width_mm).toBeLessThanOrEqual(1200);
      expect(r.height_mm).toBeGreaterThanOrEqual(spec.height[0]);
      expect(r.height_mm).toBeLessThanOrEqual(spec.height[1]);
      expect(r.gross_weight_kg).toBeLessThanOrEqual(spec.weight[1]);
    }
    // Pipes and timber still come on pallets too.
    expect(lists.flat().some((r) => r.label === "Pipes" && r.kind === "pallet")).toBe(true);
  });

  it("keeps each catalogue item's own DG data", () => {
    const byLabel = new Map(CATALOGUE.map((i) => [i.label, i.dg]));
    expect(byLabel.get("Paint")).toMatchObject({ dg_class: "3", subsidiary: [], t92: [], container: "package" });
    expect(byLabel.get("Methanol")).toMatchObject({ dg_class: "3", subsidiary: ["6.1"] });
    expect(byLabel.get("Rice")).toMatchObject({ dg_class: null, food: true });
    expect(byLabel.get("Timber")).toBeNull();
    for (let seed = 0; seed < 20; seed++) {
      for (const r of randomFreight(reference, { random: seededRandom(seed) })) expect(r.dg).toEqual(byLabel.get(r.label));
    }
  });
});
