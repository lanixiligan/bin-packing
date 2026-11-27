import { describe, expect, it, vi } from "vitest";
import { csvCell, downloadText, fleetToCsv, PLACEMENT_HEADER, planCsvFilename, planToCsv } from "./export.ts";
import type { PlanResult } from "../api/types.ts";
import { fleetSample, planBdoubleContainers, planMultidrop, planOverCapacity, reference } from "../test/fixtures.ts";

/** Minimal RFC 4180 parser, enough to check our own output. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\r" && text[i + 1] === "\n") { row.push(field); rows.push(row); row = []; field = ""; i++; }
    else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function placementRows(csv: string): string[][] {
  const rows = parseCsv(csv);
  const header = rows.findIndex((r) => r[0] === "Unit");
  const body = rows.slice(header + 1);
  const end = body.findIndex((r) => r.length === 1 && r[0] === "");
  return end === -1 ? body : body.slice(0, end);
}

describe("planToCsv", () => {
  it("writes a summary, then a placements header and one row per placement", () => {
    const { result, request } = planMultidrop;
    const csv = planToCsv(result, request, reference);
    const rows = parseCsv(csv);
    expect(rows[0]).toEqual(["Load plan"]);
    expect(rows).toContainEqual(["Vehicle", "Semi-trailer (13.7 m class)"]);
    expect(rows).toContainEqual(["Fits", "Yes"]);
    expect(rows).toContainEqual(["Total weight (kg)", "14530"]);
    expect(rows.find((r) => r[0] === "Unit")).toEqual(PLACEMENT_HEADER);
    expect(PLACEMENT_HEADER).toEqual(["Unit", "Item", "Type", "Deck", "X (mm)", "Y (mm)", "Z (mm)", "Length (mm)",
      "Width (mm)", "Height (mm)", "Weight (kg)", "Level"]);

    const placements = placementRows(csv);
    expect(placements).toHaveLength(result.placements.length);
    const p = result.placements[0];
    expect(placements[0]).toEqual([p.unit_id, p.label, "Australian Standard", "Trailer", String(p.x_mm), String(p.y_mm),
      String(p.z_mm), String(p.length_mm), String(p.width_mm), String(p.height_mm), String(p.weight_kg),
      String(p.stack_level)]);
    expect(csv.endsWith("\r\n")).toBe(true);
  });

  it("lists the problems and the units that didn't fit", () => {
    const csv = planToCsv(planOverCapacity.result, planOverCapacity.request, reference);
    const rows = parseCsv(csv);
    expect(rows).toContainEqual(["Fits", "No"]);
    expect(rows.find((r) => r[0] === "Problem")?.[1]).toMatch(/^Over by 1 pallet/);
    expect(rows).toContainEqual(["Not placed", "chill#3"]);
    expect(placementRows(csv)).toHaveLength(22);
  });

  it("names container types and decks", () => {
    const csv = planToCsv(planBdoubleContainers.result, planBdoubleContainers.request, reference);
    const placements = placementRows(csv);
    expect(placements).toHaveLength(2);
    expect(placements[0].slice(0, 4)).toEqual(["c20#1", "MSKU 20'", "20' General purpose", "Lead trailer"]);
  });

  it("quotes commas, quotes and line breaks in labels", () => {
    const result: PlanResult = {
      ...planMultidrop.result,
      vehicle_name: "Semi, \"long\"",
      placements: planMultidrop.result.placements.map((p, i) => (i === 0 ? { ...p, label: 'Steel, "heavy"\nfragile' } : p)),
    };
    const csv = planToCsv(result, planMultidrop.request, reference);
    expect(csv).toContain('Vehicle,"Semi, ""long"""');
    expect(csv).toContain(`${result.placements[0].unit_id},"Steel, ""heavy""\nfragile",Australian Standard`);
    const placements = placementRows(csv);
    expect(placements).toHaveLength(result.placements.length);
    expect(placements[0][1]).toBe('Steel, "heavy"\nfragile');
  });
});

/** The table under the section title `title`: its header row and its body, up to the next blank line. */
function section(csv: string, title: string): { header: string[]; body: string[][] } {
  const rows = parseCsv(csv);
  const start = rows.findIndex((r, i) => r.length === 1 && r[0] === title && i > 0);
  const rest = rows.slice(start + 1);
  const end = rest.findIndex((r) => r.length === 1 && r[0] === "");
  const [header, ...body] = end === -1 ? rest : rest.slice(0, end);
  return { header, body };
}

