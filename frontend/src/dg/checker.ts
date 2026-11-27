// The checker page's verdict (CheckerApp.tsx): two loads, each a Table 9.1 column plus subsidiary
// hazards, checked with the shared rules engine (pairVerdict). Pure functions, no React.
import { lookup, pairVerdict, tableCode, type Col, type DgInfo, type Subsidiary } from "./rules";

export interface Load { p: Col; subs: Subsidiary[] }
export type Kind = "ok" | "bad" | "check" | "ex";
export interface Flags { big500: boolean; cyl500: boolean; fireRisk: boolean }

// Table 9.2 entries to look at when a class pair's cell says "see exception 6".
export const T92_BY_PAIR: Record<string, string[]> = {
  "5.1|5.1": [
    "Ammonium nitrate with tetranitromethane.",
    "Dichloroisocyanuric or trichloroisocyanuric acid with any bromate, chlorate, chlorite, hypochlorite, chloroisocyanurate or inorganic nitrite.",
    "Calcium hypochlorite with ammonium nitrate, dichloroisocyanuric acid, trichloroisocyanuric acid or any chloroisocyanurate.",
  ],
  "3|6": ["Class 6 goods with nitromethane (Class 3)."],
  "8|8": ["Concentrated strong acids with concentrated strong alkalis."],
  "6|8": ["Cyanide compounds (Class 6.1) with acids (Class 8)."],
};

export const isGoods = (c: Col) => c === "F" || c === "R";

/** "0", "N", "(1)" -> kind; "0(n)" is compatible unless exception n applies. */
export function cellKind(k: string): "ok" | "bad" | "cond" | "ex" {
  if (k === "(1)") return "ex";
  if (k.startsWith("N")) return "bad";
  return k.includes("(") ? "cond" : "ok";
}

export interface Hz { c: Col; role: "primary" | "subsidiary" | "" }
const hazardsOf = (l: Load): Hz[] =>
  isGoods(l.p) ? [{ c: l.p, role: "" }] : [{ c: l.p, role: "primary" }, ...l.subs.map((s): Hz => ({ c: tableCode(s), role: "subsidiary" }))];
const hasOxSub = (l: Load) => l.p === "2.2" && l.subs.includes("5.1");

/** Each hazard pair of A x B with its Table 9.1 code, as the checker lists them. */
function hazardPairs(a: Load, b: Load) {
  // 2.1 / 2.3 against the 5.1 subsidiary of a 2.2 gas: exception 3/4 on the primary cell decides.
  const gov34 = (x: Hz, y: Hz, yLoad: Load) =>
    x.role === "primary" && (x.c === "2.1" || x.c === "2.3") && yLoad.p === "2.2" && y.role === "subsidiary" && y.c === "5.1";
  const out: { x: Hz; y: Hz; k: string; exc: number | null }[] = [];
  for (const x of hazardsOf(a)) for (const y of hazardsOf(b)) {
    if (gov34(x, y, b) || gov34(y, x, a)) continue;
    const k = lookup(x.c, y.c);
    const m = k.match(/\((\d)\)/);
    out.push({ x, y, k, exc: m ? Number(m[1]) : null });
  }
  return out;
}

/** The DgInfo the engine sees for a load, with the exception questions folded in. */
function toDg(l: Load, other: Load, f: Flags, asks: Set<number>): Partial<DgInfo> {
  if (l.p === "F") return { food: true };
  if (l.p === "R") return { fire_risk: true };
  const tank = (asks.has(2) && f.big500) || ((asks.has(3) || asks.has(4)) && !f.cyl500);
  return {
    dg_class: l.p === "6" ? "6.1" : (l.p as DgInfo["dg_class"]),
    subsidiary: l.subs,
    container: tank ? "tank_over_500l" : "package",
    t92: null, // specific goods not known: Table 9.2 pairs come out as "check"
    fire_risk: asks.has(5) && f.fireRisk && (l.p === "6" || l.p === "9") && (other.p === "5.1" || other.p === "5.2"),
  };
}

/** Which exception questions this pair needs answered (2, 3/4, 5). */
function questionsFor(a: Load, b: Load): Set<number> {
  const asks = new Set<number>();
  for (const { exc } of hazardPairs(a, b)) {
    if (exc === 2 || exc === 5) asks.add(exc);
    if ((exc === 3 || exc === 4) && (hasOxSub(a) || hasOxSub(b))) asks.add(exc);
  }
  return asks;
}

export function evaluate(a: Load, b: Load, f: Flags) {
  const asks = questionsFor(a, b);
  const v = pairVerdict(toDg(a, b, f, asks), toDg(b, a, f, asks));
  let overall: Kind = v.exceptions.includes(1) ? "ex" : v.status === "incompatible" ? "bad" : v.status === "check" ? "check" : "ok";
  const pairs = hazardPairs(a, b).map((p) => {
    const kd = cellKind(p.k);
    let out: Kind = kd === "cond" ? "ok" : kd;
    if (kd === "cond") {
      if (p.exc === 2 && f.big500) out = "bad";
      else if ((p.exc === 3 || p.exc === 4) && (hasOxSub(a) || hasOxSub(b)) && !f.cyl500) out = "bad";
      else if (p.exc === 5 && f.fireRisk) out = "bad";
      else if (p.exc === 6) out = "check";
    }
    return { ...p, out };
  });
  // The engine treats two loads with identical DG data as one product (always fine together). Here
  // they are two goods of the same class, so the class pair decides, e.g. 5.1 with 5.1 -> Table 9.2.
  const same = a.p === b.p && [...a.subs].sort().join() === [...b.subs].sort().join();
  if (same && overall === "ok") {
    const rank: Kind[] = ["ok", "check", "bad", "ex"];
    overall = pairs.reduce<Kind>((w, p) => (rank.indexOf(p.out) > rank.indexOf(w) ? p.out : w), "ok");
  }
  return { overall, verdict: v, asks, pairs };
}
