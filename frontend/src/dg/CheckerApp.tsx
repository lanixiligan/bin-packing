// Dangerous goods checker page (checker.html): "Can these dangerous goods travel together?"
// A React port of the ADG segregation checker page the CTO supplied. The layout and wording follow
// that page; the verdict comes from the shared rules engine (rules.ts, mirrored by backend/app/dg.py),
// so the checker and the load planner always agree.
import { useState } from "react";
import { DgDiamond } from "./DgBadge";
import { CLASS_NAMES, COLS, EXCEPTIONS, MATRIX, ROWS, SUBSIDIARIES, tableCode, type Col, type Subsidiary } from "./rules";
import { cellKind, evaluate, isGoods, T92_BY_PAIR, type Flags, type Hz, type Kind, type Load } from "./checker";
import "./checker.css";

const NAMES: Record<string, string> = {
  ...CLASS_NAMES, "6": "Toxic or infectious", "3": "Flammable liquids", "4.1": "Flammable solids",
  "5.1": "Oxidising substances", "5.2": "Organic peroxides", "F": "Food or food empties",
  "R": "Fire-risk or combustible liquid",
};
const SHORT: Record<string, string> = {
  "2.2": "Non-flam. gas", "4.2": "Spont. combustible", "4.3": "Dangerous wet", "F": "Food", "R": "Fire-risk / C1 C2",
};
const tileText = (c: Col) => (c === "F" ? "Food" : c === "R" ? "Fire-risk" : c);
const label = (c: Col) => (isGoods(c) ? NAMES[c] : `Class ${c}`);

function CodeText({ k }: { k: string }) {
  const m = k.match(/^(0|N)\((\d)\)$/);
  return m ? <>{m[1]}<sup>{m[2]}</sup></> : <>{k}</>;
}

const WORDS: Record<Kind, string> = { ok: "Compatible", bad: "Incompatible", check: "Check specific goods", ex: "Incompatible: explosives" };
const MSG: Record<Kind, string> = {
  ok: "Table 9.1 permits these goods on the same vehicle. Check the SDS for each product before you load.",
  bad: "Do not load these goods in the same vehicle or freight container without segregation. Use a different vehicle in the combination or an approved segregation device.",
  check: "The classes are compatible, but some goods in these classes are incompatible. Compare your goods with the Table 9.2 entries below.",
  ex: "Explosives are incompatible with all other dangerous goods. Use the Australian Explosives Code. Division 1.4S has a limited exception (9.1.2.2.2).",
};

export default function CheckerApp() {
  const [a, setA] = useState<Load>({ p: "3", subs: [] });
  const [b, setB] = useState<Load>({ p: "5.1", subs: [] });
  const [flags, setFlags] = useState<Flags>({ big500: false, cyl500: true, fireRisk: false });
  const pickPair = (r: Col, c: Col) => {
    setA({ p: r, subs: [] });
    setB({ p: c, subs: [] });
    document.getElementById("dgc-load-a")?.scrollIntoView?.({ block: "start" });
  };

  return (
    <div className="dgc">
      <header className="dgc-header">
        <a className="dgc-back" href="/">← Load planner</a>
        <h1>Can these dangerous goods travel together?</h1>
        <p className="dgc-lede">
          Select two loads. The checker applies ADG Code Table 9.1 and Table 9.2 to primary and subsidiary hazards,
          and shows the result.
        </p>
        <span className="dgc-edition">
          Road and rail transport in Australia. Based on Table 9.1 and Table 9.2 of the ADG Code (Part 9). Verify against
          your current edition before you use the result.
        </span>
      </header>

      <main>
        <section aria-label="Compatibility checker">
          <div className="dgc-loads">
            <LoadPicker id="dgc-load-a" side="A" load={a} onChange={setA} choices={ROWS} />
            <LoadPicker id="dgc-load-b" side="B" load={b} onChange={setB} choices={[...COLS]} />
          </div>
          <Verdict a={a} b={b} flags={flags} setFlags={setFlags} />
        </section>

        <section aria-labelledby="dgc-mx">
          <h2 id="dgc-mx">Table 9.1 matrix</h2>
          <p>Each cell shows the ADG code for the row class against the column class. Select a cell to load that pair into the checker.</p>
          <div className="dgc-legend">
            <span><span className="dgc-code k-ok">0</span> Compatible</span>
            <span><span className="dgc-code k-cond">0<sup>n</sup></span> Compatible, unless exception n applies</span>
            <span><span className="dgc-code k-bad">N</span> Incompatible</span>
            <span><span className="dgc-code k-bad">N<sup>8</sup></span> Incompatible with food</span>
            <span><span className="dgc-code k-ex">(1)</span> Explosives, see exception 1</span>
          </div>
          <Matrix a={a.p} b={b.p} onPick={pickPair} />
          <p className="dgc-note">
            Goods are incompatible if any of these conditions occur: the primary hazard of one is incompatible with the
            primary hazard of the other; the primary hazard of one is incompatible with a subsidiary hazard of the other; or
            a subsidiary hazard of one is incompatible with a subsidiary hazard of the other.
          </p>
        </section>

        <Reference />
        <Northline />
      </main>

      <footer className="dgc-footer">
        <p>
          Source: ADG Code Table 9.1 and Table 9.2, as published in Edition 7.8. Edition 7.9 is the current edition and is
          mandatory from 1 October 2025. The NTC is preparing a new Code. Check the matrix values against the edition that
          applies to you.
        </p>
        <p>
          This page is a reference aid. It does not replace the ADG Code, your State or Territory dangerous goods law, the
          SDS for each product, or advice from your competent authority.
        </p>
      </footer>
    </div>
  );
}

