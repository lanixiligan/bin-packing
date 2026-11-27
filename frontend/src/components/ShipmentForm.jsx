import { useId, useState } from "react";
import { northlineIssues } from "../dg/rules.ts";
import { demoDg, ITEMS, itemByName, nextUid, parseWeights, shipmentsFromWeights } from "../shipments.js";
import { dgClassText } from "./capacity.ts";
import HazardPicker from "./HazardPicker.jsx";

// `capacity` is null while the capacity field is empty or invalid, so rows are
// only flagged "heavier than truck" against a real capacity. With
// `ruleSet === "northline"`, rows Northline won't accept are flagged too (the
// server refuses them on Solve).
export default function ShipmentForm({ shipments, capacity, onChange, ruleSet = "adg" }) {
  const [name, setName] = useState("");
  const [weight, setWeight] = useState("");
  const [hazard, setHazard] = useState({ dgClass: null, subsidiary: [] });
  const itemsId = useId();

  // Typing or picking a catalogue item ("Methanol") fills in its DG data.
  function changeName(value) {
    setName(value);
    const it = itemByName(value);
    if (it) setHazard({ dgClass: it.dgClass, subsidiary: [...it.subsidiary] });
  }

  function add(e) {
    e.preventDefault();
    const w = Number(weight);
    if (!name.trim() || !(w > 0)) return;
    onChange([...shipments, { uid: nextUid(), name: name.trim(), weight: Math.round(w), ...hazard }]);
    setName("");
    setWeight("");
    setHazard({ dgClass: null, subsidiary: [] });
  }

  function update(uid, patch) {
    onChange(shipments.map((s) => (s.uid === uid ? { ...s, ...patch } : s)));
  }

  function remove(uid) {
    onChange(shipments.filter((s) => s.uid !== uid));
  }

  return (
    <div className="shipment-form">
      <div className="shipment-list">
        {shipments.length === 0 && <p className="muted">No shipments yet. Add one below, paste weights, or load random ones.</p>}
        {shipments.map((s) => {
          const tooHeavy = capacity != null && Number(s.weight) > capacity;
          const refused = ruleSet === "northline"
            ? northlineIssues(demoDg(s.dgClass, s.subsidiary)).find((i) => i.kind === "prohibited")
            : null;
          const errId = `row-err-${s.uid}`;
          const dgErrId = `row-dg-err-${s.uid}`;
          return (
            <div key={s.uid} className={`shipment-row ${tooHeavy ? "invalid" : ""}${refused ? " dg-refused" : ""}`}>
              <input
                className="name"
                value={s.name}
                onChange={(e) => update(s.uid, { name: e.target.value })}
                aria-label="Shipment name"
              />
              <input
                className="weight"
                type="number"
                min="1"
                value={s.weight}
                onChange={(e) => update(s.uid, { weight: e.target.value })}
                aria-label={`Weight of ${s.name || "shipment"} in kg`}
                aria-invalid={tooHeavy || undefined}
                aria-describedby={tooHeavy ? errId : undefined}
              />
              <span className="unit">kg</span>
              <HazardPicker
                value={s}
                onChange={(h) => update(s.uid, h)}
                name={s.name}
                others={shipments.filter((o) => o.uid !== s.uid)}
                ruleSet={ruleSet}
                describedBy={refused ? dgErrId : undefined}
                invalid={Boolean(refused)}
              />
              <button
                type="button"
                className="icon"
                onClick={() => remove(s.uid)}
                aria-label={`Remove ${s.name || "shipment"}`}
                title="Remove shipment"
              >
                ✕
              </button>
              {tooHeavy && <span id={errId} className="row-error">heavier than truck!</span>}
              {refused && <span id={dgErrId} className="row-error">{refused.message}</span>}
            </div>
          );
        })}
      </div>

      <form className="add-row" onSubmit={add}>
        <input
          placeholder="Shipment name"
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
          placeholder="Weight"
          aria-label="New shipment weight in kg"
          type="number"
          min="1"
          value={weight}
          onChange={(e) => setWeight(e.target.value)}
        />
        <span className="unit">kg</span>
        <HazardPicker value={hazard} onChange={setHazard} name={name.trim() || "new shipment"} others={shipments} ruleSet={ruleSet} />
        <button type="submit">+ Add shipment</button>
      </form>

      <PasteWeights shipments={shipments} onChange={onChange} />
    </div>
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
        📋 Paste a list of weights…
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
        <button type="button" disabled={!weights.length} onClick={() => apply("append")}>
          Add to list
        </button>
        <button type="button" disabled={!weights.length} onClick={() => apply("replace")}>
          Replace list
        </button>
        <button type="button" className="secondary" onClick={() => { setOpen(false); setText(""); }}>
          Cancel
        </button>
      </div>
    </div>
  );
}
