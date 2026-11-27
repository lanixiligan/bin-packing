// Colour coding for the load plan, as pure functions over the design tokens (styles/tokens.css).
// Everything returns CSS custom-property references, never raw colours, so themes keep working.
// Colour never carries meaning alone: each helper also hands back a badge, code or pattern.

/** Number of distinct categorical colours (--cat-1..8); categories past 8 cycle. */
export const CAT_COLOURS = 8;
/** Number of steps in the weight heat scale (--heat-1..6). */
export const HEAT_STEPS = 6;

/** Fill for the nth category (0 = first): `var(--cat-N)`, cycling past 8; `var(--cat-none)` for none
 *  (general freight in the DG class mode). */
export function catColor(index: number | null | undefined): string {
  if (index == null || !Number.isFinite(index)) return "var(--cat-none)";
  const n = (((Math.round(index) % CAT_COLOURS) + CAT_COLOURS) % CAT_COLOURS) + 1;
  return `var(--cat-${n})`;
}

/** Text colour on any categorical fill (dark text passes AA on every one, see tokens.css). */
export const ON_CAT = "var(--on-cat)";

/** Text on a categorical fill. --cat-none is a neutral that turns dark in the dark theme, so it takes
 *  the theme's text colour rather than the fixed dark --on-cat. */
export function catTextColor(index: number | null | undefined): string {
  return index == null || !Number.isFinite(index) ? "var(--color-text)" : ON_CAT;
}

// ---- Weight heat scale ---------------------------------------------------------

/**
 * Which text token reads best on each heat step (--on-heat-light is the dark text for light fills), light to heavy. Worked out with `textOn` from the
 * token values: dark text (#0f172a) beats white on every step of the teal scale, from 15:1 on
 * --heat-1 down to 4.8:1 on --heat-6 (white manages only 3.7:1 there). colors.test.ts re-checks
 * this against tokens.css, so a token change that flips it fails the tests.
 */
export const HEAT_TEXT: readonly ("--on-heat-light" | "--on-heat-dark")[] = [
  "--on-heat-light", "--on-heat-light", "--on-heat-light", "--on-heat-light", "--on-heat-light", "--on-heat-light",
];

export interface HeatColor {
  /** 1 (lightest) .. HEAT_STEPS (heaviest). */
  level: number;
  fill: string;
  text: string;
}

/** Heat step for `weight` within [min, max]. Equal min and max sit mid-scale. */
export function heatLevel(weight: number, min: number, max: number): number {
  if (!(max > min)) return Math.ceil(HEAT_STEPS / 2);
  const t = Math.min(1, Math.max(0, (weight - min) / (max - min)));
  return Math.min(HEAT_STEPS, Math.floor(t * HEAT_STEPS) + 1);
}

/** Fill and readable text colour for a weight on the heat scale. */
export function heatColor(weight: number, min: number, max: number): HeatColor {
  const level = heatLevel(weight, min, max);
  return { level, fill: `var(--heat-${level})`, text: `var(${HEAT_TEXT[level - 1]})` };
}

// ---- Type patterns -----------------------------------------------------------------

/** SVG pattern kinds, one per freight type, in order of first use; past 6 they repeat. */
export const PATTERN_KINDS = ["hatch", "dots", "cross", "backhatch", "grid", "rows"] as const;
export type PatternKind = (typeof PATTERN_KINDS)[number];

export interface TypePattern {
  /** Local pattern id; prefix it per SVG (ids must be unique in the page). */
  id: string;
  kind: PatternKind;
  /** Short code drawn on the unit: "AU", "EURO", "HC40". */
  code: string;
}

/** "AU_STD" -> "AU", "EURO" -> "EURO", "DOM48" -> "DOM48": the first segment, cut to 4 if over 5. */
export function typeCode(typeId: string): string {
  const first = (typeId.split(/[_\s-]/).find(Boolean) ?? typeId).toUpperCase();
  return first.length > 5 ? first.slice(0, 4) : first;
}

/** Pattern and code for `typeId`, stable for a given set of types (sorted, de-duplicated). */
export function typePattern(typeId: string, allTypeIds: readonly string[]): TypePattern {
  const types = [...new Set(allTypeIds)].sort();
  const i = Math.max(0, types.indexOf(typeId));
  const kind = PATTERN_KINDS[i % PATTERN_KINDS.length];
  return { id: `pat-${kind}`, kind, code: typeCode(typeId) };
}

// ---- Contrast ------------------------------------------------------------------------

function luminance(hex: string): number {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) throw new Error(`Not a hex colour: ${hex}`);
  const h = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1];
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.1 contrast ratio between two hex colours (1..21). */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Whichever of `dark` / `light` text has more contrast on `background` (all hex). */
export function textOn(background: string, dark: string, light: string): "dark" | "light" {
  return contrastRatio(background, dark) >= contrastRatio(background, light) ? "dark" : "light";
}
