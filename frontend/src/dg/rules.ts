// Dangerous goods rules: ADG Code Table 9.1 / 9.2 segregation and Northline
// (GDE-56) acceptance. A port of backend/app/dg.py: keep the two in step.
// backend/tests/data/dg_cases.json is checked by both test suites.
//
// Source: ADG Code Table 9.1 and Table 9.2 as published in Edition 7.8
// (Edition 7.9 is mandatory from 1 October 2025: verify the matrix against the
// edition that applies). Pure functions, no React, so node --test can run them.
import type { components } from "../api/schema";

export type DgInfo = components["schemas"]["DgInfo"];
/** DG data as it may arrive: missing fields take the backend defaults. */
export type DgLike = Partial<DgInfo> | null | undefined;
export type DgClass = NonNullable<DgInfo["dg_class"]>;
export type Subsidiary = NonNullable<DgInfo["subsidiary"]>[number];
export type T92Tag = NonNullable<DgInfo["t92"]>[number];
export type CarrierTag = NonNullable<DgInfo["carrier_tags"]>[number];
export type Container = DgInfo["container"];
export type RuleSet = "adg" | "northline";
export type PairStatus = "ok" | "incompatible" | "check";

export const DG_CLASSES: DgClass[] = ["1", "2.1", "2.2", "2.3", "3", "4.1", "4.2", "4.3", "5.1", "5.2", "6.1", "6.2", "7", "8", "9"];
export const SUBSIDIARIES: Subsidiary[] = ["2.1", "2.3", "3", "4.1", "4.2", "4.3", "5.1", "6.1", "8"];
export const CLASS_NAMES: Record<DgClass, string> = {
  "1": "Explosives", "2.1": "Flammable gas", "2.2": "Non-flammable, non-toxic gas", "2.3": "Toxic gas",
  "3": "Flammable liquid", "4.1": "Flammable solid", "4.2": "Spontaneously combustible", "4.3": "Dangerous when wet",
  "5.1": "Oxidising substance", "5.2": "Organic peroxide", "6.1": "Toxic substance", "6.2": "Infectious substance",
  "7": "Radioactive", "8": "Corrosive", "9": "Miscellaneous DG",
};
export const NO_PACKING_GROUP = new Set<string>(["1", "2.1", "2.2", "2.3", "5.2", "7"]);
export const EXPLOSIVE_CODE_RE = /^1\.[1-6][A-HJ-LNS]$/;
export const CONTAINERS: { value: Container; label: string }[] = [
  { value: "package", label: "Packages, pails or boxes" },
  { value: "drum", label: "Drums" },
  { value: "ibc", label: "IBC" },
  { value: "cylinder", label: "Gas cylinders (500 L or less)" },
  { value: "aerosol", label: "Aerosols" },
  { value: "tank_over_500l", label: "Tank or receptacle over 500 L" },
];
export const T92_TAGS: { value: T92Tag; label: string }[] = [
  { value: "ammonium_nitrate", label: "Ammonium nitrate" },
  { value: "tetranitromethane", label: "Tetranitromethane" },
  { value: "chloroisocyanuric_acid", label: "Dichloro- or trichloroisocyanuric acid" },
  { value: "chloroisocyanurate", label: "A chloroisocyanurate" },
  { value: "bromate_chlorate_chlorite", label: "A bromate, chlorate or chlorite" },
  { value: "hypochlorite", label: "A hypochlorite" },
  { value: "inorganic_nitrite", label: "An inorganic nitrite" },
  { value: "calcium_hypochlorite", label: "Calcium hypochlorite (and mixtures)" },
  { value: "nitromethane", label: "Nitromethane" },
  { value: "acid_strong", label: "Concentrated strong acid" },
  { value: "acid_other", label: "Other acid" },
  { value: "alkali_strong", label: "Concentrated strong alkali" },
  { value: "cyanide", label: "Cyanide compound" },
];
export const CARRIER_TAGS: { value: CarrierTag; label: string }[] = [
  { value: "fuel", label: "Fuel (petrol, race fuel, Avgas)" },
  { value: "unodourised_lpg", label: "Unodourised propane, butane or LPG" },
  { value: "peroxide_over_60", label: "Peroxide concentration over 60%" },
  { value: "env_hazardous", label: "Environmentally hazardous substance" },
  { value: "lithium_battery", label: "Lithium batteries" },
];

