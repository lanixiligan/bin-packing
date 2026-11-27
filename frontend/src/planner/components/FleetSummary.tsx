// Split mode headline: how many trucks the freight needs and how sure that is ("Proven fewest" or
// "Best found · at least N"), the lower bounds behind it (weight, floor space, volume), a note when
// dangerous goods forced the split, any units no truck can take, and the way back to one truck.
//
// Only the headline is a live region, like PlanStatus.
import { useId } from "react";
import type { FleetResult, PlanRequest } from "../api/types.ts";
import { fleetHeadline, groupUnits } from "../lib/fleet.ts";
import { AlertIcon, CheckIcon, CrossIcon, InfoIcon } from "./icons.tsx";
import "./FleetSummary.css";

export interface FleetSummaryProps {
  fleet: FleetResult;
  /** The request the fleet answers: names the freight lines of unplaced units. */
  request: PlanRequest;
  /** The freight has dangerous goods that can't share a vehicle (lib/fleet.ts dgForcesSplit). */
  dgSeparated?: boolean;
  onBack(): void;
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

export default function FleetSummary({ fleet, request, dgSeparated = false, onBack }: FleetSummaryProps) {
  const headingId = useId();
  const boundsId = useId();
  const unplacedId = useId();
  const tone = !fleet.fits ? "problem" : fleet.optimal ? "proven" : "best";
  const Icon = !fleet.fits ? (fleet.num_trucks === 0 ? CrossIcon : AlertIcon) : fleet.optimal ? CheckIcon : InfoIcon;
  const bounds = Object.entries(fleet.lower_bounds)
    .sort(([a], [b]) => (BOUND_ORDER.indexOf(a) + 1 || 99) - (BOUND_ORDER.indexOf(b) + 1 || 99));
  const unplaced = groupUnits(fleet.unplaced, request.items);

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

      <p className="fleet-explanation">{explanation(fleet)}</p>

      {bounds.length > 0 && fleet.num_trucks > 0 && (
        <div className="fleet-bounds">
          <span id={boundsId} className="fleet-bounds-label">Fewest trucks possible by</span>
          <ul className="fleet-bounds-list" aria-labelledby={boundsId}>
            {bounds.map(([key, n]) => (
              <li key={key} className={`fleet-bound${n === fleet.lower_bound ? " fleet-bound--binding" : ""}`}>
                <span className="fleet-bound-name">{BOUND_NAMES[key] ?? key}</span>
                <span className="fleet-bound-value num">{n}</span>
              </li>
            ))}
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
