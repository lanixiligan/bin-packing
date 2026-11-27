// /ops/dg — Can these dangerous goods travel together? A two-load checker on
// ADG Code Table 9.1 / 9.2 (and Northline's acceptance rules), with the tables
// for reference. The verdicts come from the shared rules engine (src/dg/rules.ts),
// the same one the backend mirrors, so the checker and the planner agree.
import { useId, useMemo, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router";
import { PageHeader } from "../../shell/AppShell";
import {
  CARRIER_TAGS, CLASS_NAMES, CONTAINERS, DG_CLASSES, EXCEPTIONS, SUBSIDIARIES, T92_TAGS,
  lookup, northlineIssues, northlineLimit, pairVerdict, tableCode, validateDg,
  type Col, type Container, type DgLike, type Issue, type PairVerdict, type RuleSet,
} from "../../dg/rules";
import { DgDiamond } from "../../dg/DgBadge";
import {
  canFireRisk, carrierTagsFor, colOf, containerAllowed, hasPackingGroup, hasSubsidiaries, isGas, isGoods,
  newLoad, primaryName, primaryOfCol, primaryText, toDg, withPrimary, DEFAULT_EXPLOSIVE,
  type LoadState, type PackingGroup, type Primary,
} from "../dg/load";
import { codeKind, codeWords, refTabOf, type RefTab } from "../dg/codes";
import MatrixTable, { Code } from "../dg/MatrixTable";
import ReferenceTabs from "../dg/ReferenceTabs";
import { SourcesNote } from "../dg/ReferenceSections";
import "../dg-checker.css";

type Side = "A" | "B";
const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

export default function DgCheckerPage() {
  const [params, setParams] = useSearchParams();
  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };
  const ruleSet: RuleSet = params.get("rules") === "northline" ? "northline" : "adg";
  const setRuleSet = (r: RuleSet) => setParam("rules", r === "northline" ? r : null);
  const refTab = refTabOf(params.get("ref"), ruleSet === "northline");
  const setRefTab = (t: RefTab) => setParam("ref", t === "exceptions" ? null : t);

  const [a, setA] = useState<LoadState>(() => newLoad("3"));
  const [b, setB] = useState<LoadState>(() => newLoad("5.1"));
  const checkerHeading = useRef<HTMLHeadingElement>(null);

  const verdict = useMemo(() => verdictFor(a, b), [a, b]);

  const pick = (row: Col, col: Col) => {
    setA(newLoad(primaryOfCol(row)));
    setB(newLoad(primaryOfCol(col)));
    const h = checkerHeading.current;
    h?.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "start" });
    h?.focus({ preventScroll: true });
  };

  return (
    <div className="dgc">
      <PageHeader
        title="Dangerous goods"
        subtitle="Can these dangerous goods travel together? Select two loads: the checker applies ADG Code Table 9.1 and Table 9.2 to primary and subsidiary hazards."
        actions={<RuleSetToggle value={ruleSet} onChange={setRuleSet} />}
      />

      <section className="dgc-checker" aria-labelledby="dgc-chk-h">
        <h2 id="dgc-chk-h" ref={checkerHeading} tabIndex={-1} className="dgc-h2">Check two loads</h2>
        <div className="dgc-loads">
          <LoadCard side="A" load={a} onChange={setA} ruleSet={ruleSet} showT92={verdict.v.exceptions.includes(6)} />
          <LoadCard side="B" load={b} onChange={setB} ruleSet={ruleSet} showT92={verdict.v.exceptions.includes(6)} other />
        </div>
        <VerdictBox a={a} b={b} setA={setA} setB={setB} result={verdict} ruleSet={ruleSet} />
      </section>

      <section className="card dgc-section" aria-labelledby="dgc-mx-h">
        <h2 id="dgc-mx-h">Table 9.1 matrix</h2>
        <p>Each cell shows the ADG code for the row class against the column class. Select a cell to load that pair into the checker.</p>
        <ul className="dgc-legend" aria-label="Legend">
          <li><span className="dgc-code k-ok">0</span> Compatible</li>
          <li><span className="dgc-code k-cond">0<sup>n</sup></span> Compatible, unless exception n applies</li>
          <li><span className="dgc-code k-bad">N</span> Incompatible</li>
          <li><span className="dgc-code k-bad">N<sup>8</sup></span> Incompatible with food</li>
          <li><span className="dgc-code k-ex">(1)</span> Explosives, see exception 1</li>
        </ul>
        <MatrixTable selRow={colOf(a.primary)} selCol={colOf(b.primary)} onPick={pick} />
        <p className="muted small">
          Goods are incompatible if any of these conditions occur: the primary hazard of one is incompatible with the primary
          hazard of the other; the primary hazard of one is incompatible with a subsidiary hazard of the other; or a subsidiary
          hazard of one is incompatible with a subsidiary hazard of the other.
        </p>
      </section>

      <ReferenceTabs value={refTab} onChange={setRefTab} northline={ruleSet === "northline"} />
      <SourcesNote />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Rule set
// ---------------------------------------------------------------------------

function RuleSetToggle({ value, onChange }: { value: RuleSet; onChange: (r: RuleSet) => void }) {
  const options: [RuleSet, string][] = [["adg", "ADG Code"], ["northline", "ADG + Northline"]];
  return (
    <fieldset className="dgc-seg">
      <legend>Rules</legend>
      <div className="dgc-seg-options">
        {options.map(([v, label]) => (
          <label key={v} className={value === v ? "on" : undefined}>
            <input type="radio" name="dgc-rules" value={v} checked={value === v} onChange={() => onChange(v)} />
            {label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

// ---------------------------------------------------------------------------
// One load
// ---------------------------------------------------------------------------

const SHORT: Partial<Record<Primary, string>> = {
  "2.2": "Non-flam. gas", "4.2": "Spont. combustible", "4.3": "Dangerous wet", "5.1": "Oxidiser",
  "6.1": "Toxic", "6.2": "Infectious", "9": "Misc. DG", F: "Food, food empties", R: "Combustible liquid",
};
const DIVISIONS = ["1.1", "1.2", "1.3", "1.4", "1.5", "1.6"];
const GROUPS = ["A", "B", "C", "D", "E", "F", "G", "H", "J", "K", "L", "N", "S"];

function LoadCard({ side, load, onChange, ruleSet, showT92, other = false }: {
  side: Side;
  load: LoadState;
  onChange: (l: LoadState) => void;
  ruleSet: RuleSet;
  showT92: boolean;
  /** Load B: food and fire-risk goods are choices too. */
  other?: boolean;
}) {
  const id = useId();
  const p = load.primary;
  const set = (patch: Partial<LoadState>) => onChange({ ...load, ...patch });
  const choices: Primary[] = other ? [...DG_CLASSES, "F", "R"] : DG_CLASSES;
  const problems = validateDg(toDg(load));
  const northline = ruleSet === "northline";

  return (
    <div className="card dgc-load" role="group" aria-labelledby={`${id}-h`}>
      <h3 id={`${id}-h`}>Load {side} <span className="dgc-load-name">{primaryText(load)} · {primaryName(p)}</span></h3>

      <div className="dgc-picker" role="group" aria-label={`Load ${side}: ${other ? "primary class or other goods" : "primary class"}`}>
        {choices.map((c) => (
          <button
            key={c}
            type="button"
            className="dgc-class"
            aria-pressed={c === p}
            onClick={() => onChange(withPrimary(load, c))}
          >
            <DgDiamond code={c} />
            <b>{c === "F" ? "Food" : c === "R" ? "Fire-risk" : c}</b>
            <small>{SHORT[c] ?? (isGoods(c) ? CLASS_NAMES[c] : "")}</small>
          </button>
        ))}
      </div>

      {p === "1" ? (
        <ExplosiveCode value={load.explosive} onChange={(explosive) => set({ explosive })} side={side} />
      ) : null}

      {hasSubsidiaries(p) ? (
        <div className="dgc-subs">
          <p id={`${id}-subs`}>Subsidiary hazards (optional). Select all that show on the label or SDS.</p>
          <div className="dgc-chips" role="group" aria-labelledby={`${id}-subs`}>
            {SUBSIDIARIES.filter((s) => s !== p).map((s) => {
              const on = load.subs.includes(s);
              return (
                <button
                  key={s}
                  type="button"
                  className="dgc-chip"
                  aria-pressed={on}
                  aria-label={`Subsidiary hazard ${s}, ${CLASS_NAMES[s]}`}
                  onClick={() => set({ subs: on ? load.subs.filter((x) => x !== s) : [...load.subs, s] })}
                >
                  <DgDiamond code={s} size="sm" />{s}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {isGoods(p) ? (
        <div className="dgc-fields">
          <label className="field">
            <span>Container</span>
            <select value={load.container} onChange={(e) => set({ container: e.target.value as Container })}>
              {CONTAINERS.filter((c) => containerAllowed(p, c.value)).map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </label>
          <label className="field">
            <span>UN number <span className="hint">optional</span></span>
            <input
              value={load.un}
              inputMode="numeric"
              maxLength={4}
              placeholder="e.g. 1263"
              aria-describedby={`${id}-un-hint`}
              onChange={(e) => set({ un: e.target.value.replace(/\D/g, "") })}
            />
            <span id={`${id}-un-hint`} className="hint">
              {northline ? "Northline checks it for 1.4C and Class 7. " : ""}Two loads with the same UN number and details are the same product.
            </span>
          </label>
          {northline && hasPackingGroup(p) ? (
            <label className="field">
              <span>Packing group</span>
              <select value={load.pg} onChange={(e) => set({ pg: e.target.value as PackingGroup })}>
                <option value="">Not known</option>
                <option value="I">PG I</option>
                <option value="II">PG II</option>
                <option value="III">PG III</option>
              </select>
            </label>
          ) : null}
          {canFireRisk(p) ? (
            <label className="dgc-check">
              <input type="checkbox" checked={load.fireRisk} onChange={(e) => set({ fireRisk: e.target.checked })} />
              <span>Fire-risk substance (GHS flame pictogram, or section 2 of the SDS): exception 5</span>
            </label>
          ) : null}
          {northline ? carrierTagsFor(p).map((t) => (
            <label key={t} className="dgc-check">
              <input
                type="checkbox"
                checked={load.tags.includes(t)}
                onChange={(e) => set({ tags: e.target.checked ? [...load.tags, t] : load.tags.filter((x) => x !== t) })}
              />
              <span>{CARRIER_TAGS.find((c) => c.value === t)?.label}</span>
            </label>
          )) : null}
        </div>
      ) : null}

      {isGoods(p) && (showT92 || (load.t92?.length ?? 0) > 0) ? <SpecificGoods load={load} side={side} onChange={set} /> : null}

      {problems.length ? (
        <ul className="dgc-problems" aria-label={`Problems with load ${side}`}>
          {problems.map((m) => <li key={m}>⚠️ {m}</li>)}
        </ul>
      ) : null}

      {northline ? <NorthlineVerdict dg={toDg(load)} /> : null}
    </div>
  );
}

function ExplosiveCode({ value, onChange, side }: { value: string; onChange: (v: string) => void; side: Side }) {
  const div = value.slice(0, 3) || "1.4";
  const grp = value.slice(3) || "S";
  return (
    <fieldset className="dgc-explosive">
      <legend>Division and compatibility group <span className="hint">({DEFAULT_EXPLOSIVE} = small arms ammunition)</span></legend>
      <div className="dgc-fields">
        <label className="field">
          <span>Division</span>
          <select aria-label={`Load ${side} explosive division`} value={div} onChange={(e) => onChange(e.target.value + grp)}>
            {DIVISIONS.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Group</span>
          <select aria-label={`Load ${side} compatibility group`} value={grp} onChange={(e) => onChange(div + e.target.value)}>
            {GROUPS.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
        </label>
      </div>
    </fieldset>
  );
}

/** Table 9.2: "not checked yet" (null) or the ticked specific goods ([] = none of them). */
function SpecificGoods({ load, side, onChange }: { load: LoadState; side: Side; onChange: (patch: Partial<LoadState>) => void }) {
  const id = useId();
  const checked = load.t92 != null;
  const tags = load.t92 ?? [];
  return (
    <fieldset className="dgc-t92-pick">
      <legend>Load {side}: specific goods (Table 9.2)</legend>
      <div className="dgc-radio-row">
        <label className="dgc-check">
          <input type="radio" name={`${id}-t92`} checked={!checked} onChange={() => onChange({ t92: null })} />
          <span>Not checked yet</span>
        </label>
        <label className="dgc-check">
          <input type="radio" name={`${id}-t92`} checked={checked} onChange={() => onChange({ t92: [] })} />
          <span>Checked against Table 9.2</span>
        </label>
      </div>
      {checked ? (
        <>
          <p className="hint">Tick the goods this load is or contains. Leave all unticked if none apply.</p>
          <div className="dgc-t92-tags">
            {T92_TAGS.map((t) => (
              <label key={t.value} className="dgc-check">
                <input
                  type="checkbox"
                  checked={tags.includes(t.value)}
                  onChange={(e) => onChange({ t92: e.target.checked ? [...tags, t.value] : tags.filter((x) => x !== t.value) })}
                />
                <span>{t.label}</span>
              </label>
            ))}
          </div>
        </>
      ) : (
        <p className="hint">Until it is checked, a class pair that Table 9.2 covers shows “Check specific goods”.</p>
      )}
    </fieldset>
  );
}

function NorthlineVerdict({ dg }: { dg: DgLike }) {
  if (!dg?.dg_class) {
    return (
      <div className="dgc-nl v-ok">
        <p className="dgc-nl-word">Northline: not dangerous goods</p>
        <p className="small">Northline's dangerous goods rules don't apply. Table 9.1 still applies against the other load.</p>
      </div>
    );
  }
  const issues: Issue[] = northlineIssues(dg);
  const limit = northlineLimit(dg);
  const prohibited = issues.some((i) => i.kind === "prohibited");
  const approval = issues.some((i) => i.kind === "approval");
  const [cls, word] = prohibited
    ? ["v-bad", "Northline: prohibited"]
    : approval ? ["v-check", "Northline: needs approval"] : ["v-ok", limit ? `Northline: accepted up to ${limit[1]} kg` : "Northline: accepted"];
  const items = [
    ...issues.filter((i) => i.kind !== "note").map((i) => i.message),
    ...(limit && !prohibited ? [`${limit[0]}: do not send more than ${limit[1]} kg per consignment.`] : []),
    ...issues.filter((i) => i.kind === "note").map((i) => `Note: ${i.message}`),
  ];
  return (
    <div className={`dgc-nl ${cls}`}>
      <p className="dgc-nl-word">{word}</p>
      {items.length ? <ul className="small">{items.map((m) => <li key={m}>{m}</li>)}</ul> : <p className="small">No extra Northline requirement for this class.</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Verdict
// ---------------------------------------------------------------------------

interface VerdictResult {
  v: PairVerdict;
  /** Both loads have the same UN number and details: the same product. */
  same: boolean;
}

/**
 * The verdict for two loads. The engine treats identical DG data as the same
 * product (always compatible); two loads in the checker are only the same
 * product when they also share a UN number.
 */
function verdictFor(a: LoadState, b: LoadState): VerdictResult {
  const da = toDg(a), db = toDg(b);
  const sameUn = !!da?.un_number && da.un_number === db?.un_number;
  const v = sameUn ? pairVerdict(da, db) : pairVerdict({ ...da, un_number: `A${da?.un_number ?? ""}` }, { ...db, un_number: `B${db?.un_number ?? ""}` });
  const same = sameUn && JSON.stringify(da) === JSON.stringify(db);
  return { v, same };
}

interface Hazard { code: Col; label: string; role: "primary" | "subsidiary" | "" }
function hazardsOf(load: LoadState): Hazard[] {
  const p = load.primary;
  if (!isGoods(p)) return [{ code: p, label: p === "F" ? "food" : "fire-risk goods", role: "" }];
  return [
    { code: tableCode(p), label: p === "1" ? load.explosive : p, role: "primary" },
    ...(hasSubsidiaries(p) ? load.subs.filter((s) => s !== p) : []).map((s): Hazard => ({ code: tableCode(s), label: s, role: "subsidiary" })),
  ];
}

/** The Table 9.1 cells behind the verdict (the 2.2 (5.1) gas rule of exceptions 3/4 decides on the primary cell). */
function cellsOf(a: LoadState, b: LoadState) {
  const ha = hazardsOf(a), hb = hazardsOf(b);
  const governs34 = (x: Hazard, y: Hazard, yLoad: LoadState) =>
    x.role === "primary" && (x.code === "2.1" || x.code === "2.3") && yLoad.primary === "2.2" && y.role === "subsidiary" && y.code === "5.1";
  const out: { x: Hazard; y: Hazard; k: string }[] = [];
  for (const x of ha) for (const y of hb) {
    if (governs34(x, y, b) || governs34(y, x, a)) continue;
    out.push({ x, y, k: lookup(x.code, y.code) });
  }
  return out;
}

const MESSAGES = {
  ok: "Table 9.1 permits these goods on the same vehicle. Check the SDS for each product before you load.",
  incompatible: "Do not load these goods in the same vehicle or freight container without segregation. Use a different vehicle in the combination or an approved segregation device.",
  check: "The classes are compatible, but some goods in these classes are incompatible. Tick the specific goods for each load (Table 9.2) to decide.",
  ex: "Explosives are incompatible with all other dangerous goods. Use the Australian Explosives Code. Division 1.4S has a limited exception (9.1.2.2.2).",
  exCheck: "Both loads are explosives in the same compatibility group. Check the Australian Explosives Code before you load them together.",
};

function VerdictBox({ a, b, setA, setB, result, ruleSet }: {
  a: LoadState; b: LoadState;
  setA: (l: LoadState) => void; setB: (l: LoadState) => void;
  result: VerdictResult; ruleSet: RuleSet;
}) {
  const { v, same } = result;
  const explosives = v.exceptions.includes(1);
  const [cls, word, message] =
    v.status === "ok" ? ["v-ok", "Compatible", same ? "Both loads are the same product (same UN number and details)." : MESSAGES.ok]
    : v.status === "check" ? (explosives ? ["v-check", "Check: explosives", MESSAGES.exCheck] : ["v-check", "Check specific goods", MESSAGES.check])
    : explosives ? ["v-ex", "Incompatible: explosives", MESSAGES.ex] : ["v-bad", "Incompatible", MESSAGES.incompatible];
  const cells = cellsOf(a, b);

  // Exception questions, mapped onto the loads' DgInfo fields.
  const TANK: Container = "tank_over_500l";
  const questions: ReactNode[] = [];
  if (v.exceptions.includes(2)) {
    const both = a.container === TANK && b.container === TANK;
    const untank = (l: LoadState): LoadState => (l.container === TANK ? { ...l, container: isGas(l.primary) ? "cylinder" : "package" } : l);
    questions.push(
      <Question key="2" checked={both} onChange={(on) => { setA(on ? { ...a, container: TANK } : untank(a)); setB(on ? { ...b, container: TANK } : untank(b)); }}>
        Both the Division 2.1 and Class 3 goods are in tanks or receptacles with an individual capacity of more than 500 L (exception 2).
      </Question>,
    );
  }
  const exc34 = v.exceptions.find((n) => n === 3 || n === 4);
  if (exc34) {
    const small = a.container !== TANK && b.container !== TANK;
    const oxGas = a.primary === "2.2" && a.subs.includes("5.1") ? "A" : "B";
    questions.push(
      <Question
        key="34"
        checked={small}
        onChange={(on) => {
          if (on) {
            if (a.container === TANK) setA({ ...a, container: "cylinder" });
            if (b.container === TANK) setB({ ...b, container: "cylinder" });
          } else if (oxGas === "A") setA({ ...a, container: TANK });
          else setB({ ...b, container: TANK });
        }}
      >
        All gases are in cylinders or pressure drums of 500 L capacity or less (exception {exc34}).
      </Question>,
    );
  }
  if (v.exceptions.includes(5)) {
    const targets = ([["A", a, setA], ["B", b, setB]] as const).filter(([, l]) => canFireRisk(l.primary));
    if (targets.length) {
      questions.push(
        <Question key="5" checked={targets.some(([, l]) => l.fireRisk)} onChange={(on) => targets.forEach(([, l, set]) => set({ ...l, fireRisk: on }))}>
          The Class 6 or Class 9 goods are fire-risk substances (exception 5).
        </Question>,
      );
    }
  }

  const refused = ruleSet === "northline"
    ? ([["A", a], ["B", b]] as const).filter(([, l]) => northlineIssues(toDg(l)).some((i) => i.kind === "prohibited"))
    : [];

  return (
    <section className={`dgc-verdict ${cls}`} aria-label="Verdict">
      <div className="dgc-band" aria-live="polite" aria-atomic="true">
        <p className="dgc-word">{word}</p>
        <p className="dgc-pair">
          <DgDiamond code={a.primary} size="sm" />Load A: {primaryText(a)}
          <span aria-hidden="true"> + </span><span className="sr-only"> with </span>
          <DgDiamond code={b.primary} size="sm" />Load B: {primaryText(b)}
        </p>
        <p className="dgc-msg">{message}</p>
      </div>
      <div className="dgc-vbody">
        {v.reasons.length ? (
          <ul className="dgc-reasons">{v.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
        ) : null}
        {refused.length ? (
          <p className="dgc-refused">
            Northline does not accept {refused.map(([s, l]) => `load ${s} (${primaryText(l)})`).join(" or ")}, whatever Table 9.1 says.
          </p>
        ) : null}

        <h3 className="dgc-h4">Table 9.1 cells</h3>
        <ul className="dgc-cells">
          {cells.map(({ x, y, k }) => (
            <li key={`${x.label}-${x.role}-${y.label}-${y.role}`}>
              <span className={`dgc-code k-${codeKind(k)}`} aria-hidden="true"><Code k={k} /></span>
              <span>
                A {x.label}{x.role === "subsidiary" ? " (subsidiary)" : ""} with B {y.role ? `${y.label}${y.role === "subsidiary" ? " (subsidiary)" : ""}` : y.label}
                <span className="sr-only">: {k}, {codeWords(k)}</span>
              </span>
            </li>
          ))}
        </ul>

        {questions.length ? <div className="dgc-questions">{questions}</div> : null}

        {v.exceptions.length ? (
          <div className="dgc-exnotes small">
            {v.exceptions.map((n) => <p key={n}><strong>Exception {n}.</strong> {EXCEPTIONS[n]}</p>)}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function Question({ checked, onChange, children }: { checked: boolean; onChange: (on: boolean) => void; children: ReactNode }) {
  return (
    <label className="dgc-q">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{children}</span>
    </label>
  );
}
