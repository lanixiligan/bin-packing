// Step 2: editable freight rows (a compact card per row, so it fits the narrow rail), quick-add
// presets, random freight, duplicate / delete with undo, inline validation messages. Rows with
// dangerous goods show a read-only placard badge, and an early hint above the rows names pairs
// that can't share a vehicle (the plan result stays the authority).
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import type { ReferenceData } from "../api/types.ts";
import { checkAll, type DgPairResult } from "../../dg/rules.ts";
import { dgLabel, dgName, placardCode } from "../lib/dg.ts";
import { newRow, newRowId, type FreightRow, type RowErrors, type RowField } from "../lib/freight.ts";
import { randomFreight } from "../lib/randomFreight.ts";
import { useUnits } from "../lib/units.ts";
import { AlertIcon, InfoIcon } from "./icons.tsx";
import "./FreightTable.css";

export interface FreightTableProps {
  reference: ReferenceData;
  rows: FreightRow[];
  onRowsChange(rows: FreightRow[]): void;
  /** From validateRows: per row id and field. */
  errors: RowErrors;
  /** From validateRows: problems with the list as a whole. */
  listErrors: string[];
  /** Random numbers in [0, 1) for "Random freight"; defaults to Math.random (tests pass a seeded one). */
  random?: () => number;
}

const TOAST_MS = 6000;

// ---- Presets -------------------------------------------------------------------

interface Preset {
  label: string;
  rows: Partial<FreightRow>[];
}

const PRESETS: Preset[] = [
  { label: "10 × AU pallets, 800 kg",
    rows: [{ label: "AU pallets", kind: "pallet", type_id: "AU_STD", quantity: 10, gross_weight_kg: 800, height_mm: 1200 }] },
  { label: "22 × AU pallets (full semi)",
    rows: [{ label: "Full semi of AU pallets", kind: "pallet", type_id: "AU_STD", quantity: 22, gross_weight_kg: 1000, height_mm: 1200 }] },
  { label: "6 × Euro pallets, 500 kg",
    rows: [{ label: "Euro pallets", kind: "pallet", type_id: "EURO", quantity: 6, gross_weight_kg: 500, height_mm: 1200 }] },
  { label: "1 × 40' HC container, 20 t",
    rows: [{ label: "40' HC container", kind: "container", type_id: "HC40", quantity: 1, gross_weight_kg: 20000, height_mm: null }] },
  { label: "2 × 20' GP containers, 12 t",
    rows: [{ label: "20' GP containers", kind: "container", type_id: "GP20", quantity: 2, gross_weight_kg: 12000, height_mm: null }] },
];

function availablePresets(ref: ReferenceData): Preset[] {
  return PRESETS.filter((p) => p.rows.every((r) => (r.kind === "container" ? ref.containers : ref.pallets)[r.type_id!]));
}

