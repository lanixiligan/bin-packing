// Split mode headline: how many trucks the freight needs and how sure that is ("Proven fewest" or
// "Best found · at least N"), the lower bounds behind it (weight, floor space, volume, each as
// ⌈total ÷ what one truck holds⌉ when the reference data is given), a note when dangerous goods
// forced the split, any units no truck can take, and the way back to one truck. While a new split
// is being worked out it shows the time used against the solver's limit (SolvingProgress).
//
// Only the headline is a live region, like PlanStatus.
import { useEffect, useId, useState } from "react";
import type { FleetResult, PlanRequest, ReferenceData } from "../api/types.ts";
import { fleetHeadline, groupUnits } from "../lib/fleet.ts";
import { boundTotals, type BoundTotal } from "../lib/sceneData.ts";
import { formatCount, useUnits, type Units } from "../lib/units.ts";
import { AlertIcon, CheckIcon, CrossIcon, InfoIcon } from "./icons.tsx";
import "./FleetSummary.css";

export interface FleetSummaryProps {
  fleet: FleetResult;
  /** The request the fleet answers: names the freight lines of unplaced units. */
  request: PlanRequest;
  /** The freight has dangerous goods that can't share a vehicle (lib/fleet.ts dgForcesSplit). */
  dgSeparated?: boolean;
  /** For the bounds as ⌈total ÷ what one truck holds⌉; without it only the numbers show. */
  reference?: ReferenceData | null;
  /** A new split is on its way: show the solver's progress. */
  solving?: boolean;
  /** Changes with every new request, so the progress bar restarts from 0 s (not from the request it replaced). */
  solvingKey?: number;
  onBack(): void;
}

/** The split solver's time limit (EXACT_TIME_LIMIT_S in backend/app/planner/fleet.py). */
const SOLVER_TIME_LIMIT_S = 10;

/** Time used against the solver's limit, counted from when it is shown. */
export function SolvingProgress() {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const started = performance.now();
    const timer = setInterval(() => setElapsed((performance.now() - started) / 1000), 200);
    return () => clearInterval(timer);
  }, []);
  const shown = Math.min(elapsed, SOLVER_TIME_LIMIT_S);
  return (
    <div className="fleet-progress no-print" data-testid="solving-progress">
      <progress max={SOLVER_TIME_LIMIT_S} value={shown} aria-label="Time used of the solver limit" />
      <p className="fleet-progress-time num" aria-hidden="true">{shown.toFixed(1)} s of up to {SOLVER_TIME_LIMIT_S} s</p>
      <p className="fleet-progress-note">
        OR-Tools keeps searching until it proves the fewest trucks, or stops at the {SOLVER_TIME_LIMIT_S} s limit
        with the best split found.
      </p>
    </div>
  );
}

/** "14,400 ÷ 8,000 kg", "12.2 ÷ 10.9 m²", "19.1 ÷ 31.1 m³": a bound's total over one truck. */
function ratioText(key: string, t: BoundTotal, units: Units): string {
  if (key === "weight") {
    return units.system === "m-t"
      ? `${formatCount(t.total / 1000)} ÷ ${formatCount(t.capacity / 1000)} t`
      : `${formatCount(t.total, 0)} ÷ ${formatCount(t.capacity, 0)} kg`;
  }
  return `${formatCount(t.total)} ÷ ${formatCount(t.capacity)} ${key === "floor" ? "m²" : "m³"}`;
}

const BOUND_NAMES: Record<string, string> = { weight: "Weight", floor: "Floor space", volume: "Volume" };
const BOUND_ORDER = ["weight", "floor", "volume"];

function explanation(fleet: FleetResult): string {
  if (fleet.num_trucks === 0) return `Nothing here fits on a ${fleet.vehicle_name}.`;
  const each = `Each truck is a ${fleet.vehicle_name}.`;
  if (fleet.optimal) return `${each} No split can use fewer.`;
  if (fleet.method === "heuristic") {
    return `${each} This is a big load, so it was split truck by truck and isn't proven the fewest: `
      + `a split needs at least ${fleet.lower_bound}.`;
  }
  return `${each} The planner ran out of time before proving this is the fewest: a split needs at least ${fleet.lower_bound}.`;
}

