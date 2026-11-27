import { describe, expect, it } from "vitest";
import { reference } from "../test/fixtures.ts";
import { parseCsv, parseRecords, toCsv } from "./csv.ts";
import { newRow } from "./freight.ts";

let n = 0;
const ids = () => `id-${++n}`;
const parse = (text: string) => parseCsv(text, reference, ids);

describe("parseRecords", () => {
  it("handles quotes, commas and escaped quotes inside quotes, and CRLF", () => {
    const recs = parseRecords('"Cartons, fragile",pallet\r\n"Say ""hi""", x\r\n\r\n"two\nlines",y');
    expect(recs.map((r) => r.cells)).toEqual([
      ["Cartons, fragile", "pallet"],
      ['Say "hi"', " x"],
      ["two\nlines", "y"],
    ]);
    expect(recs.map((r) => r.line)).toEqual([1, 2, 4]);
  });
});

describe("parseCsv", () => {
  it("reads a header row with columns in any order", () => {
    const { rows, problems, header } = parse(
      "type,quantity,weight_kg,height_mm,label,stop\nAU_STD,10,800,1200,General,2\n");
    expect(header).toBe(true);
    expect(problems).toEqual([]);
    expect(rows).toEqual([expect.objectContaining({
      label: "General", kind: "pallet", type_id: "AU_STD", quantity: 10, gross_weight_kg: 800,
      height_mm: 1200, stackable: false, temp_controlled: false, stop: 2,
    })]);
  });

  it("reads rows without a header in the documented column order", () => {
    const { rows, problems, header } = parse('"Cartons, fragile",pallet,euro,6,350,900,yes,no,1');
    expect(header).toBe(false);
    expect(problems).toEqual([]);
    expect(rows[0]).toMatchObject({ label: "Cartons, fragile", type_id: "EURO", quantity: 6, stackable: true, stop: 1 });
  });

  it("accepts yes/no/true/false/1/0 for booleans and reports anything else", () => {
    const { rows, problems } = parse([
      "label,type,quantity,weight_kg,height_mm,stackable,temp_controlled",
      "a,AU_STD,1,500,1200,TRUE,0",
      "b,AU_STD,1,500,1200,no,1",
      "c,AU_STD,1,500,1200,maybe,yes",
    ].join("\n"));
    expect(rows.map((r) => [r.stackable, r.temp_controlled])).toEqual([[true, false], [false, true]]);
    expect(problems).toEqual([{ line: 4, message: 'Line 4: stackable should be yes or no, not "maybe".' }]);
  });

  it("maps type names and ids case-insensitively and infers the kind", () => {
    const { rows, problems } = parse([
      "label,type,quantity,weight_kg,height_mm",
      "x,40' High cube,1,20000,",
      "y,40hc,1,20000,",
      "z,australian standard,2,700,1100",
      "w,gp20,2,12000,",
    ].join("\n"));
    expect(problems).toEqual([]);
    expect(rows.map((r) => [r.kind, r.type_id, r.height_mm])).toEqual([
      ["container", "HC40", null], ["container", "HC40", null], ["pallet", "AU_STD", 1100], ["container", "GP20", null],
    ]);
  });

  it("reports missing and bad numbers per line in plain language", () => {
    const { rows, problems } = parse([
      "label,type,quantity,weight_kg,height_mm,stop",
      "ok,AU_STD,2,\"1,200\",1200,",
      "no weight,AU_STD,2,,1200,",
      "bad qty,AU_STD,two,500,1200,",
      "bad stop,AU_STD,1,500,1200,99",
    ].join("\n"));
    expect(rows).toHaveLength(1);
    expect(rows[0].gross_weight_kg).toBe(1200);
    expect(problems.map((p) => p.message)).toEqual([
      "Line 3: weight is missing.",
      'Line 4: quantity "two" isn\'t a number.',
      'Line 5: stop should be a whole number from 1 to 50, not "99".',
    ]);
  });

  it("reports an unknown type and a kind that doesn't match", () => {
    const { rows, problems } = parse("Crate,pallet,MYSTERY,1,100,1000\nBox,pallet,HC40,1,100,1000");
    expect(rows).toEqual([]);
    expect(problems.map((p) => p.message)).toEqual([
      `Line 1: type "MYSTERY" isn't a pallet or container type we know.`,
      `Line 2: "HC40" is a container type, not a pallet.`,
    ]);
  });

  it("uses the default pallet when only the kind is given", () => {
    const { rows } = parse("label,kind,type,quantity,weight_kg,height_mm\nA,pallet,,3,400,1000");
    expect(rows[0]).toMatchObject({ kind: "pallet", type_id: "AU_STD" });
  });
});

describe("toCsv", () => {
  it("round-trips rows through parseCsv", () => {
    const rows = [
      newRow(reference, { label: 'Cartons, "fragile"', quantity: 6, gross_weight_kg: 350, height_mm: 900, stackable: true, stop: 2 }),
      newRow(reference, { label: "Box", kind: "container", type_id: "HC40", gross_weight_kg: 20000, height_mm: null, temp_controlled: true }),
    ];
    const csv = toCsv(rows);
    expect(csv.split("\n")[0]).toBe("label,kind,type,quantity,weight_kg,height_mm,stackable,temp_controlled,stop");
    const back = parse(csv);
    expect(back.problems).toEqual([]);
    expect(back.rows.map(({ id: _id, ...r }) => r)).toEqual(rows.map(({ id: _id, ...r }) => r));
  });
});
