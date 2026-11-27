import { Fragment, useEffect, useId, useRef, useState } from "react";
import { northlineIssues } from "../../dg/rules.ts";
import {
  DEFAULT_PALLET, demoDg, ITEMS, itemByName, MAX_SHIPMENTS, nextUid, parseWeights, shipmentsFromWeights, typicalSize,
} from "../shipments.js";
import { colorFor, dgClassText } from "./capacity.ts";
import { fitProblems, footprintOf, inputProblem, KNOWN_PALLETS, palletShort, sizeLabel, sizeSpoken } from "./sizes.ts";
import HazardPicker from "./HazardPicker.jsx";

// The shipment list as a compact table: one line per shipment (name, size, kg, whether it
// stacks, DG class and, after Solve, its truck). Click a name, or press Enter on it, to edit
// that row in place; the DG chip opens its own picker. Below the table: a row to add a
// shipment and "Paste a list of weights…".
//
// `fit` is the chosen vehicle's decks and payload (null until the reference data is in): rows
// that can never go on it are flagged, as the server would refuse them. `pallets` is the
// reference's pallet types (KNOWN_PALLETS until then). With `ruleSet === "northline"`, rows
// Northline won't accept are flagged too. `placement` maps a shipment's position in the list
// to { truck } once solved. Row index = the solver's shipment id.
export default function ShipmentTable({
  shipments, fit = null, pallets = KNOWN_PALLETS, onChange, ruleSet = "northline",
  placement = null, activeIds = null, activeTruck = null, onHover = () => {},
}) {
  const [editing, setEditing] = useState(null); // uid of the row being edited
  const solved = placement != null;
  const cols = solved ? 7 : 6;

  function update(uid, patch) {
    onChange(shipments.map((s) => (s.uid === uid ? { ...s, ...patch } : s)));
  }

  // Close the edit row and put focus back on the row's name.
  function finishEdit(uid) {
    setEditing(null);
    requestAnimationFrame(() => document.querySelector(`[data-edit="${uid}"]`)?.focus());
  }

  function remove(uid) {
    if (editing === uid) setEditing(null);
    onChange(shipments.filter((s) => s.uid !== uid));
  }

  return (
    <div className="shipment-form">
      {shipments.length === 0 ? (
        <p className="muted small empty-list">No shipments yet. Add one below, paste weights, or load random ones.</p>
      ) : (
        <table className={`shipment-table${activeIds != null || activeTruck != null ? " linking" : ""}`}>
          <thead>
            <tr>
              <th scope="col" className="col-name">Shipment</th>
              <th scope="col" className="n col-kg">kg</th>
              <th scope="col" className="col-stack"><abbr title="Stackable">Stack</abbr></th>
              <th scope="col" className="col-dg">DG</th>
              {solved && <th scope="col" className="n col-truck">Truck</th>}
              <th scope="col" className="col-remove"><span className="sr-only">Remove</span></th>
            </tr>
          </thead>
          <tbody>
            {shipments.map((s, i) => {
              const checks = fitProblems(s, fit, pallets);
              const missing = inputProblem(s);
              const refused = ruleSet === "northline"
                ? northlineIssues(demoDg(s.dgClass, s.subsidiary)).find((x) => x.kind === "prohibited")
                : null;
              const problems = [
                missing && `${missing[0].toUpperCase()}${missing.slice(1)}.`,
                ...checks.messages,
                refused && refused.message,
              ].filter(Boolean);
              const errId = `row-err-${s.uid}`;
              const truck = placement?.[i]?.truck;
              const lit = activeIds?.includes(i) || (activeTruck != null && truck === activeTruck);
              const hazard = (
                <HazardPicker
                  value={s}
                  onChange={(h) => update(s.uid, h)}
                  name={s.name}
                  others={shipments.filter((o) => o.uid !== s.uid)}
                  ruleSet={ruleSet}
                  describedBy={refused ? errId : undefined}
                  invalid={Boolean(refused)}
                />
              );
              const removeBtn = (
                <button
                  type="button"
                  className="btn btn-ghost btn-icon remove"
                  onClick={() => remove(s.uid)}
                  aria-label={`Remove ${s.name || "shipment"}`}
                  title="Remove shipment"
                >
                  ✕
                </button>
              );
              const rowProps = {
                className: [problems.length && "invalid", lit && "lit"].filter(Boolean).join(" ") || undefined,
                onPointerEnter: solved ? () => onHover([i]) : undefined,
                onPointerLeave: solved ? () => onHover(null) : undefined,
              };
              const size = missing ? "–" : sizeLabel(s);
              return (
                <Fragment key={s.uid}>
                  {editing === s.uid ? (
                    <tr {...rowProps} className={`${rowProps.className ?? ""} editing`}>
                      <td colSpan={cols}>
                        <EditRow
                          s={s}
                          pallets={pallets}
                          onUpdate={(patch) => update(s.uid, patch)}
                          onDone={() => finishEdit(s.uid)}
                          checks={checks}
                          errId={errId}
                          hazard={hazard}
                          removeBtn={removeBtn}
                        />
                      </td>
                    </tr>
                  ) : (
                    <tr {...rowProps}>
                      <td>
                        <div className="name-cell">
                          {solved && <span className="swatch" style={{ background: colorFor(i) }} aria-hidden="true" />}
                          <button
                            type="button"
                            className="name-button"
                            data-edit={s.uid}
                            onClick={() => setEditing(s.uid)}
                            aria-label={`Edit ${s.name || "shipment"}`}
                            aria-describedby={problems.length ? errId : undefined}
                            title="Edit"
                          >
                            {s.name || <span className="muted">(no name)</span>}
                          </button>
                        </div>
                        {/* The size sits under the name, so the name keeps the full column. */}
                        <span className={`name-size${checks.tooLong || checks.tooTall ? " bad" : ""}`}>
                          <span aria-hidden="true">{size}</span>
                          {!missing && <span className="sr-only">{sizeSpoken(s)}</span>}
                          {/* Phones hide the Stack column; this says it here instead. */}
                          {s.stackable && <span className="name-stack" aria-hidden="true"> · stacks</span>}
                        </span>
                      </td>
                      <td className={`n${checks.tooHeavy ? " bad" : ""}`}>{Number(s.weight).toLocaleString()}</td>
                      <td className="stack-cell"><StackMark on={s.stackable} /></td>
                      <td className="dg-cell">{hazard}</td>
                      {solved && <td className="n truck-cell">{truck ?? "–"}</td>}
                      <td className="remove-cell">{removeBtn}</td>
                    </tr>
                  )}
                  {problems.length > 0 && (
                    <tr className="row-msg">
                      <td colSpan={cols} id={errId}>{problems.join(" ")}</td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      )}

      <AddRow shipments={shipments} onChange={onChange} ruleSet={ruleSet} pallets={pallets} fit={fit} />
      <PasteWeights shipments={shipments} onChange={onChange} />
    </div>
  );
}

/** Two stacked boxes for a stackable shipment, a dash for one that isn't; the text says which. */
function StackMark({ on }) {
  return on ? (
    <span className="stack-mark" role="img" aria-label="Stackable" title="Stackable">
      <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
        <rect x="3" y="1.5" width="10" height="5.5" rx="1" />
        <rect x="3" y="9" width="10" height="5.5" rx="1" />
      </svg>
    </span>
  ) : (
    <span className="stack-none" role="img" aria-label="Not stackable" title="Not stackable">–</span>
  );
}

/** The pallet types, then "Loose": the choice of what a shipment is. */
function KindSelect({ value, pallets, onChange, label }) {
  return (
    <select className="select kind" value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
      {Object.entries(pallets).map(([id, p]) => (
        <option key={id} value={id}>{`${palletShort(id)} · ${p.length_mm}×${p.width_mm}`}</option>
      ))}
      <option value="loose">Loose</option>
    </select>
  );
}

/** The fields a change of the kind select sets: a pallet type, or loose with a footprint to start from. */
function kindPatch(value, s, pallets) {
  if (value !== "loose") return { kind: "pallet", palletType: value };
  const fp = footprintOf(s, pallets) ?? [1200, 1000];
  return { kind: "loose", lengthMm: s.lengthMm || fp[0], widthMm: s.widthMm || fp[1] };
}

/** A number input with its unit after it. */
function NumField({ value, onChange, label, unit, className, invalid, describedBy, placeholder }) {
  return (
    <span className={`num-field ${className}`}>
      <input
        className="input"
        type="number"
        min="1"
        step="1"
        inputMode="numeric"
        value={value ?? ""}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? describedBy : undefined}
      />
      <span className="unit" aria-hidden="true">{unit}</span>
    </span>
  );
}

/** One row in edit mode: name, pallet or loose, sizes, kg, stacks, the DG chip, Done. Escape or Enter closes it. */
function EditRow({ s, pallets, onUpdate, onDone, checks, errId, hazard, removeBtn }) {
  const nameRef = useRef(null);
  useEffect(() => {
    nameRef.current?.focus();
    nameRef.current?.select();
  }, []);
  const who = s.name || "shipment";
  const loose = s.kind === "loose";
  return (
    <form
      className="edit-row"
      onSubmit={(e) => { e.preventDefault(); onDone(); }}
      onKeyDown={(e) => { if (e.key === "Escape" && !e.target.closest("dialog")) { e.preventDefault(); onDone(); } }}
    >
      <input
        ref={nameRef}
        className="input name"
        value={s.name}
        onChange={(e) => onUpdate({ name: e.target.value })}
        aria-label="Shipment name"
      />
      <KindSelect
        value={loose ? "loose" : s.palletType || DEFAULT_PALLET}
        pallets={pallets}
        onChange={(v) => onUpdate(kindPatch(v, s, pallets))}
        label={`Pallet type of ${who}, or loose`}
      />
      {loose && (
        <>
          <NumField className="dim" value={s.lengthMm} onChange={(v) => onUpdate({ lengthMm: v })} unit="mm"
            label={`Length of ${who} in mm`} invalid={checks.tooLong} describedBy={errId} />
          <NumField className="dim" value={s.widthMm} onChange={(v) => onUpdate({ widthMm: v })} unit="mm"
            label={`Width of ${who} in mm`} invalid={checks.tooLong} describedBy={errId} />
        </>
      )}
      <NumField className="dim" value={s.heightMm} onChange={(v) => onUpdate({ heightMm: v })} unit="mm high"
        label={loose ? `Height of ${who} in mm` : `Height of ${who} in mm, pallet included`}
        invalid={checks.tooTall} describedBy={errId} />
      <NumField className="weight" value={s.weight} onChange={(v) => onUpdate({ weight: v })} unit="kg"
        label={`Weight of ${who} in kg`} invalid={checks.tooHeavy} describedBy={errId} />
      <label className="check">
        <input type="checkbox" checked={Boolean(s.stackable)} onChange={(e) => onUpdate({ stackable: e.target.checked })}
          aria-label={`${who} stacks`} />
        Stacks
      </label>
      {hazard}
      <button type="submit" className="btn btn-sm">Done</button>
      {removeBtn}
    </form>
  );
}

const EMPTY_ADD = { name: "", kind: "pallet", palletType: DEFAULT_PALLET, lengthMm: "", widthMm: "", heightMm: "1200", weight: "", stackable: false };

/**
 * The "add a shipment" row under the table (it wraps to two lines). Typing a catalogue item
 * ("Methanol", "Pipes") fills in its DG data and typical size. Disabled at MAX_SHIPMENTS.
 */
function AddRow({ shipments, onChange, ruleSet, pallets, fit }) {
  const [draft, setDraft] = useState(EMPTY_ADD);
  const [hazard, setHazard] = useState({ dgClass: null, subsidiary: [] });
  const itemsId = useId();
  const full = shipments.length >= MAX_SHIPMENTS;
  const set = (patch) => setDraft((d) => ({ ...d, ...patch }));
  const loose = draft.kind === "loose";

  function changeName(value) {
    const it = itemByName(value);
    if (!it) {
      set({ name: value });
      return;
    }
    const longest = fit ? Math.max(...fit.decks.map((d) => d.length_mm)) : Infinity;
    const size = typicalSize(it, longest);
    setDraft((d) => ({ ...d, ...size, name: value, heightMm: String(size.heightMm) }));
    setHazard({ dgClass: it.dgClass, subsidiary: [...it.subsidiary] });
  }

  function add(e) {
    e.preventDefault();
    if (full) return;
    const s = {
      uid: nextUid(),
      name: draft.name.trim(),
      weight: Math.round(Number(draft.weight)),
      kind: draft.kind,
      ...(loose
        ? { lengthMm: Math.round(Number(draft.lengthMm)), widthMm: Math.round(Number(draft.widthMm)) }
        : { palletType: draft.palletType }),
      heightMm: Math.round(Number(draft.heightMm)),
      stackable: draft.stackable,
      ...hazard,
    };
    if (inputProblem(s)) return;
    onChange([...shipments, s]);
    setDraft(EMPTY_ADD);
    setHazard({ dgClass: null, subsidiary: [] });
  }

  return (
    <form className="add-row" onSubmit={add} aria-label="Add a shipment" aria-describedby={full ? `${itemsId}-full` : undefined}>
      <fieldset className="add-fields" disabled={full}>
        <input
          className="input name"
          placeholder="New shipment"
          aria-label="New shipment name"
          list={itemsId}
          value={draft.name}
          onChange={(e) => changeName(e.target.value)}
        />
        <datalist id={itemsId}>
          {ITEMS.map((it) => (
            <option key={it.name} value={it.name}>{dgClassText(it.dgClass, it.subsidiary) || "General freight"}</option>
          ))}
        </datalist>
        <KindSelect
          value={loose ? "loose" : draft.palletType}
          pallets={pallets}
          onChange={(v) => set(kindPatch(v, draft, pallets))}
          label="New shipment pallet type, or loose"
        />
        {loose && (
          <>
            <NumField className="dim" value={draft.lengthMm} onChange={(v) => set({ lengthMm: v })} unit="mm"
              placeholder="Length" label="New shipment length in mm" />
            <NumField className="dim" value={draft.widthMm} onChange={(v) => set({ widthMm: v })} unit="mm"
              placeholder="Width" label="New shipment width in mm" />
          </>
        )}
        <NumField className="dim" value={draft.heightMm} onChange={(v) => set({ heightMm: v })} unit="mm high"
          placeholder="Height" label="New shipment height in mm" />
        <NumField className="weight" value={draft.weight} onChange={(v) => set({ weight: v })} unit="kg"
          placeholder="kg" label="New shipment weight in kg" />
        <label className="check">
          <input type="checkbox" checked={draft.stackable} onChange={(e) => set({ stackable: e.target.checked })}
            aria-label="New shipment stacks" />
          Stacks
        </label>
        <HazardPicker value={hazard} onChange={setHazard} name={draft.name.trim() || "new shipment"} others={shipments} ruleSet={ruleSet} />
        <button type="submit" className="btn btn-sm">Add</button>
      </fieldset>
      {full && (
        <p id={`${itemsId}-full`} className="small muted add-full">
          {MAX_SHIPMENTS} shipments is the most one solve takes. Remove one to add another.
        </p>
      )}
    </form>
  );
}

function PasteWeights({ shipments, onChange }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const id = useId();
  const { weights, invalid } = parseWeights(text);
  const room = MAX_SHIPMENTS - shipments.length;

  function apply(mode) {
    if (!weights.length) return;
    const start = mode === "append" ? shipments.length : 0;
    const added = shipmentsFromWeights(weights.slice(0, MAX_SHIPMENTS - start), start);
    onChange(mode === "append" ? [...shipments, ...added] : added);
    setText("");
    setOpen(false);
  }

  if (!open) {
    return (
      <button type="button" className="link-button" onClick={() => setOpen(true)} aria-expanded="false">
        Paste a list of weights…
      </button>
    );
  }

  return (
    <div className="paste-box">
      <label htmlFor={`${id}-text`}>
        Weights in kg, separated by commas, spaces or new lines. Each becomes an AU pallet 1.2 m high, not
        stackable; names are added automatically.
      </label>
      <textarea
        id={`${id}-text`}
        className="input"
        rows={3}
        value={text}
        placeholder={"560, 490, 440 370\n360"}
        onChange={(e) => setText(e.target.value)}
        aria-describedby={`${id}-status`}
        autoFocus
      />
      <p id={`${id}-status`} className="small paste-status" aria-live="polite">
        {weights.length > 0 && <span>{weights.length} weight{weights.length === 1 ? "" : "s"} found. </span>}
        {weights.length > Math.max(0, room) && (
          <span>Adding keeps the first {Math.max(0, room)} (at most {MAX_SHIPMENTS} shipments). </span>
        )}
        {invalid.length > 0 && (
          <span className="paste-invalid">
            Skipping {invalid.length === 1 ? "this entry" : "these entries"} (not a whole number above 0):{" "}
            {invalid.slice(0, 5).map((t) => `"${t}"`).join(", ")}
            {invalid.length > 5 ? ` and ${invalid.length - 5} more` : ""}
          </span>
        )}
      </p>
      <div className="paste-actions">
        <button type="button" className="btn btn-sm" disabled={!weights.length || room <= 0} onClick={() => apply("append")}>
          Add to list
        </button>
        <button type="button" className="btn btn-sm" disabled={!weights.length} onClick={() => apply("replace")}>
          Replace list
        </button>
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => { setOpen(false); setText(""); }}>
          Cancel
        </button>
      </div>
    </div>
  );
}