function LoadPicker({ id, side, load, onChange, choices }: {
  id: string; side: "A" | "B"; load: Load; onChange: (l: Load) => void; choices: Col[];
}) {
  const noSubs = load.p === "1" || isGoods(load.p);
  const toggle = (s: Subsidiary) =>
    onChange({ ...load, subs: load.subs.includes(s) ? load.subs.filter((x) => x !== s) : [...load.subs, s] });
  return (
    <div className="dgc-load" id={id}>
      <h2>Load {side} <span>{NAMES[load.p]}</span></h2>
      <div className="dgc-picker" role="group" aria-label={`Load ${side} primary class${side === "B" ? " or other goods" : ""}`}>
        {choices.map((c) => (
          <button key={c} type="button" className="dgc-tile" aria-pressed={load.p === c}
                  onClick={() => onChange({ p: c, subs: load.subs.filter((s) => tableCode(s) !== c) })}>
            <DgDiamond code={c} size="lg" />
            <b>{tileText(c)}</b>
            <small>{SHORT[c] ?? NAMES[c]}</small>
          </button>
        ))}
      </div>
      {!noSubs && (
        <div className="dgc-subs">
          <p>Subsidiary hazards (optional). Select all that show on the label or SDS.</p>
          <div className="dgc-chips" role="group" aria-label={`Load ${side} subsidiary hazards`}>
            {SUBSIDIARIES.filter((s) => tableCode(s) !== load.p).map((s) => (
              <button key={s} type="button" className="dgc-chip" aria-pressed={load.subs.includes(s)} onClick={() => toggle(s)}>
                <DgDiamond code={s} size="sm" />{tableCode(s)}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Verdict({ a, b, flags, setFlags }: { a: Load; b: Load; flags: Flags; setFlags: (f: Flags) => void }) {
  const { overall, asks, pairs } = evaluate(a, b, flags);
  const t92 = [...new Set(pairs.filter((p) => p.out === "check").flatMap((p) => T92_BY_PAIR[[p.x.c, p.y.c].sort().join("|")] ?? []))];
  const exs = [...new Set(pairs.map((p) => p.exc).filter((n): n is number => n != null))];
  if ((a.p === "7" || b.p === "7") && !exs.includes(7)) exs.push(7);
  exs.sort((p, q) => p - q);
  const role = (h: Hz) => (h.role ? ` (${h.role})` : "");
  const bText = (h: Hz) => (h.c === "F" ? "food" : h.c === "R" ? "fire-risk goods" : `${h.c}${role(h)}`);
  const resText: Record<Kind, string> = { ok: "compatible", check: "check Table 9.2", bad: "incompatible", ex: "incompatible" };
  const ex34 = asks.has(3) ? 3 : asks.has(4) ? 4 : null;

  return (
    <div className={`dgc-verdict v-${overall}`} aria-live="polite" data-testid="verdict">
      <div className="dgc-band">
        <span className="dgc-word">{WORDS[overall]}</span>
        <span className="dgc-pairline">
          <DgDiamond code={a.p} />{label(a.p)} <span aria-hidden="true">+</span> <DgDiamond code={b.p} />{label(b.p)}
        </span>
      </div>
      <div className="dgc-body">
        <p>{MSG[overall]}</p>
        <ul className="dgc-pairs">
          {pairs.map((p, i) => (
            <li key={i}>
              <span className={`dgc-code k-${p.out === "check" ? "cond" : p.out}`}><CodeText k={p.k} /></span>
              <span>A {p.x.c}{role(p.x)} with B {bText(p.y)}: {resText[p.out]}</span>
            </li>
          ))}
        </ul>
        {asks.has(2) && (
          <Question checked={flags.big500} onChange={(v) => setFlags({ ...flags, big500: v })}>
            Both the Division 2.1 and Class 3 goods are in tanks or receptacles with an individual capacity of more than
            500 L (exception 2).
          </Question>
        )}
        {ex34 && (
          <Question checked={flags.cyl500} onChange={(v) => setFlags({ ...flags, cyl500: v })}>
            All gases are in cylinders or pressure drums of 500 L capacity or less (exception {ex34}).
          </Question>
        )}
        {asks.has(5) && (
          <Question checked={flags.fireRisk} onChange={(v) => setFlags({ ...flags, fireRisk: v })}>
            The Class 6 or Class 9 goods are fire-risk substances (exception 5).
          </Question>
        )}
        {t92.length > 0 && (
          <div className="dgc-q dgc-q-list">
            <strong>Table 9.2 entries to check</strong>
            <ul className="dgc-steps">{t92.map((s) => <li key={s}>{s}</li>)}</ul>
          </div>
        )}
        {exs.length > 0 && (
          <p className="dgc-note dgc-exs">
            {exs.map((n) => <span key={n}><strong>Exception {n}.</strong> {EXCEPTIONS[n]}<br /></span>)}
          </p>
        )}
      </div>
    </div>
  );
}

function Question({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: React.ReactNode }) {
  return (
    <label className="dgc-q">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{children}</span>
    </label>
  );
}

function Matrix({ a, b, onPick }: { a: Col; b: Col; onPick: (r: Col, c: Col) => void }) {
  return (
    <div className="dgc-scroll">
      <table className="dgc-mx">
        <caption className="visually-hidden">ADG Code Table 9.1, incompatibility based on classification</caption>
        <thead>
          <tr>
            <th scope="col"><span className="visually-hidden">Class</span></th>
            {COLS.map((c) => (
              <th scope="col" key={c} className={c === "F" ? "sep" : undefined}>
                <span className="dgc-stack"><DgDiamond code={c} /><span>{tileText(c)}</span></span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ROWS.map((r) => (
            <tr key={r}>
              <th scope="row">
                <span className="dgc-rh"><DgDiamond code={r} /><b>{r}{r === "7" && <sup>7</sup>}</b><span>{NAMES[r]}</span></span>
              </th>
              {COLS.map((c, i) => {
                const k = MATRIX[r][i];
                const sel = (r === a && c === b) || (r === b && c === a);
                const hl = !sel && (r === a || c === b);
                return (
                  <td key={c} className={`c-${cellKind(k)}${c === "F" ? " sep" : ""}${sel ? " sel" : ""}${hl ? " hl" : ""}`}>
                    <button type="button" aria-label={`Class ${r} with ${label(c)}: ${k}`} onClick={() => onPick(r, c)}>
                      <CodeText k={k} />
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Reference() {
  return (
    <>
      <section className="dgc-grid2" aria-label="Exceptions and specific goods">
        <div className="dgc-card">
          <h2>Exceptions to Table 9.1</h2>
          <ol className="dgc-ex">
            {Object.entries(EXCEPTIONS).map(([n, text]) => <li key={n}><span className="n">{n}</span><span>{text}</span></li>)}
          </ol>
        </div>
        <div className="dgc-card">
          <h2>Table 9.2: specific incompatible goods</h2>
          <p className="dgc-note">These goods are incompatible, but Table 9.1 does not show this at class level.</p>
          <table className="dgc-t92">
            <thead><tr><th>Dangerous goods</th><th>Incompatible with</th></tr></thead>
            <tbody>
              <tr><td>Ammonium nitrate</td><td>Tetranitromethane</td></tr>
              <tr><td>Dichloroisocyanuric acid<br />Trichloroisocyanuric acid</td><td>Any bromate, chlorate, chlorite, hypochlorite, chloroisocyanurate or inorganic nitrite</td></tr>
              <tr><td>Calcium hypochlorite (dry or hydrated) and its mixtures</td><td>Ammonium nitrate, dichloroisocyanuric acid, trichloroisocyanuric acid, any chloroisocyanurate</td></tr>
              <tr><td>Class 6</td><td>Nitromethane (Class 3)</td></tr>
              <tr><td>Concentrated strong acids (Class 8)</td><td>Concentrated strong alkalis (Class 8)</td></tr>
              <tr><td>Cyanide compounds (Class 6.1)</td><td>Acids (Class 8)</td></tr>
            </tbody>
          </table>
          <p className="dgc-note">Acids and alkalis are both Class 8, but they can react violently. Use the SDS to find incompatibilities first.</p>
        </div>
      </section>

      <section className="dgc-card" aria-labelledby="dgc-seg">
        <h2 id="dgc-seg">When goods are incompatible</h2>
        <p>Do not load incompatible goods in the same vehicle or freight container without segregation. Use one of these methods:</p>
        <ul className="dgc-steps">
          <li>Load the incompatible goods on a different vehicle of the same combination (for example, flammable liquids on the lead trailer and oxidisers on the rear trailer).</li>
          <li>Use a segregation device that complies with ADG Code 6.11. A Type I device does not need approval. A Type II device needs a design approval.</li>
          <li>Do not put incompatible goods in the same overpack, for example a shrink-wrapped pallet.</li>
          <li>Do not stow dangerous goods and incompatible goods above each other.</li>
        </ul>
        <p><strong>Table 9.3</strong> lists goods that must never travel together on any vehicle. A segregation device does not make these loads acceptable.</p>
      </section>
    </>
  );
}

// ---- Northline acceptance (GDE-56 Rev 5.0), as the CTO's page lists it ----------------------------

type Qty = ["ok" | "lim" | "cond" | "bad", string];
interface NlRow { code: string; cls: string; cat: string; food?: boolean; qty: Qty[]; req: string | string[]; info?: [string, string[]]; group?: boolean }
const ANY: Qty = ["ok", "Any quantity"], NO: Qty = ["bad", "Prohibited"], ASK: Qty = ["cond", "Needs approval"];
const CYL = "Gas cylinders: steel cage only, also when empty.";
const AERO = "Aerosols are approved. No steel cage is necessary.";
const NL_ROWS: NlRow[] = [
  { group: true, code: "1", cls: "1.1", cat: "Detonators, cartridges, bombs, urea nitrate, ammonium nitrate", qty: [NO], req: "Northline does not transport Division 1.1." },
  { code: "1", cls: "1.2", cat: "Incendiary devices, mines", qty: [NO], req: "Northline does not transport Division 1.2." },
  { code: "1", cls: "1.3C", cat: "Propellant powder", qty: [["lim", "Max 50 kg"]], req: "Do not send more than 50 kg." },
  { code: "1", cls: "1.3F G H J K L", cat: "Flares, fuses, powder cake, toxic", qty: [NO], req: "Not accepted." },
  { code: "1", cls: "1.4S", cat: "Small arms ammunition", qty: [ANY], req: "For manufacturers or distributors only. Transport outside the Northline network is not permitted." },
  { code: "1", cls: "1.4G", cat: "Fireworks", qty: [["lim", "Max 250 kg"]], req: "Do not send more than 250 kg. Fireworks travel only within the Northern Territory." },
  { code: "1", cls: "1.4C", cat: "Smokeless propellant powder", qty: [["lim", "Max 250 kg"]], req: "Do not send more than 250 kg. Northline transports UN 0509 only." },
  { code: "1", cls: "1.4B D E F", cat: "Detonators, secondary bursting charges", qty: [NO], req: "Not accepted." },
  { code: "1", cls: "1.5", cat: "Blasting explosives", qty: [NO], req: "Northline does not transport Division 1.5." },
  { code: "1", cls: "1.6", cat: "Substances with a minor explosion hazard", qty: [NO], req: "Northline does not transport Division 1.6." },
  { group: true, code: "2.1", cls: "2.1", cat: "Flammable gas", qty: [ANY], req: ["Exception: no unodourised propane, butane or LPG.", CYL, AERO] },
  { code: "2.2", cls: "2.2", cat: "Non-flammable gas", qty: [ANY], req: [CYL, AERO] },
  { code: "5.1", cls: "2.2 (5.1)", cat: "Oxidising gas", qty: [ANY], req: [CYL, AERO] },
  {
    code: "2.3", cls: "2.3", cat: "Toxic gas", food: true, qty: [ASK], req: ["Check with the National HSEQ Team.", CYL],
    info: ["Information needed for 2.3 approval", ["Product name, SDS, UN number, quantity, consignor and location from, consignee and location to.", "Approval depends on toxicity, sensitivity to heat during transport, and potential for handling."]],
  },
  { group: true, code: "3", cls: "3", cat: "Flammable liquid", qty: [ANY], req: "Exception: no fuels. This includes petrol, race fuel (nitro) and aviation Avgas." },
  { group: true, code: "4.1", cls: "4.1", cat: "Flammable solids", qty: [["lim", "Max 50 kg"]], req: "Do not send more than 50 kg." },
  { code: "4.2", cls: "4.2", cat: "Substances liable to spontaneous combustion", qty: [NO], req: "Northline does not transport Division 4.2." },
  { code: "4.3", cls: "4.3", cat: "Dangerous when wet", qty: [NO], req: "Northline does not transport Division 4.3." },
  {
    group: true, code: "5.1", cls: "5.1", cat: "Oxidising substances", qty: [ANY], req: "Exception: no products with a peroxide concentration of more than 60%. Check section 3 of the SDS.",
    info: ["Information needed for 5.1", ["Product name, SDS, UN number, packing group, total quantity, type of packaging, quantity in each package or container, consignor and location from, consignee and location to.", "Approval depends on reactivity, % concentration, liquid or solid, sensitivity to heat, and potential for handling."]],
  },
  {
    code: "5.2", cls: "5.2", cat: "Organic peroxides", qty: [ASK], req: "Check with the National HSEQ Team.",
    info: ["Information needed for 5.2 approval", ["Product name, SDS, UN number, quantity, type of packaging, quantity in each package or container, consignor and location from, consignee and location to.", "Approval depends on reactivity, % concentration, quantity, liquid or solid, sensitivity to heat, and potential for handling. Solids have less risk than liquids."]],
  },
  {
    group: true, code: "6.1", cls: "6.1", cat: "Toxic substances", food: true, qty: [ANY, ASK],
    req: ["Any quantity: PG II and PG III in pails and small packages.", "Needs approval: all other types, for example large quantities in IBCs and drums. Check with the National HSEQ Team."],
    info: ["Information needed for 6.1 approval", ["Product name, SDS, UN number, packing group, quantity, type of packaging, quantity in each package or container, consignor and location from, consignee and location to.", "Approval depends on toxicity, quantity, liquid or solid, sensitivity to heat during transport, and potential for handling. Solids have less risk than liquids."]],
  },
  { code: "6.2", cls: "6.2", cat: "Infectious substances", qty: [NO], req: "Northline does not transport Division 6.2." },
  {
    group: true, code: "7", cls: "7", cat: "Radioactive material", qty: [ASK], req: "Check with the National HSEQ Team. Northline transports UN 2910 and UN 2911 only.",
    info: ["Information needed for Class 7 approval", ["Product name, SDS, UN number, quantity, type of packaging, quantity in each package or container, consignor and location from, consignee and location to.", "Approval depends on type, quantity, and potential for handling."]],
  },
  { group: true, code: "8", cls: "8", cat: "Corrosive (acid and alkali)", food: true, qty: [ANY], req: "No additional Northline requirement. Table 9.1 and Table 9.2 still apply." },
  {
    group: true, code: "9", cls: "9", cat: "Miscellaneous, including batteries and environmentally hazardous substances", qty: [ANY, ASK],
    req: ["Northline states that UN 3082 and UN 3077 are not subject to the ADG Code in a receptacle of 500 kg (L) or less, or in an IBC.", "Batteries must meet Northline GDE-55 Transport of Lithium Batteries.", "Needs approval: environmentally hazardous substances."],
    info: ["Information needed for Class 9 approval", ["Product name, SDS, UN number, quantity, consignor and location from, consignee and location to, type of packaging (for example IBC or wooden crate)."]],
  },
];

function Northline() {
  return (
    <section aria-labelledby="dgc-nl">
      <h2 id="dgc-nl">Northline requirements</h2>
      <p>
        Northline adds its own acceptance rules to the ADG Code. A load can be compatible under Table 9.1 and still not be
        accepted by Northline. Check both before you book.
      </p>
      <p className="dgc-note">
        Source: Northline GDE-56 Dangerous Goods – types we carry, Rev 5.0, issue date 26/09/25. The document is uncontrolled
        in printed form. Confirm the current revision with Northline.
      </p>
      <div className="dgc-nl-rules">
        <div className="dgc-nl-rule"><strong>No Packing Group I</strong><span>Northline does not transport Packing Group I goods. Classes 1, 2, 5.2 and 7 do not have packing groups.</span></div>
        <div className="dgc-nl-rule"><strong>Steel cage for gas cylinders</strong><span>A steel cage is the only accepted method for gas cylinders, also when the cylinders are empty. Aerosols do not need a cage.</span></div>
        <div className="dgc-nl-rule"><strong>Not with food</strong><span>Classes 2.3, 6.1 and 8 cannot travel with food.</span></div>
        <div className="dgc-nl-rule"><strong>Approval from the National HSEQ Team</strong><span>For “Needs approval” goods, send the data listed for the class. FCL has a much lower risk than LCL handling in Northline depots.</span></div>
      </div>
      <div className="dgc-legend">
        <span><span className="dgc-code k-ok">Any quantity</span> Accepted, exceptions apply</span>
        <span><span className="dgc-code k-lim">Max 50 kg</span> Accepted up to the limit</span>
        <span><span className="dgc-code k-cond">Needs approval</span> Ask the National HSEQ Team</span>
        <span><span className="dgc-code k-bad">Prohibited</span> Not accepted</span>
      </div>
      <div className="dgc-scroll">
        <table className="dgc-nlt">
          <caption className="visually-hidden">Northline dangerous goods acceptance by class</caption>
          <thead><tr><th scope="col">Class</th><th scope="col">Category</th><th scope="col">Quantity</th><th scope="col">Requirements</th></tr></thead>
          <tbody>
            {NL_ROWS.flatMap((r) => {
              const row = (
                <tr key={r.cls} className={r.group ? "grp" : undefined}>
                  <td className="cl"><span className="dgc-rh"><DgDiamond code={r.code} /><b>{r.cls}</b></span></td>
                  <td>{r.cat}{r.food && <><br /><span className="dgc-food">Cannot travel with food</span></>}</td>
                  <td className="qty">{r.qty.map(([k, t]) => <span key={t} className={`dgc-code k-${k}`}>{t}</span>)}</td>
                  <td>{typeof r.req === "string" ? r.req : <ul>{r.req.map((x) => <li key={x}>{x}</li>)}</ul>}</td>
                </tr>
              );
              if (!r.info) return [row];
              return [row, (
                <tr key={`${r.cls}-info`} className="info">
                  <td />
                  <td colSpan={3}>
                    <details><summary>{r.info[0]}</summary>{r.info[1].map((p) => <p key={p}>{p}</p>)}</details>
                  </td>
                </tr>
              )];
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