// ---------------------------------------------------------------------------
// Table 9.1
// ---------------------------------------------------------------------------

/** Table columns: DG classes (6.1 and 6.2 are "6"), F = food, R = fire-risk goods. */
export const COLS = ["1", "2.1", "2.2", "2.3", "3", "4.1", "4.2", "4.3", "5.1", "5.2", "6", "7", "8", "9", "F", "R"] as const;
export type Col = (typeof COLS)[number];
export const ROWS = COLS.slice(0, 14) as Col[];
export const MATRIX: Record<string, string[]> = {
  "1": Array(16).fill("(1)"),
  "2.1": ["(1)", "0", "0(3)", "0", "0(2)", "N", "N", "N", "N", "N", "0", "N", "0", "0", "0", "0"],
  "2.2": ["(1)", "0(3)", "0", "0(4)", "0", "0", "N", "0", "0", "N", "0", "0", "0", "0", "0", "0"],
  "2.3": ["(1)", "0", "0(4)", "0", "N", "0", "N", "0", "N", "N", "0", "0", "0", "0", "N(8)", "0"],
  "3": ["(1)", "0(2)", "0", "N", "0", "0", "N", "0", "N", "N", "0(6)", "N", "0", "0", "0", "0"],
  "4.1": ["(1)", "N", "0", "0", "0", "0", "N", "0", "N", "N", "0", "N", "0", "0", "0", "0"],
  "4.2": ["(1)", "N", "N", "N", "N", "N", "0", "0", "N", "N", "0", "N", "0", "0", "0", "0"],
  "4.3": ["(1)", "N", "0", "0", "0", "0", "0", "0", "N", "N", "0", "N", "N", "0", "0", "0"],
  "5.1": ["(1)", "N", "0", "N", "N", "N", "N", "N", "0(6)", "N", "0(5)", "N", "N", "0(5)", "0", "N"],
  "5.2": ["(1)", "N", "N", "N", "N", "N", "N", "N", "N", "0", "0(5)", "N", "N", "0(5)", "0", "N"],
  "6": ["(1)", "0", "0", "0", "0(6)", "0", "0", "0", "0(5)", "0(5)", "0", "0", "0(6)", "0", "N(8)", "0"],
  "7": ["(1)", "N", "0", "0", "N", "N", "N", "N", "N", "N", "0", "0", "N", "0", "N(8)", "0"],
  "8": ["(1)", "0", "0", "0", "0", "0", "0", "N", "N", "N", "0(6)", "N", "0(6)", "0", "N(8)", "0"],
  "9": ["(1)", "0", "0", "0", "0", "0", "0", "0", "0(5)", "0(5)", "0", "0", "0", "0", "0", "0"],
};

export const EXCEPTIONS: Record<number, string> = {
  1: "Explosives are incompatible with all other dangerous goods in all quantities. Exceptions: the Australian Explosives Code, and Division 1.4S where 9.1.2.2.2 applies.",
  2: "Division 2.1 and Class 3 are incompatible if both are in tanks or other receptacles with an individual capacity of more than 500 L.",
  3: "Division 2.1 is incompatible with Division 2.2 gases that have subsidiary hazard 5.1. Exception: all gases are in cylinders or pressure drums of 500 L capacity or less.",
  4: "Division 2.3 is incompatible with Division 2.2 gases that have subsidiary hazard 5.1. Exception: all gases are in cylinders or pressure drums of 500 L capacity or less.",
  5: "Class 5 is incompatible with Class 6 or Class 9 goods that are fire-risk substances. Look for the GHS flame pictogram or check section 2 of the SDS.",
  6: "Some specific goods in these classes are incompatible. See Table 9.2.",
  7: "For Class 7 with undeveloped photographic film, personnel and mail, see the Code of Practice for the Safe Transport of Radioactive Substances.",
  8: "Food and food packagings are incompatible with these classes in all quantities. Exception (9.1.2.3): Class 8 food ingredients for the manufacture of food.",
};

