// Table 9.1 code helpers for the /ops/dg page (no React).
import type { Col } from "../../dg/rules";

export const COL_NAMES: Record<Col, string> = {
  "1": "Explosives", "2.1": "Flammable gas", "2.2": "Non-flammable, non-toxic gas", "2.3": "Toxic gas",
  "3": "Flammable liquids", "4.1": "Flammable solids", "4.2": "Spontaneously combustible", "4.3": "Dangerous when wet",
  "5.1": "Oxidising substances", "5.2": "Organic peroxides", "6": "Toxic or infectious", "7": "Radioactive",
  "8": "Corrosive", "9": "Miscellaneous DG", F: "Food or food empties", R: "Fire-risk or combustible liquid",
};

export type CodeKind = "ok" | "cond" | "bad" | "ex";

export function codeKind(k: string): CodeKind {
  if (k === "(1)") return "ex";
  if (k.startsWith("N")) return "bad";
  return k.includes("(") ? "cond" : "ok";
}

/** Spoken form of a code: "0, exception 3" / "N, incompatible". */
export function codeWords(k: string): string {
  const m = k.match(/^(0|N)\((\d)\)$/);
  if (k === "(1)") return "explosives, see exception 1";
  if (m) return m[1] === "0" ? `compatible unless exception ${m[2]} applies` : `incompatible, exception ${m[2]}`;
  return k === "N" ? "incompatible" : "compatible";
}

