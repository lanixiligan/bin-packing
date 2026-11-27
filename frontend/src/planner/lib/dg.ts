// Dangerous goods helpers shared by the planner UI. The rules themselves live in the backend
// (app/dg.py, ADG Code Table 9.1 / 9.2), with a TypeScript port in src/dg/rules.ts; the plan's
// warnings (DG_INCOMPATIBLE, DG_CHECK, ...) are the authority on what conflicts.

import type { DgInfo, PlanRequest, PlanWarning } from "../api/types.ts";
import {
  CLASS_NAMES, dgLabel, EXPLOSIVE_CODE_RE, isGeneral, NO_PACKING_GROUP, normalise, SUBSIDIARIES, type DgClass, type Subsidiary,
} from "../../dg/rules.ts";

export { CLASS_NAMES, dgLabel, isGeneral };

/** DG data per freight line id, from the request that produced a plan (general freight omitted). */
export function dgByItem(request: PlanRequest): Map<string, DgInfo> {
  const out = new Map<string, DgInfo>();
  for (const item of request.items) if (item.dg && !isGeneral(item.dg)) out.set(item.id, item.dg);
  return out;
}

/** The short code shown on a placard-style badge: "3", "5.1", "1.4S", "F" (food), "R" (fire-risk). */
export function placardCode(dg: DgInfo | null | undefined): string | null {
  if (!dg || isGeneral(dg)) return null;
  if (!dg.dg_class) return dg.food ? "F" : "R";
  return dg.dg_class === "1" && dg.explosive_code ? dg.explosive_code : dg.dg_class;
}

/** "Flammable liquid" for a class, "Food", "Fire-risk goods". */
export function dgName(dg: DgInfo | null | undefined): string {
  if (!dg || isGeneral(dg)) return "General freight";
  if (!dg.dg_class) return dg.food ? "Food" : "Fire-risk goods";
  return CLASS_NAMES[dg.dg_class as DgClass];
}

export interface DgConflict {
  /** The other freight line ids this line conflicts with. */
  with: string[];
  /** The warning messages (DG_INCOMPATIBLE errors first, then DG_CHECK). */
  messages: string[];
  severity: "error" | "warning";
}

/** Freight lines named in DG_INCOMPATIBLE (error) or DG_CHECK (warning) warnings. */
export function dgConflicts(warnings: PlanWarning[]): Map<string, DgConflict> {
  const out = new Map<string, DgConflict>();
  const ordered = [...warnings].sort((a, b) => (a.code === "DG_INCOMPATIBLE" ? -1 : 0) - (b.code === "DG_INCOMPATIBLE" ? -1 : 0));
  for (const w of ordered) {
    if (w.code !== "DG_INCOMPATIBLE" && w.code !== "DG_CHECK") continue;
    for (const id of w.item_ids) {
      const c = out.get(id) ?? { with: [], messages: [], severity: w.code === "DG_INCOMPATIBLE" ? "error" : "warning" };
      c.with.push(...w.item_ids.filter((other) => other !== id && !c.with.includes(other)));
      c.messages.push(w.message);
      out.set(id, c);
    }
  }
  return out;
}

// ---- The hazard picker's value (HazardPicker.jsx) ----------------------------------------------
// The picker (copied from the demo) edits only a line's class and subsidiary hazards, as
// { dgClass, subsidiary }: dgClass is a DG class ("3", "5.1", ...), "food", "fire_risk", or null for
// general freight. hazardOf / dgFromHazard convert between that and the line's DgInfo.

export interface Hazard {
  dgClass: string | null;
  subsidiary: string[];
}

export const MAX_SUBSIDIARY = 4;

/** True for a real DG class (not general freight, food or fire-risk): only these take subsidiary hazards. */
export const isDgClass = (dgClass: string | null | undefined): boolean =>
  Boolean(dgClass) && dgClass !== "food" && dgClass !== "fire_risk";

/**
 * A hazard made consistent the way the backend checks it: no subsidiary hazards without a class,
 * never the class itself, sorted, unique, at most 4.
 */
export function normaliseHazard(dgClass: string | null | undefined, subsidiary: readonly string[] = []): Hazard {
  const cls = dgClass || null;
  if (!isDgClass(cls)) return { dgClass: cls, subsidiary: [] };
  const known: readonly string[] = SUBSIDIARIES;
  const subs = [...new Set(subsidiary)]
    .filter((s) => s !== cls && known.includes(s))
    .sort((a, b) => known.indexOf(a) - known.indexOf(b))
    .slice(0, MAX_SUBSIDIARY);
  return { dgClass: cls, subsidiary: subs };
}

/** "Class 3 (sub 6.1)", "Food", "Fire-risk"; "" for general freight. Class 1 shows as 1.4S, the one the picker offers. */
export function hazardText(dgClass: string | null | undefined, subsidiary: readonly string[] | null = []): string {
  if (!dgClass) return "";
  if (dgClass === "food") return "Food";
  if (dgClass === "fire_risk") return "Fire-risk";
  const subs = subsidiary?.length ? ` (sub ${subsidiary.join(", ")})` : "";
  return `Class ${dgClass === "1" ? "1.4S" : dgClass}${subs}`;
}

/** The picker's value for a line's DG data. */
export function hazardOf(dg: DgInfo | null | undefined): Hazard {
  if (!dg || isGeneral(dg)) return { dgClass: null, subsidiary: [] };
  if (!dg.dg_class) return { dgClass: dg.food ? "food" : "fire_risk", subsidiary: [] };
  return normaliseHazard(dg.dg_class, dg.subsidiary ?? []);
}

/**
 * The line's DG data after the picker chose `hazard`. A line that already had a class keeps the
 * details the picker doesn't show (UN number, packing group, container, Table 9.2 and carrier tags),
 * except those the new class can't have, so validateRows never reports an error the form can't fix:
 * no packing group for 1, 2.x, 5.2 and 7, cylinders and aerosols for Class 2 only, fire-risk for
 * Class 6 and 9 only. A new DG line records "no Table 9.2 goods" (t92: []) as Random freight does,
 * and Class 1 is 1.4S unless the line already had an explosive code.
 */
export function dgFromHazard(hazard: Hazard, previous: DgInfo | null = null): DgInfo | null {
  const { dgClass, subsidiary } = normaliseHazard(hazard.dgClass, hazard.subsidiary);
  if (!dgClass) return null;
  if (!isDgClass(dgClass)) return normalise({ food: dgClass === "food", fire_risk: dgClass === "fire_risk" });
  const cls = dgClass as DgClass;
  const prev = previous?.dg_class ? previous : null;
  const container = prev?.container ?? "package";
  const explosive = prev?.explosive_code;
  return normalise({
    ...prev,
    dg_class: cls,
    subsidiary: subsidiary as Subsidiary[],
    packing_group: NO_PACKING_GROUP.has(cls) ? null : prev?.packing_group,
    container: (container === "cylinder" || container === "aerosol") && !cls.startsWith("2") ? "package" : container,
    explosive_code: cls !== "1" ? null : explosive && EXPLOSIVE_CODE_RE.test(explosive) ? explosive : "1.4S",
    t92: prev ? prev.t92 : [],
    fire_risk: !!prev?.fire_risk && (cls.startsWith("6") || cls === "9"),
  });
}
