// The headline: fits yes/no with the reasons, a row of key facts, and (in suggest mode) the vehicle
// chosen plus the vehicles tried.
//
// Only the headline is a live region (role="status"), so a screen reader hears "Doesn't fit: 2
// problems" when the verdict changes, not every fact on every re-plan.
import { useId, useState } from "react";
import type { MassScheme, PlanResult, ReferenceData } from "../api/types.ts";
import { formatCount, useUnits } from "../lib/units.ts";
import { AlertIcon, CheckIcon, ChevronIcon, CrossIcon } from "./icons.tsx";
import "./PlanStatus.css";

export interface PlanStatusProps {
  result: PlanResult;
  reference: ReferenceData;
}

const MASS_SCHEME_NAMES: Record<MassScheme, string> = {
  GML: "General Mass Limits",
  HML: "Higher Mass Limits",
};

function headlineText(result: PlanResult): string {
  if (result.fits) return `Fits on the ${result.vehicle_name}`;
  const n = result.reasons.length;
  if (n === 0) return `Doesn't fit on the ${result.vehicle_name}`;
  return `Doesn't fit: ${n} ${n === 1 ? "problem" : "problems"}`;
}

export default function PlanStatus({ result, reference }: PlanStatusProps) {
  const units = useUnits();
  const headingId = useId();
  const triedId = useId();
  const [showTried, setShowTried] = useState(false);

  const vehicle = reference.vehicles[result.vehicle_id];
  const bodyName = reference.bodies[result.body_type]?.name ?? result.body_type;
  const heightLimit = vehicle?.overall_height_limit_mm ?? null;
  const overHeight = heightLimit !== null && result.max_load_height_mm > heightLimit;
  const { pallet_spaces: spaces, teu } = result.utilisation;
  const showTeu = teu.used > 0 && spaces.used === 0;
  const schemeName = MASS_SCHEME_NAMES[result.mass_scheme];

  return (
    <section className={`card plan-status ${result.fits ? "plan-status--fits" : "plan-status--nofit"}`}
             aria-labelledby={headingId} data-testid="plan-status">
      <div role="status">
        <h3 id={headingId} className="plan-status-headline">
          {result.fits ? <CheckIcon size={20} /> : <CrossIcon size={20} />}
          <span>{headlineText(result)}</span>
        </h3>
      </div>

      {!result.fits && result.reasons.length > 0 && (
        <ul className="plan-status-reasons">
          {result.reasons.map((reason, i) => <li key={i}>{reason}</li>)}
        </ul>
      )}

      {result.tried && (
        <div className="plan-status-suggest">
          <p>
            {result.fits ? (
              <>Suggested: <strong>{result.vehicle_name}</strong>, the smallest that fits.</>
            ) : (
              <>None of the vehicles tried fits. Showing the <strong>{result.vehicle_name}</strong>.</>
            )}
          </p>
          <button type="button" className="plan-status-toggle" aria-expanded={showTried} aria-controls={triedId}
                  onClick={() => setShowTried((s) => !s)}>
            <ChevronIcon className="chevron" size={14} />
            Vehicles tried ({result.tried.length})
          </button>
          <ol id={triedId} className="plan-status-tried" hidden={!showTried}>
            {result.tried.map((t) => (
              <li key={t.vehicle_id} className={t.fits ? "tried-fits" : "tried-nofit"}>
                <span className="tried-verdict">
                  {t.fits ? <CheckIcon /> : <CrossIcon />}
                  {t.fits ? "Fits" : "Doesn't fit"}
                </span>
                <span className="tried-name">
                  {reference.vehicles[t.vehicle_id]?.name ?? t.vehicle_id}
                  {t.vehicle_id === result.vehicle_id && <span className="badge badge-info">Suggested</span>}
                </span>
                {t.reason && <span className="tried-reason">{t.reason}</span>}
              </li>
            ))}
          </ol>
        </div>
      )}

      <dl className="plan-status-facts">
        <div>
          <dt>Total weight</dt>
          <dd className="num">{units.weight(result.total_weight_kg)}</dd>
        </div>
        {showTeu ? (
          <div>
            <dt>Containers</dt>
            <dd className="num">{formatCount(teu.used, 2)} of {formatCount(teu.available, 2)} TEU</dd>
          </div>
        ) : (
          <div>
            <dt>Pallet spaces</dt>
            <dd className="num">{formatCount(spaces.used)} of {formatCount(spaces.available)}</dd>
          </div>
        )}
        <div>
          <dt>Tallest point</dt>
          <dd className={`num ${overHeight ? "fact-over" : ""}`}>
            {overHeight && <AlertIcon />}
            {units.length(result.max_load_height_mm)}
            {heightLimit !== null && (
              <span className="fact-sub">
                {overHeight ? " over the " : " of "}{units.length(heightLimit)} limit
              </span>
            )}
          </dd>
        </div>
        <div>
          <dt>Mass limits</dt>
          <dd>
            {schemeName.split(" ")[0]} (<abbr title={schemeName}>{result.mass_scheme}</abbr>)
          </dd>
        </div>
        <div>
          <dt>Body</dt>
          <dd>{bodyName}</dd>
        </div>
      </dl>
    </section>
  );
}