const OXIDISER_SALTS: T92Tag[] = ["bromate_chlorate_chlorite", "hypochlorite", "calcium_hypochlorite", "chloroisocyanurate", "inorganic_nitrite"];
export const T92_RULES: { left: T92Tag[]; right: T92Tag[]; text: string }[] = [
  { left: ["ammonium_nitrate"], right: ["tetranitromethane"], text: "Ammonium nitrate with tetranitromethane" },
  {
    left: ["chloroisocyanuric_acid"], right: OXIDISER_SALTS,
    text: "Dichloro- or trichloroisocyanuric acid with a bromate, chlorate, chlorite, hypochlorite, chloroisocyanurate or inorganic nitrite",
  },
  {
    left: ["calcium_hypochlorite"], right: ["ammonium_nitrate", "chloroisocyanuric_acid", "chloroisocyanurate"],
    text: "Calcium hypochlorite with ammonium nitrate, chloroisocyanuric acid or a chloroisocyanurate",
  },
  { left: ["acid_strong"], right: ["alkali_strong"], text: "Concentrated strong acids with concentrated strong alkalis" },
  { left: ["cyanide"], right: ["acid_strong", "acid_other"], text: "Cyanide compounds (Class 6.1) with acids (Class 8)" },
];
export const NITROMETHANE_RULE = "Class 6 goods with nitromethane (Class 3)";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Fill in the backend defaults and sort lists, so equal data compares equal. */
export function normalise(dg: DgLike): DgInfo | null {
  if (!dg) return null;
  const sorted = <T extends string>(xs: T[] | null | undefined) => [...new Set(xs ?? [])].sort();
  const cls = dg.dg_class ?? null;
  return {
    dg_class: cls,
    subsidiary: sorted(dg.subsidiary),
    packing_group: dg.packing_group ?? null,
    un_number: dg.un_number ?? null,
    explosive_code: dg.explosive_code ?? null,
    container: cls ? dg.container ?? "package" : "package",
    t92: cls && dg.t92 != null ? sorted(dg.t92) : null,
    carrier_tags: sorted(dg.carrier_tags),
    food: !!dg.food,
    fire_risk: !!dg.fire_risk,
  };
}

/** Stable identity of a DG profile ("" = general freight). */
export function dgKey(dg: DgLike): string {
  const n = normalise(dg);
  return n && !isGeneral(n) ? JSON.stringify(n) : "";
}

/** General freight: not DG, not food, not fire-risk. */
export function isGeneral(dg: DgLike): boolean {
  return !dg || (!dg.dg_class && !dg.food && !dg.fire_risk);
}

/** "Class 3", "Class 5.1 (sub 8)", "Class 1.4S", "Food", "Fire-risk", "General". */
export function dgLabel(dg: DgLike): string {
  if (!dg || !dg.dg_class) return dg?.food ? "Food" : dg?.fire_risk ? "Fire-risk" : "General";
  const code = dg.dg_class === "1" && dg.explosive_code ? dg.explosive_code : dg.dg_class;
  const subs = [...(dg.subsidiary ?? [])].sort();
  return `Class ${code}${subs.length ? ` (sub ${subs.join(", ")})` : ""}`;
}

export function tableCode(cls: string): Col {
  return (cls.startsWith("6") ? "6" : cls) as Col;
}

function codes(dg: DgInfo): Col[] {
  return [...(dg.dg_class ? [dg.dg_class] : []), ...(dg.subsidiary ?? [])].map(tableCode);
}

interface Hazard { code: Col; role: "primary" | "subsidiary" | "" }

function hazards(dg: DgInfo | null): Hazard[] {
  if (!dg) return [];
  if (!dg.dg_class) return dg.food ? [{ code: "F", role: "" }] : dg.fire_risk ? [{ code: "R", role: "" }] : [];
  return [
    { code: tableCode(dg.dg_class), role: "primary" },
    ...(dg.subsidiary ?? []).map((s): Hazard => ({ code: tableCode(s), role: "subsidiary" })),
  ];
}

/** Table 9.1 code for two hazard codes (at least one a DG class). */
export function lookup(a: Col | string, b: Col | string): string {
  if (MATRIX[a]) return MATRIX[a][COLS.indexOf(b as Col)];
  return MATRIX[b][COLS.indexOf(a as Col)];
}

