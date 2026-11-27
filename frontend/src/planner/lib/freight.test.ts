import { describe, expect, it } from "vitest";
import { reference } from "../test/fixtures.ts";
import { newLooseRow, newRow, newRowId, sampleRows, toItem, validateRows } from "./freight.ts";

const pallet = (o = {}) => newRow(reference, o);
const container = (o = {}) => newRow(reference, { kind: "container", type_id: "HC40", gross_weight_kg: 20000, height_mm: null, ...o });

describe("validateRows", () => {
  it("turns valid rows into request items", () => {
    const rows = sampleRows(reference);
    const v = validateRows(rows, reference);
    expect(v.errors).toEqual({});
    expect(v.listErrors).toEqual([]);
    expect(v.items).toHaveLength(2);
    expect(v.items![0]).toMatchObject({ kind: "pallet", type_id: "AU_STD", quantity: 10, gross_weight_kg: 800 });
  });

  it("asks for at least one line", () => {
    const v = validateRows([], reference);
    expect(v.items).toBeNull();
    expect(v.listErrors).toEqual(["Add at least one line of freight."]);
  });

  it("explains a pallet that is too tall in metres", () => {
    const r = pallet({ height_mm: 2100 });
    const v = validateRows([r], reference);
    expect(v.items).toBeNull();
    expect(v.errors[r.id].height_mm).toBe("This pallet is 2.1 m tall; the max stack height is 1.8 m.");
  });

  it("checks quantity and weight in plain language", () => {
    const a = pallet({ quantity: null, gross_weight_kg: null, height_mm: null });
    const b = pallet({ quantity: 2.5, gross_weight_kg: 1600 });
    const c = pallet({ quantity: 201, gross_weight_kg: 20 });
    const { errors } = validateRows([a, b, c], reference);
    expect(errors[a.id]).toEqual({
      quantity: "Enter how many, a whole number from 1.",
      gross_weight_kg: "Enter the weight of one pallet in kg.",
      height_mm: "Enter the pallet's height in mm, including the pallet.",
    });
    expect(errors[b.id].quantity).toBe("Enter how many, a whole number from 1.");
    expect(errors[b.id].gross_weight_kg).toBe("This pallet weighs 1,600 kg; one pallet is limited to 1,500 kg.");
    expect(errors[c.id].quantity).toBe("At most 200 per line: split it into more lines.");
    expect(errors[c.id].gross_weight_kg).toBe("That's lighter than an empty pallet (35 kg): include the pallet in the weight.");
  });

  it("flags a type that doesn't match the kind", () => {
    const r = pallet({ type_id: "HC40" });
    expect(validateRows([r], reference).errors[r.id].type_id).toBe("Pick a pallet type.");
  });

  it("ignores a container's height and checks its max gross", () => {
    const ok = container({ height_mm: 99999 });
    const heavy = container({ gross_weight_kg: 32000 });
    const light = container({ type_id: "GP20", gross_weight_kg: 1000 });
    const v = validateRows([ok, heavy, light], reference);
    expect(v.errors[ok.id]).toBeUndefined();
    expect(v.errors[heavy.id]).toEqual({
      gross_weight_kg: "This container weighs 32,000 kg; a 40' High cube is limited to 30,480 kg gross.",
    });
    expect(v.errors[light.id].gross_weight_kg).toMatch(/an empty 20' General purpose weighs 2,250 kg/i);
    expect(toItem(ok).height_mm).toBeNull();
  });

  it("sends a loose item with its own size and no pallet type", () => {
    const r = newLooseRow(reference, { label: "Pipes", quantity: 3, gross_weight_kg: 450, length_mm: 6000, width_mm: 800.4,
                                       height_mm: 400, stackable: true });
    const v = validateRows([r, pallet()], reference);
    expect(v.errors).toEqual({});
    expect(v.items![0]).toEqual({
      id: r.id, label: "Pipes", kind: "loose", type_id: "LOOSE", length_mm: 6000, width_mm: 800, quantity: 3,
      gross_weight_kg: 450, height_mm: 400, stackable: true, temp_controlled: false, dg: null,
    });
    // Pallets and containers take their footprint from the type: the backend rejects a length or width on them.
    expect(v.items![1]).not.toHaveProperty("length_mm");
    expect(v.items![1]).not.toHaveProperty("width_mm");
    expect(toItem(container({ length_mm: 5000, width_mm: 2000 }))).not.toHaveProperty("length_mm");
  });

  it("asks for a loose item's length, width and height, within the planner's limits", () => {
    const empty = newLooseRow(reference, { length_mm: null, width_mm: 0, height_mm: null, gross_weight_kg: null });
    const big = newLooseRow(reference, { length_mm: 20001, width_mm: 25000, height_mm: 5001, gross_weight_kg: 60001 });
    const edge = newLooseRow(reference, { length_mm: 20000, width_mm: 2400, height_mm: 5000, gross_weight_kg: 60000 });
    const v = validateRows([empty, big, edge], reference);
    expect(v.items).toBeNull();
    expect(v.errors[empty.id]).toEqual({
      gross_weight_kg: "Enter the weight of one item in kg.",
      length_mm: "Enter the item's length in mm.",
      width_mm: "Enter the item's width in mm.",
      height_mm: "Enter the item's height in mm.",
    });
    expect(v.errors[big.id]).toEqual({
      gross_weight_kg: "One unit can weigh at most 60,000 kg.",
      length_mm: "That's 20 m; the length can be at most 20 m.",
      width_mm: "That's 25 m; the width can be at most 20 m.",
      height_mm: "That's 5 m; the height can be at most 5 m.",
    });
    expect(v.errors[edge.id]).toBeUndefined();
  });

  it("doesn't hold a loose item to the pallet weight or height rules", () => {
    // 2.4 m tall and 3 t: fine for a loose item, too tall and too heavy for one pallet.
    const r = newLooseRow(reference, { height_mm: 2400, gross_weight_kg: 3000 });
    expect(validateRows([r], reference).errors).toEqual({});
  });

  it("limits the units in one plan", () => {
    const rows = [1, 2, 3].map(() => pallet({ quantity: 200 }));
    expect(validateRows(rows, reference).listErrors[0]).toMatch(/600 units; one plan takes at most 500/);
  });

  it("makes unique row ids", () => {
    expect(newRowId()).not.toBe(newRowId());
  });
});
