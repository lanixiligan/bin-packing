// The "Dangerous goods" section of the item form: not DG (optionally food or
// fire-risk goods) or DG with class, subsidiary hazards, packing group, UN
// number, container and the ADG Table 9.2 specific goods. The values are a
// DgFormValues (logic.ts); dgFromForm turns them into the API's DgInfo.
import { useState } from "react";
import { CARRIER_TAGS, CLASS_NAMES, CONTAINERS, DG_CLASSES, SUBSIDIARIES, T92_TAGS } from "../../dg/rules";
import { DgDiamond } from "../../dg/DgBadge";
import { canBeFireRisk, hasPackingGroup, type DgFormValues } from "../logic";
import { Field } from "./Field";

const toggle = <T,>(xs: T[], x: T, on: boolean): T[] => (on ? [...xs.filter((y) => y !== x), x] : xs.filter((y) => y !== x));

/** A short message under a group of checkboxes. */
function GroupError({ id, error }: { id: string; error: string | null }) {
  return error ? <p className="field-error" id={id}>{error}</p> : null;
}

export function DgFields({ idPrefix, value: f, onChange, err }: {
  idPrefix: string;
  value: DgFormValues;
  onChange: (patch: Partial<DgFormValues>) => void;
  /** The error shown for a DG_FIELDS key, or null. */
  err: (key: string) => string | null;
}) {
  const id = (k: string) => `${idPrefix}-dg-${k}`;
  const c = f.dg_class;
  const extrasError = Boolean(err("dg.subsidiary") || err("dg.carrier_tags"));
  const extrasCount = f.subsidiary.filter((s) => s !== c).length + f.carrier_tags.length;
  const [extrasOpen, setExtrasOpen] = useState(extrasCount > 0);

  return (
    <fieldset className="dg-fieldset" aria-describedby={id("intro")}>
      <legend>Dangerous goods</legend>
      <p className="hint" id={id("intro")}>
        See section 14 (“Transport information”) of the product’s safety data sheet (SDS). Some goods can’t share a vehicle,
        so we use this to plan your deliveries.
      </p>
      <GroupError id={id("error")} error={err("dg")} />

      <div className="radio-row">
        <label className="check">
          <input type="radio" name={id("kind")} value="general" checked={f.kind === "general"} onChange={() => onChange({ kind: "general" })} />
          Not dangerous goods
        </label>
        <label className="check">
          <input type="radio" name={id("kind")} value="dg" checked={f.kind === "dg"} onChange={() => onChange({ kind: "dg" })} />
          Dangerous goods
        </label>
      </div>

      {f.kind === "general" ? (
        <fieldset className="dg-group" aria-describedby={id("general-hint")}>
          <legend>Is it any of these? <span className="muted small">(optional)</span></legend>
          <div className="radio-row">
            <label className="check">
              <input type="checkbox" checked={f.food} aria-invalid={err("dg.food") ? true : undefined}
                     onChange={(e) => onChange({ food: e.target.checked, combustible: e.target.checked ? false : f.combustible })} />
              Food or food packaging
            </label>
            <label className="check">
              <input type="checkbox" checked={f.combustible}
                     onChange={(e) => onChange({ combustible: e.target.checked, food: e.target.checked ? false : f.food })} />
              Fire-risk goods (combustible liquid, not DG)
            </label>
          </div>
          <p className="hint" id={id("general-hint")}>Tick one at most. Food and fire-risk goods can’t travel with some dangerous goods.</p>
          <GroupError id={id("food-error")} error={err("dg.food")} />
        </fieldset>
      ) : (
        <>
          <div className="form-grid dg-grid">
            <Field id={id("class")} label="Class" required error={err("dg.dg_class")} className="span-2">
              {(p) => (
                <div className="dg-class-pick">
                  <select {...p} value={c}
                          onChange={(e) => {
                            const next = e.target.value as DgFormValues["dg_class"];
                            onChange({ dg_class: next, subsidiary: f.subsidiary.filter((s) => s !== next) });
                          }}>
                    <option value="">Choose a class…</option>
                    {DG_CLASSES.map((k) => <option key={k} value={k}>Class {k}: {CLASS_NAMES[k]}</option>)}
                  </select>
                  {c ? <DgDiamond code={c} size="lg" /> : null}
                </div>
              )}
            </Field>
            <Field id={id("un")} label="UN number" error={err("dg.un_number")} hint="4 digits, e.g. 1263.">
              {(p) => (
                <input {...p} value={f.un_number} inputMode="numeric" maxLength={4} autoComplete="off" placeholder="e.g. 1263"
                       onChange={(e) => onChange({ un_number: e.target.value })} />
              )}
            </Field>
            {c === "1" ? (
              <Field id={id("explosive")} label="Division and compatibility group" required error={err("dg.explosive_code")} hint="e.g. 1.4S.">
                {(p) => (
                  <input {...p} value={f.explosive_code} maxLength={4} autoComplete="off" placeholder="1.4S"
                         onChange={(e) => onChange({ explosive_code: e.target.value })} />
                )}
              </Field>
            ) : null}
            {c && hasPackingGroup(c) ? (
              <Field id={id("pg")} label="Packing group" error={err("dg.packing_group")} hint="I = high danger, III = low.">
                {(p) => (
                  <select {...p} value={f.packing_group} onChange={(e) => onChange({ packing_group: e.target.value as DgFormValues["packing_group"] })}>
                    <option value="">None or not given</option>
                    <option value="I">I</option>
                    <option value="II">II</option>
                    <option value="III">III</option>
                  </select>
                )}
              </Field>
            ) : null}
            <Field id={id("container")} label="Packaging" error={err("dg.container")}>
              {(p) => (
                <select {...p} value={f.container} onChange={(e) => onChange({ container: e.target.value as DgFormValues["container"] })}>
                  {CONTAINERS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              )}
            </Field>
            {c && canBeFireRisk(c) ? (
              <div className="field span-full">
                <label className="check">
                  <input type="checkbox" checked={f.fire_risk} aria-invalid={err("dg.fire_risk") ? true : undefined}
                         aria-describedby={[id("fire-hint"), err("dg.fire_risk") ? id("fire-error") : ""].filter(Boolean).join(" ")}
                         onChange={(e) => onChange({ fire_risk: e.target.checked })} />
                  Fire-risk substance
                </label>
                <span className="hint" id={id("fire-hint")}>Look for the flame pictogram, or check section 2 of the SDS.</span>
                <GroupError id={id("fire-error")} error={err("dg.fire_risk")} />
              </div>
            ) : null}
          </div>

          <fieldset className="dg-group" aria-describedby={id("t92-hint")}>
            <legend>Specific goods (ADG Table 9.2)</legend>
            <p className="hint" id={id("t92-hint")}>
              Some goods can’t travel together even when their classes can, e.g. pool chlorine with acids.
            </p>
            <div className="radio-row">
              <label className="check">
                <input type="radio" name={id("t92-state")} checked={!f.t92_checked} onChange={() => onChange({ t92_checked: false })} />
                Not checked yet
              </label>
              <label className="check">
                <input type="radio" name={id("t92-state")} checked={f.t92_checked} onChange={() => onChange({ t92_checked: true })} />
                Checked
              </label>
            </div>
            {f.t92_checked ? (
              <div role="group" aria-label="The item is or contains" aria-describedby={id("t92-none")}>
                <p className="hint" id={id("t92-none")}>Tick each one the item is or contains. None ticked means none of these apply.</p>
                <div className="check-chips">
                  {T92_TAGS.map((t) => (
                    <label key={t.value} className="check-chip">
                      <input type="checkbox" checked={f.t92.includes(t.value)}
                             onChange={(e) => onChange({ t92: toggle(f.t92, t.value, e.target.checked) })} />
                      {t.label}
                    </label>
                  ))}
                </div>
              </div>
            ) : (
              <p className="hint">Until you check, orders that mix this item with goods Table 9.2 covers show a reminder.</p>
            )}
            <GroupError id={id("t92-error")} error={err("dg.t92")} />
          </fieldset>

          <details className="dims-helper dg-more" open={extrasOpen || extrasError}
                   onToggle={(e) => setExtrasOpen(e.currentTarget.open)}>
            <summary>
              Subsidiary hazards and carrier details
              {extrasCount ? <span className="muted small">&nbsp;({extrasCount} ticked)</span> : null}
            </summary>
            <fieldset className="dg-group">
              <legend>Subsidiary hazards <span className="muted small">(optional, up to 4)</span></legend>
              <div className="check-chips">
                {SUBSIDIARIES.filter((s) => s !== c).map((s) => (
                  <label key={s} className="check-chip">
                    <input type="checkbox" checked={f.subsidiary.includes(s)}
                           onChange={(e) => onChange({ subsidiary: toggle(f.subsidiary, s, e.target.checked) })} />
                    <DgDiamond code={s} size="sm" />
                    {s} {CLASS_NAMES[s]}
                  </label>
                ))}
              </div>
              <GroupError id={id("sub-error")} error={err("dg.subsidiary")} />
            </fieldset>
            <fieldset className="dg-group">
              <legend>Carrier details <span className="muted small">(tick any that apply)</span></legend>
              <div className="check-chips">
                {CARRIER_TAGS.map((t) => (
                  <label key={t.value} className="check-chip">
                    <input type="checkbox" checked={f.carrier_tags.includes(t.value)}
                           onChange={(e) => onChange({ carrier_tags: toggle(f.carrier_tags, t.value, e.target.checked) })} />
                    {t.label}
                  </label>
                ))}
              </div>
              <GroupError id={id("carrier-error")} error={err("dg.carrier_tags")} />
            </fieldset>
          </details>
        </>
      )}
    </fieldset>
  );
}
