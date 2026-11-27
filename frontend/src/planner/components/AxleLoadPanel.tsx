// One bar per axle group, load vs limit. The scale runs to 120 % of the limit with a tick at the
// limit, so an overload stays visible (the part over the limit is hatched). Status comes from the
// planner: ok "Within limit", near (>= 90 %) amber "Near limit", over red "Over by 2.2 t". Every
// state has words and an icon, never colour alone.
import { useId } from "react";
import type { AxleLoad, MassScheme } from "../api/types.ts";
import { formatPercent, useUnits, type Units } from "../lib/units.ts";
import { AlertIcon, CheckIcon, CrossIcon } from "./icons.tsx";
import "./AxleLoadPanel.css";

export interface AxleLoadPanelProps {
  axleLoads: AxleLoad[];
  massScheme: MassScheme;
}

/** The bar's full width, as a multiple of the limit. */
const SCALE = 1.2;
const LIMIT_AT = `${(100 / SCALE).toFixed(3)}%`;

const SCHEME_NAMES: Record<MassScheme, string> = {
  GML: "General Mass Limits",
  HML: "Higher Mass Limits",
};

function statusText(a: AxleLoad, units: Units): string {
  if (a.status === "over") return `Over by ${units.weight(Math.max(0, a.load_kg - a.limit_kg))}`;
  if (a.status === "near") return "Near limit";
  return "Within limit";
}

function AxleRow({ axle }: { axle: AxleLoad }) {
  const units = useUnits();
  const nameId = useId();
  const ratio = axle.limit_kg > 0 ? axle.load_kg / axle.limit_kg : axle.ratio;
  const pct = formatPercent(ratio * 100);
  const status = statusText(axle, units);
  const over = axle.status === "over";
  const shown = Math.min(Math.max(ratio, 0), SCALE);
  const pctOfBar = (r: number) => `${((r / SCALE) * 100).toFixed(3)}%`;
  const Icon = over ? CrossIcon : axle.status === "near" ? AlertIcon : CheckIcon;
  const scaleMax = Math.round(axle.limit_kg * SCALE);

  return (
    <li className={`axle-row axle-row--${axle.status}`}>
      <div className="axle-head">
        <span className="axle-name" id={nameId}>{axle.name}</span>
        <span className="axle-status"><Icon size={14} />{status}</span>
      </div>
      <div className="axle-bar" role="meter" aria-labelledby={nameId}
           aria-valuemin={0} aria-valuemax={scaleMax} aria-valuenow={Math.min(Math.round(axle.load_kg), scaleMax)}
           aria-valuetext={`${units.weight(axle.load_kg)} of ${units.weight(axle.limit_kg)} limit, ${pct}, ${status.toLowerCase()}`}>
        <span className="axle-fill" style={{ width: pctOfBar(Math.min(shown, 1)) }} />
        {over && shown > 1 && (
          <span className="axle-overflow" style={{ left: LIMIT_AT, width: pctOfBar(shown - 1) }} />
        )}
        <span className="axle-tick" style={{ left: LIMIT_AT }} />
      </div>
      <span className="axle-values num">
        {units.weight(axle.load_kg)} / {units.weight(axle.limit_kg)}
        <span className="axle-pct">{pct}</span>
      </span>
    </li>
  );
}

export default function AxleLoadPanel({ axleLoads, massScheme }: AxleLoadPanelProps) {
  const headingId = useId();
  return (
    <section className="card axle-panel" aria-labelledby={headingId} data-testid="axle-loads">
      <div className="card-header axle-panel-header">
        <div>
          <h3 id={headingId} className="card-title">Estimated axle loads ({SCHEME_NAMES[massScheme]})</h3>
          <p className="subtle">Static estimate, not a weighbridge reading.</p>
        </div>
      </div>
      <ul className="axle-list">
        {axleLoads.map((a) => <AxleRow key={a.group_id} axle={a} />)}
      </ul>
      <p className="axle-key xs subtle">
        The line marks each group's limit. Near limit means 90 % or more of it; load over the limit is
        hatched, drawn up to 120 %.
      </p>
    </section>
  );
}
