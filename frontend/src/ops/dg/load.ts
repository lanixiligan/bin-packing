// State of one load in the /ops/dg checker, and its conversion to DgInfo so
// the checker uses the shared rules engine (src/dg/rules.ts).
import {
  CLASS_NAMES, NO_PACKING_GROUP, tableCode,
  type CarrierTag, type Col, type Container, type DgClass, type DgLike, type Subsidiary, type T92Tag,
} from "../../dg/rules";

/** A DG class, or "F" (food) / "R" (fire-risk goods, not DG): Load B only. */
export type Primary = DgClass | "F" | "R";
export type PackingGroup = "" | "I" | "II" | "III";

export interface LoadState {
  primary: Primary;
  subs: Subsidiary[];
  /** Class 1 only: division (1.1–1.6) and compatibility group, e.g. "1.4S". */
  explosive: string;
  container: Container;
  /** Class 6 and 9 only: a fire-risk substance (exception 5). */
  fireRisk: boolean;
  /** Table 9.2 specific goods: null = not checked yet, [] = none of them. */
  t92: T92Tag[] | null;
  un: string;
  pg: PackingGroup;
  tags: CarrierTag[];
}

export const DEFAULT_EXPLOSIVE = "1.4S";

export function newLoad(primary: Primary): LoadState {
  return {
    primary, subs: [], explosive: DEFAULT_EXPLOSIVE, container: primary.startsWith("2") ? "cylinder" : "package",
    fireRisk: false, t92: null, un: "", pg: "", tags: [],
  };
}

export const isGoods = (p: Primary): p is DgClass => p !== "F" && p !== "R";
export const isGas = (p: Primary) => p.startsWith("2");
export const canFireRisk = (p: Primary) => p === "6.1" || p === "6.2" || p === "9";
export const hasPackingGroup = (p: Primary) => isGoods(p) && !NO_PACKING_GROUP.has(p);
export const hasSubsidiaries = (p: Primary) => isGoods(p) && p !== "1";

/** Northline's carrier tags that matter for a class. */
export function carrierTagsFor(p: Primary): CarrierTag[] {
  switch (p) {
    case "2.1": return ["unodourised_lpg"];
    case "3": return ["fuel"];
    case "5.1": return ["peroxide_over_60"];
    case "9": return ["env_hazardous", "lithium_battery"];
    default: return [];
  }
}

/** Containers that make sense for a class (cylinders and aerosols are for gases). */
export function containerAllowed(p: Primary, c: Container): boolean {
  return isGas(p) || (c !== "cylinder" && c !== "aerosol");
}

/** Change the primary class, keeping the options that still apply. */
export function withPrimary(load: LoadState, primary: Primary): LoadState {
  if (primary === load.primary) return load;
  return {
    ...load,
    primary,
    subs: hasSubsidiaries(primary) ? load.subs.filter((s) => s !== primary) : [],
    container: containerAllowed(primary, load.container) ? load.container : "package",
    fireRisk: canFireRisk(primary) && load.fireRisk,
    t92: null, // specific goods belong to the old class
    pg: hasPackingGroup(primary) ? load.pg : "",
    tags: load.tags.filter((t) => carrierTagsFor(primary).includes(t)),
  };
}

/** The load as DG data for the rules engine. */
export function toDg(load: LoadState): DgLike {
  const p = load.primary;
  if (p === "F") return { food: true };
  if (p === "R") return { fire_risk: true };
  return {
    dg_class: p,
    subsidiary: hasSubsidiaries(p) ? load.subs.filter((s) => s !== p) : [],
    explosive_code: p === "1" ? load.explosive : null,
    container: containerAllowed(p, load.container) ? load.container : "package",
    fire_risk: canFireRisk(p) && load.fireRisk,
    t92: load.t92,
    un_number: load.un.trim() || null,
    packing_group: hasPackingGroup(p) && load.pg ? load.pg : null,
    carrier_tags: load.tags.filter((t) => carrierTagsFor(p).includes(t)),
  };
}

/** "Class 3", "Class 1.4S", "Food", "Fire-risk goods". */
export function primaryText(load: LoadState): string {
  if (load.primary === "F") return "Food";
  if (load.primary === "R") return "Fire-risk goods";
  return `Class ${load.primary === "1" ? load.explosive : load.primary}`;
}

export function primaryName(p: Primary): string {
  if (p === "F") return "Food or food packaging";
  if (p === "R") return "Fire-risk or combustible liquid";
  return CLASS_NAMES[p];
}

/** Table 9.1 code (row/column) of a primary. */
export const colOf = (p: Primary): Col => (isGoods(p) ? tableCode(p) : p);

/** The primary to load for a Table 9.1 row or column (6 = 6.1, the common one). */
export const primaryOfCol = (c: Col): Primary => (c === "6" ? "6.1" : c);