export default function FleetSummary({ fleet, request, dgSeparated = false, reference = null, solving = false, solvingKey = 0, onBack }: FleetSummaryProps) {
  const units = useUnits();
  const headingId = useId();
  const boundsId = useId();
  const unplacedId = useId();
  const tone = !fleet.fits ? "problem" : fleet.optimal ? "proven" : "best";
  const Icon = !fleet.fits ? (fleet.num_trucks === 0 ? CrossIcon : AlertIcon) : fleet.optimal ? CheckIcon : InfoIcon;
  const bounds = Object.entries(fleet.lower_bounds)
    .sort(([a], [b]) => (BOUND_ORDER.indexOf(a) + 1 || 99) - (BOUND_ORDER.indexOf(b) + 1 || 99));
  const unplaced = groupUnits(fleet.unplaced, request.items);
  const totals = reference ? boundTotals(fleet, reference) : null;

  return (
    <section className={`card fleet-summary fleet-summary--${tone}`} aria-labelledby={headingId} data-testid="fleet-summary">
      <div className="fleet-summary-top">
        <div role="status" className="fleet-summary-status">
          <h3 id={headingId} className="fleet-headline">
            <Icon size={20} />
            <span>{fleetHeadline(fleet)}</span>
          </h3>
        </div>
        <button type="button" className="btn btn-sm fleet-back" onClick={onBack}>Back to one truck</button>
      </div>

      {solving && <SolvingProgress key={solvingKey} />}

      <p className="fleet-explanation">{explanation(fleet)}</p>

      {bounds.length > 0 && fleet.num_trucks > 0 && (
        <div className="fleet-bounds">
          <span id={boundsId} className="fleet-bounds-label">Fewest trucks possible by</span>
          <ul className="fleet-bounds-list" aria-labelledby={boundsId}>
            {bounds.map(([key, n]) => {
              const total = totals?.[key as keyof typeof totals];
              return (
                <li key={key} className={`fleet-bound${n === fleet.lower_bound ? " fleet-bound--binding" : ""}`}>
                  <span className="fleet-bound-name">{BOUND_NAMES[key] ?? key}</span>
                  {total && (
                    <span className="fleet-bound-ratio num" title="The freight’s total over what one truck holds, rounded up">
                      ⌈{ratioText(key, total, units)}⌉ =
                    </span>
                  )}
                  <span className="fleet-bound-value num">{n}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {dgSeparated && fleet.num_trucks > 1 && (
        <p className="fleet-note" role="note">
          <AlertIcon className="fleet-note-icon" />
          <span>Dangerous goods that can&rsquo;t travel together are on separate trucks.</span>
        </p>
      )}

      {(unplaced.length > 0 || (!fleet.fits && fleet.reasons.length > 0)) && (
        <div className="fleet-unplaced" role="group" aria-labelledby={unplacedId}>
          <h4 id={unplacedId} className="fleet-unplaced-title">
            {unplaced.length > 0 ? (
              <><span className="badge badge-error num">{fleet.unplaced.length}</span> {fleet.unplaced.length === 1
                ? "unit can’t go on any truck" : "units can’t go on any truck"}</>
            ) : "This split has problems"}
          </h4>
          {unplaced.length > 0 && (
            <ul className="fleet-unplaced-list">
              {unplaced.map((g) => (
                <li key={g.itemId}>
                  <strong>{g.label}</strong>{" "}
                  <span className="muted num">× {g.unitIds.length}</span>
                </li>
              ))}
            </ul>
          )}
          {fleet.reasons.length > 0 && (
            <ul className="fleet-reasons">
              {fleet.reasons.map((reason, i) => <li key={i}>{reason}</li>)}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