function hazardText(h: Hazard): string {
  if (h.code === "F") return "food";
  if (h.code === "R") return "fire-risk goods";
  return `Class ${h.code}${h.role === "subsidiary" ? " (subsidiary)" : ""}`;
}

// ---------------------------------------------------------------------------
// Segregation
// ---------------------------------------------------------------------------

export interface PairVerdict {
  status: PairStatus;
  reasons: string[];
  exceptions: number[];
  t92: string[];
}

const RANK: Record<PairStatus, number> = { ok: 0, check: 1, incompatible: 2 };

function t92Conflicts(a: DgInfo, b: DgInfo): string[] {
  const ta = new Set(a.t92 ?? []), tb = new Set(b.t92 ?? []);
  const hit = (s: Set<string>, xs: string[]) => xs.some((x) => s.has(x));
  const out = T92_RULES.filter((r) => (hit(ta, r.left) && hit(tb, r.right)) || (hit(tb, r.left) && hit(ta, r.right))).map((r) => r.text);
  if ((ta.has("nitromethane") && codes(b).includes("6")) || (tb.has("nitromethane") && codes(a).includes("6"))) out.push(NITROMETHANE_RULE);
  return out;
}

/** Can goods with DG data `a` and `b` travel on the same vehicle (ADG Table 9.1 / 9.2)? */
export function pairVerdict(aIn: DgLike, bIn: DgLike): PairVerdict {
  const v: PairVerdict = { status: "ok", reasons: [], exceptions: [], t92: [] };
  const raise = (s: PairStatus) => { if (RANK[s] > RANK[v.status]) v.status = s; };
  const a = normalise(aIn), b = normalise(bIn);
  if (a && b && JSON.stringify(a) === JSON.stringify(b)) return v; // the same product
  const ha = hazards(a), hb = hazards(b);
  if (!ha.length || !hb.length || !a || !b) return v; // general freight goes with anything

  // Exception 1: explosives.
  if (a.dg_class === "1" || b.dg_class === "1") {
    v.exceptions.push(1);
    if (a.dg_class === "1" && b.dg_class === "1") {
      const ea = a.explosive_code ?? "", eb = b.explosive_code ?? "";
      if (ea.slice(-1) === eb.slice(-1)) {
        raise("check");
        v.reasons.push(`Explosives ${ea} and ${eb}: check the Australian Explosives Code before loading them together.`);
      } else {
        raise("incompatible");
        v.reasons.push(`Explosives ${ea} and ${eb} have different compatibility groups (Australian Explosives Code).`);
      }
    } else {
      raise("incompatible");
      v.reasons.push("Explosives are incompatible with all other dangerous goods, food and fire-risk goods (exception 1).");
    }
    return v;
  }

  // Table 9.2 tag conflicts are decided regardless of the cell.
  const t92 = a.dg_class && b.dg_class ? t92Conflicts(a, b) : [];
  if (t92.length) {
    raise("incompatible");
    v.exceptions.push(6);
    v.t92 = t92;
    v.reasons.push(...t92.map((t) => `${t} (Table 9.2).`));
  }

  // 2.1/2.3 primary vs the 5.1 subsidiary of a 2.2 gas: exception 3/4 on the primary cell decides.
  const governs34 = (x: Hazard, y: Hazard, yDg: DgInfo) =>
    x.role === "primary" && (x.code === "2.1" || x.code === "2.3") && yDg.dg_class === "2.2" && y.role === "subsidiary" && y.code === "5.1";

  for (const x of ha) {
    for (const y of hb) {
      if ((x.code === "F" || x.code === "R") && (y.code === "F" || y.code === "R")) continue;
      if (governs34(x, y, b) || governs34(y, x, a)) continue;
      const k = lookup(x.code, y.code);
      const pair = `${hazardText(x)} with ${hazardText(y)}`;
      const m = k.match(/^(0|N)\((\d)\)$/);
      const exc = m ? Number(m[2]) : null;
      if (exc && !v.exceptions.includes(exc)) v.exceptions.push(exc);
      if (k.startsWith("N")) {
        raise("incompatible");
        v.reasons.push(`${pair}: incompatible (Table 9.1${exc === 8 ? ", exception 8" : ""}).`);
      } else if (exc === 2) {
        if (a.container === "tank_over_500l" && b.container === "tank_over_500l") {
          raise("incompatible");
          v.reasons.push(`${pair}: both in receptacles over 500 L (exception 2).`);
        }
      } else if (exc === 3 || exc === 4) {
        const gas = x.code === "2.2" && x.role === "primary" ? a : b;
        if ((gas.subsidiary ?? []).includes("5.1") && (a.container === "tank_over_500l" || b.container === "tank_over_500l")) {
          raise("incompatible");
          v.reasons.push(`${pair}: oxidising 2.2 gas and the other gas are not all in cylinders of 500 L or less (exception ${exc}).`);
        }
      } else if (exc === 5) {
        const other = x.code === "6" || x.code === "9" ? a : b;
        if (other.fire_risk) {
          raise("incompatible");
          v.reasons.push(`${pair}: the Class ${other.dg_class} goods are fire-risk substances (exception 5).`);
        }
      } else if (exc === 6 && !t92.length) {
        if (a.t92 == null || b.t92 == null) {
          raise("check");
          v.reasons.push(`${pair}: check Table 9.2 (specific goods not recorded on the item).`);
        }
      }
    }
  }
  if ((tableCode(a.dg_class ?? "") === "7" || tableCode(b.dg_class ?? "") === "7") && !v.exceptions.includes(7)) v.exceptions.push(7);
  v.exceptions.sort((p, q) => p - q);
  return v;
}

