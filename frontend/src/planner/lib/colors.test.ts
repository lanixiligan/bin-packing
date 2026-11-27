import { describe, expect, it } from "vitest";
import {
  HEAT_STEPS, HEAT_TEXT, contrastRatio, heatColor, heatLevel, catColor, catTextColor, textOn, typeCode,
  typePattern,
} from "./colors.ts";

// Read tokens.css from disk (Vitest runs with css: false, so a ?raw import comes back empty).
// @types/node isn't installed, hence the loosely typed dynamic import. Vitest runs from frontend/.
const fsModule = "node:fs";
const { readFileSync } = (await import(/* @vite-ignore */ fsModule)) as {
  readFileSync(path: string, encoding: "utf8"): string;
};
const tokens = readFileSync("src/planner/styles/tokens.css", "utf8");

/** Light-theme value of a token in tokens.css (the first `:root` block). */
function token(name: string): string {
  const root = tokens.slice(tokens.indexOf(":root {"));
  const m = new RegExp(`${name}:\\s*(#[0-9a-fA-F]{3,6})`).exec(root);
  if (!m) throw new Error(`token ${name} not found`);
  return m[1];
}

describe("catColor", () => {
  it("maps categories to the categorical tokens and cycles past 8", () => {
    expect(catColor(0)).toBe("var(--cat-1)");
    expect(catColor(7)).toBe("var(--cat-8)");
    expect(catColor(8)).toBe("var(--cat-1)");
    expect(catColor(17)).toBe("var(--cat-2)");
    expect(catColor(-1)).toBe("var(--cat-8)");
  });

  it("uses --cat-none without a category", () => {
    expect(catColor(null)).toBe("var(--cat-none)");
    expect(catColor(undefined)).toBe("var(--cat-none)");
  });

  it("uses the theme text colour on the neutral", () => {
    expect(catTextColor(2)).toBe("var(--on-cat)");
    expect(catTextColor(null)).toBe("var(--color-text)");
  });
});

describe("heatColor", () => {
  it("spreads weights over the six steps", () => {
    expect(heatLevel(0, 0, 600)).toBe(1);
    expect(heatLevel(599, 0, 600)).toBe(HEAT_STEPS);
    expect(heatLevel(600, 0, 600)).toBe(HEAT_STEPS);
    expect(heatLevel(300, 0, 600)).toBe(4);
    expect(heatLevel(-5, 0, 600)).toBe(1);
    expect(heatLevel(900, 0, 600)).toBe(HEAT_STEPS);
  });

  it("sits mid-scale when every weight is the same", () => {
    expect(heatLevel(700, 700, 700)).toBe(3);
  });

  it("returns token references for the fill and text", () => {
    expect(heatColor(100, 100, 1000)).toEqual({ level: 1, fill: "var(--heat-1)", text: "var(--on-heat-light)" });
    expect(heatColor(1000, 100, 1000).fill).toBe("var(--heat-6)");
  });

  it("picks the text colour with the most contrast on each step, per tokens.css", () => {
    const dark = token("--on-heat-light");
    const light = token("--on-heat-dark");
    for (let level = 1; level <= HEAT_STEPS; level++) {
      const bg = token(`--heat-${level}`);
      const best = textOn(bg, dark, light) === "dark" ? "--on-heat-light" : "--on-heat-dark";
      expect(HEAT_TEXT[level - 1], `heat-${level}`).toBe(best);
      expect(contrastRatio(bg, best === "--on-heat-light" ? dark : light)).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe("typePattern", () => {
  const types = ["EURO", "AU_STD", "HC40", "AU_STD"];

  it("gives each type its own pattern, stable regardless of order", () => {
    const au = typePattern("AU_STD", types);
    const euro = typePattern("EURO", types);
    const hc = typePattern("HC40", types);
    expect(new Set([au.kind, euro.kind, hc.kind]).size).toBe(3);
    expect(typePattern("AU_STD", [...types].reverse())).toEqual(au);
    expect(au.id).toBe(`pat-${au.kind}`);
  });

  it("adds a short type code", () => {
    expect(typePattern("AU_STD", types).code).toBe("AU");
    expect(typeCode("EURO")).toBe("EURO");
    expect(typeCode("HC40")).toBe("HC40");
    expect(typeCode("DOM48")).toBe("DOM48");
    expect(typeCode("SQUARE")).toBe("SQUA");
  });
});

describe("contrast", () => {
  it("computes WCAG ratios", () => {
    expect(contrastRatio("#000", "#fff")).toBeCloseTo(21, 0);
    expect(contrastRatio("#ffffff", "#ffffff")).toBeCloseTo(1);
    expect(textOn("#ffffff", "#0f172a", "#ffffff")).toBe("dark");
    expect(textOn("#0f172a", "#0f172a", "#ffffff")).toBe("light");
  });
});
