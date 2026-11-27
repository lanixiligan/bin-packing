import { describe, expect, it, vi } from "vitest";
import { csvCell, downloadText, PLACEMENT_HEADER, planCsvFilename, planToCsv } from "./export.ts";
import type { PlanResult } from "../api/types.ts";
import { planBdoubleContainers, planMultidrop, planOverCapacity, reference } from "../test/fixtures.ts";

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
    expect(placements[0]).toEqual(["bev#1", "Beverages", "Australian Standard", "Trailer", "0", "0", "0", "1165",
      "1165", "1200", "820", "0"]);
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
    expect(csv).toContain('bev#1,"Steel, ""heavy""\nfragile",Australian Standard');
    const placements = placementRows(csv);
    expect(placements).toHaveLength(result.placements.length);
    expect(placements[0][1]).toBe('Steel, "heavy"\nfragile');
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