/** True if the goods must not travel on the same vehicle. */
export function dgConflicts(a: DgLike, b: DgLike): boolean {
  return pairVerdict(a, b).status === "incompatible";
}

export interface DgPairResult<T> { a: T; b: T; status: Exclude<PairStatus, "ok">; reasons: string[] }

/** Every pair of `items` that is incompatible or needs a Table 9.2 check. */
export function checkAll<T>(items: T[], dgOf: (item: T) => DgLike): DgPairResult<T>[] {
  const out: DgPairResult<T>[] = [];
  const cache = new Map<string, PairVerdict>();
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const da = dgOf(items[i]), db = dgOf(items[j]);
      if (isGeneral(da) || isGeneral(db)) continue;
      const key = `${dgKey(da)}|${dgKey(db)}`;
      let v = cache.get(key);
      if (!v) { v = pairVerdict(da, db); cache.set(key, v); }
      if (v.status !== "ok") out.push({ a: items[i], b: items[j], status: v.status, reasons: v.reasons });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Validation (mirrors DgInfo's validators; the server has the final say)
// ---------------------------------------------------------------------------

/** Problems with DG data, or [] if valid. */
export function validateDg(dg: DgLike): string[] {
  const d = normalise(dg);
  if (!d) return [];
  const out: string[] = [];
  const c = d.dg_class;
  if (!c) {
    if (d.food && d.fire_risk) out.push("An item can't be both food and fire-risk goods.");
    return out;
  }
  if (d.fire_risk && !"69".includes(c[0])) out.push("'Fire-risk' applies to Class 6 and 9 goods only (exception 5).");
  if ((d.subsidiary as string[]).includes(c)) out.push(`A subsidiary hazard can't be the same as the class (${c}).`);
  if (c === "1" && !EXPLOSIVE_CODE_RE.test(d.explosive_code ?? "")) out.push("Class 1 needs the division and compatibility group, e.g. 1.4S.");
  if (c in CLASS_NAMES && NO_PACKING_GROUP.has(c) && d.packing_group) out.push(`Class ${c} has no packing groups.`);
  if ((d.container === "cylinder" || d.container === "aerosol") && !c.startsWith("2")) out.push("Cylinders and aerosols are for Class 2 gases.");
  if (d.un_number && !/^\d{4}$/.test(d.un_number)) out.push("The UN number has 4 digits, e.g. 1263.");
  const tags = new Set<string>(d.t92 ?? []);
  for (const r of T92_RULES) {
    if (r.left.some((t) => tags.has(t)) && r.right.some((t) => tags.has(t))) out.push(`These Table 9.2 tags conflict with each other: ${r.text}.`);
  }
  if (tags.has("nitromethane") && codes(d).includes("6")) out.push("Nitromethane can't be Class 6 goods (Table 9.2).");
  return out;
}

// ---------------------------------------------------------------------------
// Northline acceptance (GDE-56)
// ---------------------------------------------------------------------------

export type IssueKind = "prohibited" | "limit" | "approval" | "note";
export interface Issue { kind: IssueKind; message: string }

/** [category, max kg per consignment] if Northline limits the quantity. */
export function northlineLimit(dg: DgLike): [string, number] | null {
  if (!dg?.dg_class) return null;
  if (dg.dg_class === "4.1") return ["Division 4.1", 50];
  if (dg.dg_class === "1" && dg.explosive_code) {
    if (dg.explosive_code === "1.3C") return ["Division 1.3C", 50];
    if (dg.explosive_code === "1.4G" || dg.explosive_code === "1.4C") return [`Division ${dg.explosive_code}`, 250];
  }
  return null;
}

/** Northline "Needs approval" goods. */
export function approvalRequired(dg: DgLike): boolean {
  const c = dg?.dg_class;
  if (!c) return false;
  if (c === "2.3" || c === "5.2" || c === "7") return true;
  if (c === "6.1") return ["drum", "ibc", "tank_over_500l"].includes(dg.container ?? "package") || !["II", "III"].includes(dg.packing_group ?? "");
  if (c === "9") return (dg.carrier_tags ?? []).includes("env_hazardous");
  return false;
}

/** Northline's rules for one item: prohibitions, approvals and notes (limits: northlineLimit). */
export function northlineIssues(dg: DgLike): Issue[] {
  const c = dg?.dg_class;
  if (!dg || !c) return [];
  const out: Issue[] = [];
  const bad = (message: string) => out.push({ kind: "prohibited", message });
  const tags = dg.carrier_tags ?? [];
  if (dg.packing_group === "I") bad("Northline does not transport Packing Group I goods.");
  if (c === "1") {
    const code = dg.explosive_code ?? "";
    const div = code.slice(0, 3), grp = code.slice(3);
    if (["1.1", "1.2", "1.5", "1.6"].includes(div)) bad(`Northline does not transport Division ${div}.`);
    else if (div === "1.3" && grp !== "C") bad(`Northline does not accept Division ${code}.`);
    else if (div === "1.4") {
      if (grp === "S") out.push({ kind: "note", message: "1.4S: for manufacturers or distributors only; transport outside the Northline network is not permitted." });
      else if (grp === "G") out.push({ kind: "note", message: "1.4G fireworks travel only within the Northern Territory." });
      else if (grp === "C") { if (dg.un_number !== "0509") bad("For Division 1.4C Northline transports UN 0509 only."); }
      else bad(`Northline does not accept Division ${code}.`);
    }
  } else if (c === "4.2" || c === "4.3" || c === "6.2") bad(`Northline does not transport Division ${c}.`);
  else if (c === "2.1" && tags.includes("unodourised_lpg")) bad("Northline does not accept unodourised propane, butane or LPG.");
  else if (c === "3" && tags.includes("fuel")) bad("Northline does not accept fuels (petrol, race fuel, Avgas).");
  else if (c === "5.1" && tags.includes("peroxide_over_60")) bad("Northline does not accept products with a peroxide concentration over 60%.");
  else if (c === "7" && dg.un_number !== "2910" && dg.un_number !== "2911") bad("For Class 7 Northline transports UN 2910 and UN 2911 only.");

  if (!out.some((i) => i.kind === "prohibited") && approvalRequired(dg)) {
    out.push({ kind: "approval", message: "Needs approval from the Northline National HSEQ Team (Safety@northline.com.au)." });
  }
  if (c.startsWith("2") && dg.container === "cylinder") out.push({ kind: "note", message: "Gas cylinders travel in a steel cage only, also when empty." });
  if (tags.includes("lithium_battery")) out.push({ kind: "note", message: "Batteries must meet Northline GDE-55 Transport of Lithium Batteries." });
  return out;
}

export function northlineProhibited(dg: DgLike): boolean {
  return northlineIssues(dg).some((i) => i.kind === "prohibited");
}