describe("fleetToCsv", () => {
  const { request, result: fleet } = fleetSample;
  const csv = fleetToCsv(fleet, request, reference);

  it("starts with a summary of the split", () => {
    const rows = parseCsv(csv);
    expect(rows[0]).toEqual(["Load plan: split across trucks"]);
    expect(rows).toContainEqual(["Vehicle", "Medium rigid (8 t)"]);
    expect(rows).toContainEqual(["Trucks", "2"]);
    expect(rows).toContainEqual(["Fewest trucks proven", "Yes"]);
    expect(rows).toContainEqual(["Fewest trucks possible", "2"]);
    expect(rows).toContainEqual(["Fewest by floor space", "2"]);
    expect(rows).toContainEqual(["Units placed", "13"]);
    expect(rows).toContainEqual(["Units not placed", "0"]);
    expect(csv.endsWith("\r\n")).toBe(true);
  });

  it("has a Truck column in front of every placement, truck 1 first", () => {
    const { header, body } = section(csv, "Placements");
    expect(header).toEqual(["Truck", ...PLACEMENT_HEADER]);
    expect(body).toHaveLength(fleet.trucks[0].placements.length + fleet.trucks[1].placements.length);
    expect(body.map((r) => r[0])).toEqual([...Array(8).fill("1"), ...Array(5).fill("2")]);
    const p = fleet.trucks[1].placements[0];
    expect(body[8]).toEqual(["2", p.unit_id, "Pool chlorine", "Australian Standard", "Body", String(p.x_mm), String(p.y_mm),
      String(p.z_mm), String(p.length_mm), String(p.width_mm), String(p.height_mm), String(p.weight_kg), String(p.stack_level)]);
  });

  it("lists each truck and its axle loads by truck number", () => {
    const trucks = section(csv, "Trucks");
    expect(trucks.header.slice(0, 5)).toEqual(["Truck", "Fits", "Units", "Total weight (kg)", "Payload (%)"]);
    expect(trucks.body.map((r) => r.slice(0, 5))).toEqual([["1", "Yes", "8", "5400", "67.5"], ["2", "Yes", "5", "3600", "45"]]);
    const axles = section(csv, "Axle loads");
    expect(axles.header).toEqual(["Truck", "Axle group", "Load (kg)", "Limit (kg)", "Status"]);
    expect(axles.body).toEqual([
      ["1", "Steer", "4604", "6000", "ok"], ["1", "Rear single", "6296", "9000", "ok"],
      ["2", "Steer", "4261", "6000", "ok"], ["2", "Rear single", "4839", "9000", "ok"],
    ]);
  });

  it("lists units no truck can take and names loose items", () => {
    const [first, ...rest] = fleet.trucks[0].placements;
    const loose = { ...first, kind: "loose" as const, type_id: "LOOSE", label: "Pipes" };
    const withLoose = {
      ...fleet, fits: false, unplaced: ["cem#6"], reasons: ["Cement is too heavy."],
      trucks: [{ ...fleet.trucks[0], placements: [loose, ...rest] }, fleet.trucks[1]],
    };
    const out = fleetToCsv(withLoose, request, reference);
    const rows = parseCsv(out);
    expect(rows).toContainEqual(["Fits", "No"]);
    expect(rows).toContainEqual(["Problem", "Cement is too heavy."]);
    expect(rows).toContainEqual(["Not placed", "cem#6"]);
    expect(section(out, "Placements").body[0].slice(0, 4)).toEqual(["1", first.unit_id, "Pipes", "Loose item"]);
  });
});

describe("csvCell", () => {
  it("leaves plain values alone and neutralises formulas", () => {
    expect(csvCell("Hardware")).toBe("Hardware");
    expect(csvCell(12.345)).toBe("12.35");
    expect(csvCell(null)).toBe("");
    expect(csvCell("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(csvCell("-5")).toBe("'-5");
    expect(csvCell(-5)).toBe("-5");
  });
});

describe("planCsvFilename", () => {
  it("names the file after the vehicle and the local date", () => {
    expect(planCsvFilename("SEMI_TRAILER", new Date(2026, 10, 27, 23, 30))).toBe("load-plan-SEMI_TRAILER-2026-11-27.csv");
    expect(planCsvFilename("a/b c", new Date(2026, 0, 5))).toBe("load-plan-a_b_c-2026-01-05.csv");
  });

  it("adds the truck count for a split", () => {
    const day = new Date(2026, 10, 27);
    expect(planCsvFilename("RIGID_MEDIUM", day, 3)).toBe("load-plan-RIGID_MEDIUM-3-trucks-2026-11-27.csv");
    expect(planCsvFilename("RIGID_MEDIUM", day, 1)).toBe("load-plan-RIGID_MEDIUM-1-truck-2026-11-27.csv");
  });
});

describe("downloadText", () => {
  it("clicks a download link to an object URL and revokes it afterwards", () => {
    vi.useFakeTimers();
    try {
      const create = vi.fn((_blob: Blob) => "blob:plan");
      const revoke = vi.fn();
      Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke });
      const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

      downloadText("plan.csv", "a,b\r\n", "text/csv");

      expect(create).toHaveBeenCalledOnce();
      expect(create.mock.calls[0][0].type).toBe("text/csv");
      expect(click).toHaveBeenCalledOnce();
      const clicked = click.mock.contexts[0] as HTMLAnchorElement;
      expect(clicked.download).toBe("plan.csv");
      expect(clicked.href).toBe("blob:plan");
      expect(document.querySelector("a[download]")).toBeNull();
      vi.runAllTimers();
      expect(revoke).toHaveBeenCalledWith("blob:plan");
    } finally {
      vi.useRealTimers();
    }
  });
});
