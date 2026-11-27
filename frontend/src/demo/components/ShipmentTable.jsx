import { Fragment, useEffect, useId, useRef, useState } from "react";
import { northlineIssues } from "../../dg/rules.ts";
import { demoDg, ITEMS, itemByName, nextUid, parseWeights, shipmentsFromWeights } from "../shipments.js";
import { colorFor, dgClassText } from "./capacity.ts";
import HazardPicker from "./HazardPicker.jsx";

// The shipment list as a compact table: one line per shipment (name, kg, pallet
// spaces, DG class and, after Solve, its truck). Click a name, or press Enter on it,
// to edit that row in place; the DG chip opens its own picker. Below the table:
// a row to add a shipment and "Paste a list of weights…".
//
// `capacity` is null while the capacity field is empty or invalid, so rows are
// only flagged "heavier than truck" against a real capacity. Likewise
// `maxPallets` (null = not limited) flags rows with more pallets than a truck. With
// `ruleSet === "northline"`, rows Northline won't accept are flagged too (the
// server refuses them on Solve). `placement` maps a shipment's position in the
// list to { truck } once solved. Row index = the solver's shipment id.
export default function ShipmentTable({
  shipments, capacity, maxPallets = null, onChange, ruleSet = "adg",
  placement = null, activeId = null, activeTruck = null, onHover = () => {},
}) {
  const [editing, setEditing] = useState(null); // uid of the row being edited
  const solved = placement != null;
  const cols = solved ? 6 : 5;

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
        <table className={`shipment-table${activeId != null || activeTruck != null ? " linking" : ""}`}>
          <thead>
            <tr>
              <th scope="col" className="col-name">Shipment</th>
              <th scope="col" className="n col-kg">kg</th>
              <th scope="col" className="n col-pal"><abbr title="Pallet spaces">Pal</abbr></th>
              <th scope="col" className="col-dg">DG</th>
              {solved && <th scope="col" className="n col-truck">Truck</th>}
              <th scope="col" className="col-remove"><span className="sr-only">Remove</span></th>
            </tr>
          </thead>
          <tbody>
            {shipments.map((s, i) => {
              const tooHeavy = capacity != null && Number(s.weight) > capacity;
              const tooBig = maxPallets != null && Number(s.pallets) > maxPallets;
              const refused = ruleSet === "northline"
                ? northlineIssues(demoDg(s.dgClass, s.subsidiary)).find((x) => x.kind === "prohibited")
                : null;
              const problems = [
                tooHeavy && "Heavier than a truck can carry.",
                tooBig && "Takes more pallet spaces than a truck has.",
                refused && refused.message,
              ].filter(Boolean);
              const errId = `row-err-${s.uid}`;
              const truck = placement?.[i]?.truck;
              const lit = activeId === i || (activeTruck != null && truck === activeTruck);
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
                onPointerEnter: solved ? () => onHover(i) : undefined,
                onPointerLeave: solved ? () => onHover(null) : undefined,
              };
              return (
                <Fragment key={s.uid}>
                  {editing === s.uid ? (
                    <tr {...rowProps} className={`${rowProps.className ?? ""} editing`}>
                      <td colSpan={cols}>
                        <EditRow
                          s={s}
                          onUpdate={(patch) => update(s.uid, patch)}
                          onDone={() => finishEdit(s.uid)}
                          tooHeavy={tooHeavy}
                          tooBig={tooBig}
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
                      </td>
                      <td className={`n${tooHeavy ? " bad" : ""}`}>{Number(s.weight).toLocaleString()}</td>
                      <td className={`n${tooBig ? " bad" : ""}`}>{s.pallets ?? 0}</td>
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

      <AddRow shipments={shipments} onChange={onChange} ruleSet={ruleSet} />
      <PasteWeights shipments={shipments} onChange={onChange} />
    </div>
  );
}

/** One row in edit mode: name, kg and pallets inputs, the DG chip, Done. Escape or Enter closes it. */
function EditRow({ s, onUpdate, onDone, tooHeavy, tooBig, errId, hazard, removeBtn }) {
  const nameRef = useRef(null);
  useEffect(() => {
    nameRef.current?.focus();
    nameRef.current?.select();
  }, []);
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
      <input
        className="input weight"
        type="number"
        min="1"
        value={s.weight}
        onChange={(e) => onUpdate({ weight: e.target.value })}
        aria-label={`Weight of ${s.name || "shipment"} in kg`}
        aria-invalid={tooHeavy || undefined}
        aria-describedby={tooHeavy ? errId : undefined}
      />
      <span className="unit" aria-hidden="true">kg</span>
      <input
        className="input pallets"
        type="number"
        min="0"
        max="100"
        step="1"
        value={s.pallets ?? 0}
        onChange={(e) => onUpdate({ pallets: e.target.value })}
        aria-label={`Pallet spaces of ${s.name || "shipment"} (0 for loose freight)`}
        aria-invalid={tooBig || undefined}
        aria-describedby={tooBig ? errId : undefined}
      />
      <span className="unit" aria-hidden="true">pal</span>
      {hazard}
      <button type="submit" className="btn btn-sm">Done</button>
      {removeBtn}
    </form>
  );
}

/** The "add a shipment" row under the table. Typing a catalogue item ("Methanol") fills in its DG data. */
function AddRow({ shipments, onChange, ruleSet }) {
  const [name, setName] = useState("");
  const [weight, setWeight] = useState("");
  const [pallets, setPallets] = useState("1");
  const [hazard, setHazard] = useState({ dgClass: null, subsidiary: [] });
  const itemsId = useId();

  function changeName(value) {
    setName(value);
    const it = itemByName(value);
    if (it) setHazard({ dgClass: it.dgClass, subsidiary: [...it.subsidiary] });
  }

  function add(e) {
    e.preventDefault();
    const w = Number(weight);
    if (!name.trim() || !(w > 0)) return;
    const p = Math.max(0, Math.round(Number(pallets) || 0));
    onChange([...shipments, { uid: nextUid(), name: name.trim(), weight: Math.round(w), pallets: p, ...hazard }]);
    setName("");
    setWeight("");
    setPallets("1");
    setHazard({ dgClass: null, subsidiary: [] });
  }

  return (
    <form className="add-row" onSubmit={add} aria-label="Add a shipment">
      <input
        className="input name"
        placeholder="New shipment"
        aria-label="New shipment name"
        list={itemsId}
        value={name}
        onChange={(e) => changeName(e.target.value)}
      />
      <datalist id={itemsId}>
        {ITEMS.map((it) => (
          <option key={it.name} value={it.name}>{dgClassText(it.dgClass, it.subsidiary) || "General freight"}</option>
        ))}
      </datalist>
      <input
        className="input weight"
        placeholder="kg"
        aria-label="New shipment weight in kg"
        type="number"
        min="1"
        value={weight}
        onChange={(e) => setWeight(e.target.value)}
      />
      <input
        className="input pallets"
        placeholder="Pal"
        aria-label="New shipment pallet spaces (0 for loose freight)"
        type="number"
        min="0"
        max="100"
        step="1"
        value={pallets}
        onChange={(e) => setPallets(e.target.value)}
      />
      <HazardPicker value={hazard} onChange={setHazard} name={name.trim() || "new shipment"} others={shipments} ruleSet={ruleSet} />
      <button type="submit" className="btn btn-sm">Add</button>
    </form>
  );
}

function PasteWeights({ shipments, onChange }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const id = useId();
  const { weights, invalid } = parseWeights(text);

  function apply(mode) {
    if (!weights.length) return;
    const start = mode === "append" ? shipments.length : 0;
    const added = shipmentsFromWeights(weights, start);
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
        Weights in kg, separated by commas, spaces or new lines. Names are added automatically.
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
        {invalid.length > 0 && (
          <span className="paste-invalid">
            Skipping {invalid.length === 1 ? "this entry" : "these entries"} (not a whole number above 0):{" "}
            {invalid.slice(0, 5).map((t) => `"${t}"`).join(", ")}
            {invalid.length > 5 ? ` and ${invalid.length - 5} more` : ""}
          </span>
        )}
      </p>
      <div className="paste-actions">
        <button type="button" className="btn btn-sm" disabled={!weights.length} onClick={() => apply("append")}>
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