function defaultContainer(ref: ReferenceData): string {
  const list = Object.values(ref.containers);
  return (ref.containers.GP20 ?? list.find((c) => !c.specialist) ?? list[0])?.id ?? "";
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// ---- Dangerous goods ------------------------------------------------------------

/** Read-only placard-style badge: the code in a diamond, then "Class 3" / "Food". Nothing for general freight. */
function DgBadge({ dg }: { dg: FreightRow["dg"] }) {
  const code = placardCode(dg);
  if (!code) return null;
  const kind = dg?.dg_class ? "dg" : dg?.food ? "food" : "fire";
  return (
    <span className={`ft-dg-badge ft-dg-${kind}`} title={dgName(dg)}>
      <span className="ft-dg-diamond" aria-hidden="true"><span>{code}</span></span>
      <span className="visually-hidden">Dangerous goods: </span>
      <span className="ft-dg-text">{dgLabel(dg)}</span>
    </span>
  );
}

interface Indexed { row: FreightRow; index: number }

const lineName = ({ row, index }: Indexed) => `${row.label.trim() || `Line ${index + 1}`} (${dgLabel(row.dg)})`;

/** A plain-language sentence for a pair of lines that conflict or need a check. */
function pairMessage(p: DgPairResult<Indexed>): string {
  const names = `${lineName(p.a)} and ${lineName(p.b)}`;
  if (p.status === "incompatible") {
    const table = p.reasons.length > 0 && p.reasons.every((r) => r.includes("Table 9.2")) ? "9.2" : "9.1";
    return `${names} can't travel on the same vehicle (ADG Table ${table}).`;
  }
  if (p.reasons.some((r) => r.includes("Explosives Code"))) {
    return `${names} may be able to travel together: check the Australian Explosives Code first.`;
  }
  return `${names} may need a check against ADG Table 9.2 for their specific goods.`;
}

const MAX_HINTS = 4;

// ---- Icons -----------------------------------------------------------------------

const iconProps = {
  viewBox: "0 0 20 20", width: 16, height: 16, fill: "none", stroke: "currentColor", strokeWidth: 1.6,
  strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true, focusable: false,
};
const CopyIcon = () => (
  <svg {...iconProps}><rect x="7" y="7" width="10" height="10" rx="2" /><path d="M13 4.5V4a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h.5" /></svg>
);
const TrashIcon = () => (
  <svg {...iconProps}><path d="M3.5 5.5h13M8 5.5V4h4v1.5M5 5.5l.8 10.5a1 1 0 0 0 1 .9h6.4a1 1 0 0 0 1-.9L15 5.5M8.5 9v5M11.5 9v5" /></svg>
);
const PlusIcon = () => <svg {...iconProps}><path d="M10 4v12M4 10h12" /></svg>;

// ---- Field wrapper -----------------------------------------------------------------

interface FieldProps {
  id: string;
  label: ReactNode;
  error?: string;
  hint?: ReactNode;
  className?: string;
  children(a11y: { id: string; "aria-invalid": boolean | undefined; "aria-describedby": string | undefined }): ReactNode;
}

function Field({ id, label, error, hint, className = "", children }: FieldProps) {
  const errId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy = [error ? errId : "", hint ? hintId : ""].filter(Boolean).join(" ") || undefined;
  return (
    <div className={`field ${className}`}>
      <label className="field-label" htmlFor={id}>{label}</label>
      {children({ id, "aria-invalid": error ? true : undefined, "aria-describedby": describedBy })}
      {hint && <span id={hintId} className="field-hint num">{hint}</span>}
      {error && <span id={errId} className="field-error">{error}</span>}
    </div>
  );
}

const toNumber = (v: string): number | null => {
  if (v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// ---- Toast ---------------------------------------------------------------------------

interface Toast {
  message: string;
  /** Undo: given the rows at that moment, the rows to restore. */
  undo?: (current: FreightRow[]) => FreightRow[];
  /** Row to focus after undoing. */
  focusId?: string;
  key: number;
}

// ---- Component -------------------------------------------------------------------------

export default function FreightTable({ reference, rows, onRowsChange, errors, listErrors, random }: FreightTableProps) {
  const units = useUnits();
  const uid = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  /** After a render, focus this row (by id) or row index, else the Add line button. */
  const pendingFocus = useRef<{ id?: string; index?: number; field?: string } | null>(null);

  const [toast, setToast] = useState<Toast | null>(null);
  const [toastPaused, setToastPaused] = useState(false);
  const presets = useMemo(() => availablePresets(reference), [reference]);
  const dgPairs = useMemo(() => checkAll(rows.map((row, index) => ({ row, index })), (x) => x.row.dg), [rows]);
  const incompatible = dgPairs.filter((p) => p.status === "incompatible");
  const toCheck = dgPairs.filter((p) => p.status === "check");

  // The toast hides after a few seconds, but not while the pointer or focus is on it.
  useEffect(() => {
    if (!toast || toastPaused) return;
    const t = setTimeout(() => setToast(null), TOAST_MS);
    return () => clearTimeout(t);
  }, [toast, toastPaused]);

  // Move focus after rows are added, removed or restored (the old element may be gone).
  useEffect(() => {
    const target = pendingFocus.current;
    const root = rootRef.current;
    if (!target || !root) return;
    pendingFocus.current = null;
    const cards = Array.from(root.querySelectorAll<HTMLElement>("[data-row-id]"));
    const card = target.id
      ? cards.find((c) => c.dataset.rowId === target.id)
      : target.index != null ? cards[Math.min(target.index, cards.length - 1)] : undefined;
    const el = card && target.field ? card.querySelector<HTMLElement>(`[data-field="${target.field}"]`) : card;
    (el ?? root.querySelector<HTMLElement>("[data-add-line]"))?.focus();
  });

  const showToast = (t: Omit<Toast, "key">) => {
    setToastPaused(false);
    setToast((prev) => ({ ...t, key: (prev?.key ?? 0) + 1 }));
  };

  const update = (id: string, patch: Partial<FreightRow>) =>
    onRowsChange(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  const switchKind = (row: FreightRow, kind: FreightRow["kind"]) => {
    if (kind === row.kind) return;
    const patch: Partial<FreightRow> = { kind };
    const w = row.gross_weight_kg;
    if (kind === "pallet") {
      patch.type_id = reference.pallet_defaults.default_pallet;
      patch.height_mm = row.height_mm ?? 1200;
      if (w != null && w > reference.pallet_defaults.max_gross_kg) patch.gross_weight_kg = 500;
    } else {
      patch.type_id = defaultContainer(reference);
      patch.stackable = false;
      const tare = reference.containers[patch.type_id]?.tare_kg ?? 0;
      if (w == null || w < tare) patch.gross_weight_kg = 10000;
    }
    update(row.id, patch);
  };

  const addLine = () => {
    const row = newRow(reference);
    pendingFocus.current = { id: row.id, field: "label" };
    onRowsChange([...rows, row]);
  };

  const duplicate = (index: number) => {
    const copy = { ...rows[index], id: newRowId() };
    pendingFocus.current = { id: copy.id };
    onRowsChange([...rows.slice(0, index + 1), copy, ...rows.slice(index + 1)]);
  };

  const remove = (index: number) => {
    const row = rows[index];
    pendingFocus.current = { index };
    onRowsChange(rows.filter((_, i) => i !== index));
    const name = row.label ? `“${row.label}”` : `line ${index + 1}`;
    showToast({
      message: `Deleted ${name}.`,
      undo: (current) => [...current.slice(0, index), row, ...current.slice(index)],
      focusId: row.id,
    });
  };

  const addPreset = (preset: Preset) => {
    const added = preset.rows.map((o) => newRow(reference, o));
    const ids = new Set(added.map((r) => r.id));
    onRowsChange([...rows, ...added]);
    showToast({ message: `Added ${preset.label}.`, undo: (current) => current.filter((r) => !ids.has(r.id)) });
  };

  const addRandom = () => {
    const previous = rows;
    const added = randomFreight(reference, { random });
    onRowsChange(added);
    showToast({ message: `Replaced the list with ${plural(added.length, "random line")}.`, undo: () => previous });
  };

  const undo = () => {
    if (!toast?.undo) return;
    if (toast.focusId) pendingFocus.current = { id: toast.focusId };
    onRowsChange(toast.undo(rows));
    setToast(null);
  };

  // ---- Totals ----
  const totals = rows.reduce((t, r) => {
    const q = r.quantity ?? 0;
    if (r.kind === "pallet") t.pallets += q;
    else t.containers += q;
    t.weight += q * (r.gross_weight_kg ?? 0);
    return t;
  }, { pallets: 0, containers: 0, weight: 0 });

  const presetsLabelId = `${uid}-presets`;

  return (
    <div className="ft" ref={rootRef}>
      {listErrors.length > 0 && rows.length > 0 && (
        <ul className="ft-list-errors">
          {listErrors.map((e) => <li key={e}>{e}</li>)}
        </ul>
      )}

      <div className="ft-dg-hints" role="status">
        {incompatible.length > 0 && (
          <div className="ft-dg-hint ft-dg-hint-error">
            <AlertIcon size={18} className="ft-dg-hint-icon" />
            <div className="ft-dg-hint-body">
              <p className="ft-dg-hint-title">Dangerous goods that can't share a vehicle</p>
              <ul>
                {incompatible.slice(0, MAX_HINTS).map((p) => <li key={`${p.a.row.id}|${p.b.row.id}`}>{pairMessage(p)}</li>)}
                {incompatible.length > MAX_HINTS && <li>And {plural(incompatible.length - MAX_HINTS, "more pair")}.</li>}
              </ul>
              <p className="ft-dg-hint-note">The plan will show this as a problem.</p>
            </div>
          </div>
        )}
        {toCheck.length > 0 && (
          <div className="ft-dg-hint ft-dg-hint-check">
            <InfoIcon size={18} className="ft-dg-hint-icon" />
            <div className="ft-dg-hint-body">
              <p className="ft-dg-hint-title">Dangerous goods to check</p>
              <ul>
                {toCheck.slice(0, MAX_HINTS).map((p) => <li key={`${p.a.row.id}|${p.b.row.id}`}>{pairMessage(p)}</li>)}
                {toCheck.length > MAX_HINTS && <li>And {plural(toCheck.length - MAX_HINTS, "more pair")}.</li>}
              </ul>
            </div>
          </div>
        )}
      </div>

      {rows.length === 0 ? (
        <div className="ft-empty">
          <p className="ft-empty-title">No freight yet: add a line or use a preset.</p>
        </div>
      ) : (
        <ol className="ft-rows">
          {rows.map((row, i) => {
            const e = errors[row.id] ?? {};
            const fid = (f: string) => `${uid}-${row.id}-${f}`;
            const headingId = fid("heading");
            const err = (f: RowField) => e[f];
            const lineWeight = row.quantity != null && row.gross_weight_kg != null ? row.quantity * row.gross_weight_kg : null;
            const isPallet = row.kind === "pallet";
            return (
              <li key={row.id} className={`ft-row${Object.keys(e).length ? " ft-row-invalid" : ""}`}
                  data-row-id={row.id} tabIndex={-1} aria-labelledby={headingId}>
                <div className="ft-row-header">
                  <h3 id={headingId} className="ft-row-title">
                    Line {i + 1}{row.label && <span className="ft-row-label">: {row.label}</span>}
                  </h3>
                  <DgBadge dg={row.dg} />
                  {lineWeight != null && lineWeight > 0 && (
                    <span className="ft-row-total num" title="Line weight">{units.weight(lineWeight)}</span>
                  )}
                  <div className="ft-row-actions">
                    <button type="button" className="btn btn-ghost btn-icon" onClick={() => duplicate(i)}
                            aria-label={`Duplicate line ${i + 1}`} title="Duplicate"><CopyIcon /></button>
                    <button type="button" className="btn btn-ghost btn-icon ft-delete" onClick={() => remove(i)}
                            aria-label={`Delete line ${i + 1}`} title="Delete"><TrashIcon /></button>
                  </div>
                </div>

                <div className="ft-fields">
                  <Field id={fid("label")} label="Label" error={err("label")} className="ft-span-2 ft-label">
                    {(a) => (
                      <input {...a} className="input" type="text" value={row.label} data-field="label"
                             placeholder="e.g. Cartons" autoComplete="off"
                             onChange={(ev) => update(row.id, { label: ev.target.value })} />
                    )}
                  </Field>

                  <fieldset className="field ft-kind">
                    <legend className="field-label">Kind</legend>
                    <div className="segmented">
                      {(["pallet", "container"] as const).map((k) => (
                        <label key={k}>
                          <input type="radio" name={fid("kind")} value={k} checked={row.kind === k}
                                 onChange={() => switchKind(row, k)} />
                          <span>{k === "pallet" ? "Pallet" : "Container"}</span>
                        </label>
                      ))}
                    </div>
                  </fieldset>

                  <Field id={fid("type")} label="Type" error={err("type_id")}>
                    {(a) => (
                      <select {...a} className="select" value={row.type_id}
                              onChange={(ev) => update(row.id, { type_id: ev.target.value })}>
                        {!(isPallet ? reference.pallets : reference.containers)[row.type_id] && (
                          <option value={row.type_id}>Choose a type…</option>
                        )}
                        {isPallet ? (
                          Object.values(reference.pallets).map((p) => (
                            <option key={p.id} value={p.id}>{p.name} · {units.footprint(p.length_mm, p.width_mm)}</option>
                          ))
                        ) : (
                          <>
                            <optgroup label="Standard">
                              {Object.values(reference.containers).filter((c) => !c.specialist).map((c) => (
                                <option key={c.id} value={c.id}>{c.name}</option>
                              ))}
                            </optgroup>
                            <optgroup label="Specialist">
                              {Object.values(reference.containers).filter((c) => c.specialist).map((c) => (
                                <option key={c.id} value={c.id}>{c.name}</option>
                              ))}
                            </optgroup>
                          </>
                        )}
                      </select>
                    )}
                  </Field>

                  <Field id={fid("quantity")} label="Quantity" error={err("quantity")}>
                    {(a) => (
                      <input {...a} className="input" type="number" inputMode="numeric" min={1} max={200} step={1}
                             value={row.quantity ?? ""} onChange={(ev) => update(row.id, { quantity: toNumber(ev.target.value) })} />
                    )}
                  </Field>

                  <Field id={fid("weight")} label="Weight per unit (kg)" error={err("gross_weight_kg")}
                         hint={units.system === "m-t" && row.gross_weight_kg ? `= ${units.weight(row.gross_weight_kg)}` : undefined}>
                    {(a) => (
                      <input {...a} className="input" type="number" inputMode="decimal" min={0} step="any"
                             value={row.gross_weight_kg ?? ""}
                             onChange={(ev) => update(row.id, { gross_weight_kg: toNumber(ev.target.value) })} />
                    )}
                  </Field>

                  {isPallet ? (
                    <Field id={fid("height")} label="Height (mm)" error={err("height_mm")}
                           hint={units.system === "m-t" && row.height_mm ? `= ${units.length(row.height_mm)}` : undefined}>
                      {(a) => (
                        <input {...a} className="input" type="number" inputMode="numeric" min={1} step={1}
                               value={row.height_mm ?? ""}
                               onChange={(ev) => update(row.id, { height_mm: toNumber(ev.target.value) })} />
                      )}
                    </Field>
                  ) : (
                    <div className="field">
                      <span className="field-label" aria-hidden="true">Height (mm)</span>
                      <span className="ft-na"><span aria-hidden="true">—</span>
                        <span className="visually-hidden">Height: not needed for containers</span></span>
                    </div>
                  )}

                  <Field id={fid("stop")} label="Stop (1 = first drop)" error={err("stop")}>
                    {(a) => (
                      <input {...a} className="input" type="number" inputMode="numeric" min={1} max={50} step={1}
                             placeholder="Any" value={row.stop ?? ""}
                             onChange={(ev) => update(row.id, { stop: toNumber(ev.target.value) })} />
                    )}
                  </Field>

                  <div className="ft-span-2 ft-flags">
                    {isPallet && (
                      <label className="ft-check">
                        <input type="checkbox" checked={row.stackable}
                               onChange={(ev) => update(row.id, { stackable: ev.target.checked })} />
                        <span>Stackable</span>
                      </label>
                    )}
                    <label className="ft-check">
                      <input type="checkbox" checked={row.temp_controlled}
                             onChange={(ev) => update(row.id, { temp_controlled: ev.target.checked })} />
                      <span>Temp-controlled</span>
                    </label>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {rows.length > 0 && (
        <p className="ft-totals num">
          <span className="ft-totals-label">Total</span>
          {[
            totals.pallets ? plural(totals.pallets, "pallet") : "",
            totals.containers ? plural(totals.containers, "container") : "",
            units.weight(totals.weight),
          ].filter(Boolean).join(" · ")}
        </p>
      )}

      <div className="ft-actions">
        <button type="button" className="btn btn-primary" onClick={addLine} data-add-line>
          <PlusIcon />Add line
        </button>
        <button type="button" className="btn" onClick={addRandom}>
          <span aria-hidden="true">🎲</span>Random freight
        </button>
      </div>

      {presets.length > 0 && (
        <div className="ft-presets" role="group" aria-labelledby={presetsLabelId}>
          <span id={presetsLabelId} className="ft-presets-label">Quick add</span>
          <div className="ft-presets-list">
            {presets.map((p) => (
              <button key={p.label} type="button" className="btn btn-sm ft-preset" onClick={() => addPreset(p)}>
                <PlusIcon />{p.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="ft-toast-region" role="status" aria-live="polite">
        {toast && (
          <div key={toast.key} className="ft-toast"
               onMouseEnter={() => setToastPaused(true)} onMouseLeave={() => setToastPaused(false)}
               onFocus={() => setToastPaused(true)} onBlur={() => setToastPaused(false)}>
            <span>{toast.message}</span>
            {toast.undo && <button type="button" className="btn btn-sm ft-toast-undo" onClick={undo}>Undo</button>}
            <button type="button" className="btn btn-ghost btn-icon ft-toast-close" aria-label="Dismiss"
                    onClick={() => setToast(null)}>×</button>
          </div>
        )}
      </div>
    </div>
  );
}
