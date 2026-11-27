// Split mode helpers: when a single-truck plan can be split across trucks, and how one truck of a
// split reads at a glance. Everything is read from the planner's responses, never recalculated.

import { checkAll } from "../../dg/rules.ts";
import { SUGGEST, type FleetResult, type FreightItem, type PlanRequest, type PlanResult, type WarningCode } from "../api/types.ts";

/** A plan that fails for one of these can fit once the freight is shared between trucks. */
export const SPLITTABLE_CODES: readonly WarningCode[] = ["OVER_CAPACITY", "OVER_PAYLOAD", "DG_INCOMPATIBLE", "AXLE_OVER_LIMIT"];

/** True when the plan doesn't fit and more trucks would help (too much freight, too heavy, DG that can't share). */
export function canSplit(result: PlanResult): boolean {
  return !result.fits
    && result.warnings.some((w) => w.severity === "error" && SPLITTABLE_CODES.includes(w.code));
}

/** Why this request can't be split (plain language), or null when it can. Mirrors POST /api/plan/fleet. */
export function splitBlocker(request: PlanRequest): string | null {
  if (request.vehicle_id === SUGGEST) return "To split this load across trucks, pick a vehicle in step 1 first.";
  if (request.items.some((i) => i.kind === "container")) {
    return "Splitting across trucks takes pallets and loose freight, not containers.";
  }
  return null;
}

/**
 * True when the split's freight has dangerous goods that can't share a vehicle. The single-truck plan
 * says so (a DG_INCOMPATIBLE error) when it is for the same freight; after edits in split mode, when
 * there is no single-truck plan for this freight, the lines are checked against the ADG tables (the
 * same early check as the hint in step 2).
 */
export function dgForcesSplit(fleetRequest: PlanRequest, single: PlanResult | null, singleRequest: PlanRequest | null): boolean {
  if (single && singleRequest && JSON.stringify(singleRequest.items) === JSON.stringify(fleetRequest.items)
      && singleRequest.rule_set === fleetRequest.rule_set) {
    return single.warnings.some((w) => w.code === "DG_INCOMPATIBLE" && w.severity === "error");
  }
  return checkAll(fleetRequest.items, (i) => i.dg ?? null).some((p) => p.status === "incompatible");
}

const truckCount = (n: number) => `${n} ${n === 1 ? "truck" : "trucks"}`;

/** "3 trucks · Proven fewest", or "3 trucks · Best found · at least 2". */
export function fleetHeadline(fleet: FleetResult): string {
  if (fleet.num_trucks === 0) return "No truck can take this freight";
  if (fleet.optimal) return `${truckCount(fleet.num_trucks)} · Proven fewest`;
  return `${truckCount(fleet.num_trucks)} · Best found · at least ${fleet.lower_bound}`;
}

/** Ids that tie truck tab `i` to its panel. */
export const truckTabId = (idBase: string, i: number) => `${idBase}-tab-${i}`;
export const truckPanelId = (idBase: string, i: number) => `${idBase}-panel-${i}`;

export type TruckStatus = "ok" | "near" | "over";

export const TRUCK_STATUS_TEXT: Record<TruckStatus, string> = {
  ok: "fits",
  near: "near a limit",
  over: "over a limit",
};

/** One truck of a split: over when it doesn't fit, near when an axle group is close to its limit. */
export function truckStatus(truck: PlanResult): TruckStatus {
  if (!truck.fits || truck.axle_loads.some((a) => a.status === "over")) return "over";
  if (truck.axle_loads.some((a) => a.status === "near")) return "near";
  return "ok";
}

export interface UnitGroup {
  itemId: string;
  label: string;
  unitIds: string[];
}

/** Unit ids ("<item_id>#<n>") grouped by freight line, named by the line's label. */
export function groupUnits(unitIds: readonly string[], items: readonly FreightItem[]): UnitGroup[] {
  const groups = new Map<string, UnitGroup>();
  for (const unitId of unitIds) {
    const itemId = unitId.includes("#") ? unitId.slice(0, unitId.lastIndexOf("#")) : unitId;
    let g = groups.get(itemId);
    if (!g) {
      g = { itemId, label: items.find((i) => i.id === itemId)?.label?.trim() || itemId, unitIds: [] };
      groups.set(itemId, g);
    }
    g.unitIds.push(unitId);
  }
  return [...groups.values()];
}
