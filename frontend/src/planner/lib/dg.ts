// Dangerous goods helpers shared by the planner UI. The rules themselves live in the backend
// (app/dg.py, ADG Code Table 9.1 / 9.2), with a TypeScript port in src/dg/rules.ts; the plan's
// warnings (DG_INCOMPATIBLE, DG_CHECK, ...) are the authority on what conflicts.

import type { DgInfo, PlanRequest, PlanWarning } from "../api/types.ts";
import { CLASS_NAMES, dgLabel, isGeneral, type DgClass } from "../../dg/rules.ts";

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
