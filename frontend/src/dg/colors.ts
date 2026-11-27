// Placard colours for DG class diamonds, after the CTO's ADG checker page. One table, DG_PLACARD,
// drives every diamond: the CSS ones (DgBadge, HazardPicker, checker page) through DG_FILL, and the
// SVG ones on the deck and elevation views (DeckView's DgDiamond) directly.

const WHITE = "#FFFFFF", BLACK = "#111111", RED = "#E2231A", ORANGE = "#F7941D", GREEN = "#00A651";
const BLUE = "#0072BC", YELLOW = "#FFD200";

/**
 * A placard: the top and bottom halves of the diamond, optional vertical stripes (alternating
 * `color` and white, over the whole diamond or just the top half), and the ink for the class number.
 */
export interface Placard {
  top: string;
  bottom: string;
  stripes?: { color: string; half: boolean };
  ink: string;
}

const solid = (fill: string, ink = BLACK): Placard => ({ top: fill, bottom: fill, ink });

/** Placard per class code; "6" is the Table 9.1 column for 6.1 and 6.2. */
export const DG_PLACARD: Record<string, Placard> = {
  "1": solid(ORANGE),
  "2.1": solid(RED, WHITE),
  "2.2": solid(GREEN, WHITE),
  "2.3": solid(WHITE),
  "3": solid(RED, WHITE),
  "4.1": { top: WHITE, bottom: WHITE, stripes: { color: RED, half: false }, ink: BLACK },
  "4.2": { top: WHITE, bottom: RED, ink: BLACK },
  "4.3": solid(BLUE, WHITE),
  "5.1": solid(YELLOW),
  "5.2": { top: RED, bottom: YELLOW, ink: BLACK },
  "6": solid(WHITE),
  "6.1": solid(WHITE),
  "6.2": solid(WHITE),
  "7": { top: YELLOW, bottom: WHITE, ink: BLACK },
  "8": { top: WHITE, bottom: BLACK, ink: WHITE },
  "9": { top: WHITE, bottom: WHITE, stripes: { color: BLACK, half: true }, ink: BLACK },
};

/** The placard key for a badge code: "1.4S" -> "1"; "F" / "R" (food, fire-risk) have none. */
export function placardKey(code: string): string {
  return code.startsWith("1") ? "1" : code;
}

function cssFill(p: Placard): string {
  if (p.stripes) {
    const s = `repeating-linear-gradient(90deg,${p.stripes.color} 0 3px,${WHITE} 3px 6px)`;
    return p.stripes.half ? `linear-gradient(180deg,transparent 50%,${p.bottom} 50%),${s}` : s;
  }
  return p.top === p.bottom ? p.top : `linear-gradient(180deg,${p.top} 50%,${p.bottom} 50%)`;
}

/** CSS background for each placard (the CSS diamonds paint it inside a clip-path). */
export const DG_FILL: Record<string, string> = Object.fromEntries(
  Object.entries(DG_PLACARD).map(([k, p]) => [k, cssFill(p)]),
);
export const DG_ICON: Record<string, string> = { F: "\u{1F37D}️", R: "\u{1F525}" };
