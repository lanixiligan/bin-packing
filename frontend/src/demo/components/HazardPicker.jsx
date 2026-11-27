// The demo's dangerous goods picker. A compact chip in the shipment row
// (placard diamond + class + subsidiary hazards) opens a dialog with:
//   - Not DG / Food / Fire-risk and a grid of placard tiles for the class
//     (one radio group, so arrow keys move between tiles),
//   - subsidiary hazard chips (checkboxes, up to 4, only with a class),
//   - which shipments in the list it can't share a truck with, and the
//     Northline refusal when that rule set is on.
// Edits are staged: Done applies them, Cancel / Escape / backdrop discards.
// A native <dialog> is used so the scrolling shipment list can't clip it.
import { useEffect, useId, useRef, useState } from "react";
import { DgDiamond } from "../../dg/DgBadge.tsx";
import { CLASS_NAMES, DG_CLASSES, northlineIssues, pairVerdict, SUBSIDIARIES } from "../../dg/rules.ts";
import { dgClassText } from "./capacity.ts";
import { demoDg, isDgClass, MAX_SUBSIDIARY, normaliseHazard } from "../shipments.js";
import "./hazard.css";

const NON_DG = [
  { value: "", code: null, label: "Not DG", hint: "General freight" },
  { value: "food", code: "F", label: "Food", hint: "Food or food packaging" },
  { value: "fire_risk", code: "R", label: "Fire-risk", hint: "Combustible, not DG" },
];
const SHOW_CONFLICTS = 6;

/** Diamond code for a demo value: "F" food, "R" fire-risk, the class, or null. */
const diamondCode = (v) => (!v ? null : v === "food" ? "F" : v === "fire_risk" ? "R" : v);

const className = (c) => (c === "1" ? "Explosives (1.4S)" : CLASS_NAMES[c]);
const hazardText = (h) => dgClassText(h.dgClass, h.subsidiary) || "Not dangerous goods";

/**
 * value: { dgClass, subsidiary }; onChange(value); name: the shipment's name
 * (for labels); others: the other shipments in the list (for conflicts).
 */
export default function HazardPicker({ value, onChange, name, others = [], ruleSet = "adg", describedBy, invalid = false }) {
  const id = useId();
  const dialogRef = useRef(null);
  const triggerRef = useRef(null);
  const [draft, setDraft] = useState(null); // null while closed
  const current = normaliseHazard(value?.dgClass, value?.subsidiary);
  const code = diamondCode(current.dgClass);
  const fullText = hazardText(current);

  function open() {
    setDraft(current);
    dialogRef.current?.showModal();
  }
  function close() {
    dialogRef.current?.close(); // fires onClose
  }
  function done() {
    onChange(normaliseHazard(draft.dgClass, draft.subsidiary));
    close();
  }

  // On open, start on the chosen tile (arrow keys then move between classes).
  // showModal() runs before the form renders, so focus is on the dialog itself.
  const isOpen = draft !== null;
  useEffect(() => {
    if (isOpen) dialogRef.current?.querySelector("input[type=radio]:checked")?.focus();
  }, [isOpen]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`hz-chip${code ? "" : " general"}${invalid ? " invalid" : ""}`}
        onClick={open}
        aria-haspopup="dialog"
        aria-label={`Dangerous goods for ${name || "shipment"}: ${fullText}. Change`}
        aria-describedby={describedBy}
        title={fullText}
      >
        {code ? <DgDiamond code={code} size="sm" /> : <span className="hz-empty" aria-hidden="true" />}
        <span className="hz-chip-text">
          {code ? (current.dgClass === "food" ? "Food" : current.dgClass === "fire_risk" ? "Fire-risk" : current.dgClass === "1" ? "1.4S" : current.dgClass) : "Not DG"}
        </span>
        {current.subsidiary.length > 0 && (
          <span className="hz-chip-subs" aria-hidden="true">
            {current.subsidiary.map((s) => <DgDiamond key={s} code={s} />)}
            <span>+{current.subsidiary.join(" +")}</span>
          </span>
        )}
      </button>

      <dialog
        ref={dialogRef}
        className="hz-dialog"
        aria-labelledby={`${id}-title`}
        onClose={() => { setDraft(null); triggerRef.current?.focus(); }}
        onClick={(e) => { if (e.target === dialogRef.current) close(); }}
      >
        {draft && (
          <HazardForm id={id} name={name} draft={draft} setDraft={setDraft} others={others} ruleSet={ruleSet}
                      onCancel={close} onDone={done} />
        )}
      </dialog>
    </>
  );
}

function HazardForm({ id, name, draft, setDraft, others, ruleSet, onCancel, onDone }) {
  const hasClass = isDgClass(draft.dgClass);
  const subsFull = draft.subsidiary.length >= MAX_SUBSIDIARY;
  const pick = (dgClass) => setDraft(normaliseHazard(dgClass, draft.subsidiary));
  const toggleSub = (s, on) =>
    setDraft(normaliseHazard(draft.dgClass, on ? [...draft.subsidiary, s] : draft.subsidiary.filter((x) => x !== s)));

  const dg = demoDg(draft.dgClass, draft.subsidiary);
  const conflicts = dg
    ? others.filter((o) => o.dgClass && pairVerdict(dg, demoDg(o.dgClass, o.subsidiary)).status === "incompatible")
    : [];
  const refused = ruleSet === "northline" ? northlineIssues(dg).find((i) => i.kind === "prohibited") : null;
  const code = diamondCode(draft.dgClass);

  return (
    <form className="hz-form" onSubmit={(e) => { e.preventDefault(); onDone(); }}>
      <header className="hz-head">
        <div>
          <h2 id={`${id}-title`}>Dangerous goods</h2>
          <p className="muted small">{name || "New shipment"}</p>
        </div>
        <div className="hz-preview" aria-live="polite">
          {code ? <DgDiamond code={code} size="lg" /> : <span className="hz-empty lg" aria-hidden="true" />}
          <span>
            <b>{hazardText(draft)}</b>
            {hasClass && <span className="muted small"><br />{className(draft.dgClass)}</span>}
          </span>
        </div>
      </header>

      <div className="hz-body">
        <fieldset className="hz-group">
          <legend>Class</legend>
          <div className="hz-tiles hz-tiles-wide">
            {NON_DG.map((o) => (
              <Tile key={o.value} name={`${id}-class`} value={o.value} checked={(draft.dgClass ?? "") === o.value}
                    onPick={() => pick(o.value || null)} code={o.code} title={o.label} hint={o.hint} />
            ))}
          </div>
          <div className="hz-tiles">
            {DG_CLASSES.map((c) => (
              <Tile key={c} name={`${id}-class`} value={c} checked={draft.dgClass === c}
                    onPick={() => pick(c)} code={c} title={c === "1" ? "1.4S" : c} hint={className(c)} />
            ))}
          </div>
        </fieldset>

        <fieldset className="hz-group" disabled={!hasClass} aria-describedby={`${id}-sub-hint`}>
          <legend>
            Subsidiary hazards <span className="muted small">(optional, up to {MAX_SUBSIDIARY})</span>
          </legend>
          <p className="muted small" id={`${id}-sub-hint`}>
            {hasClass
              ? "Extra hazards from the SDS or the placard. Each one is checked for segregation too."
              : "Pick a DG class first: general freight, food and fire-risk goods have no subsidiary hazards."}
          </p>
          <div className="hz-subs">
            {SUBSIDIARIES.filter((s) => s !== draft.dgClass).map((s) => {
              const on = draft.subsidiary.includes(s);
              return (
                <label key={s} className={`hz-sub${on ? " on" : ""}`}>
                  <input type="checkbox" checked={on} disabled={!on && subsFull}
                         onChange={(e) => toggleSub(s, e.target.checked)} />
                  <DgDiamond code={s} size="sm" />
                  <b>{s}</b> <span className="muted">{CLASS_NAMES[s]}</span>
                </label>
              );
            })}
          </div>
        </fieldset>

        <section className="hz-compat" aria-live="polite">
          {refused && <p className="hz-refused" role="alert">{refused.message}</p>}
          {!dg ? (
            <p className="muted small">General freight can share a truck with anything.</p>
          ) : conflicts.length === 0 ? (
            <p className="hz-ok small"><span aria-hidden="true">✓</span> No conflicts with the other shipments in the list.</p>
          ) : (
            <>
              <p className="small">
                <b>Can’t share a truck with {conflicts.length} shipment{conflicts.length === 1 ? "" : "s"}:</b>
              </p>
              <ul className="hz-conflicts">
                {conflicts.slice(0, SHOW_CONFLICTS).map((o) => (
                  <li key={o.uid}>
                    <DgDiamond code={diamondCode(o.dgClass)} size="sm" />
                    {o.name || "Shipment"} <span className="muted">({dgClassText(o.dgClass, o.subsidiary)})</span>
                  </li>
                ))}
                {conflicts.length > SHOW_CONFLICTS && <li className="muted">and {conflicts.length - SHOW_CONFLICTS} more</li>}
              </ul>
            </>
          )}
        </section>
      </div>

      <footer className="hz-foot">
        <button type="button" className="btn" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn btn-primary">Done</button>
      </footer>
    </form>
  );
}

function Tile({ name, value, checked, onPick, code, title, hint }) {
  return (
    <label className={`hz-tile${checked ? " on" : ""}`} title={hint}>
      <input type="radio" name={name} value={value} checked={checked} onChange={onPick} />
      {code ? <DgDiamond code={code} size="lg" /> : <span className="hz-empty lg" aria-hidden="true" />}
      <span className="hz-tile-text">
        <b>{title}</b>
        <span className="hz-tile-hint">{hint}</span>
      </span>
    </label>
  );
}
