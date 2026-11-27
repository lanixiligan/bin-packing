// Planning-tool disclaimer: results are estimates, not compliance with the NTC Load Restraint Guide
// or with mass and dimension limits. "banner" is one muted line with a "More" disclosure; "full" is
// the whole paragraph. The banner keeps the full text in the DOM (hidden), so print.css can show it.
import { useId, useState } from "react";
import { ChevronIcon, InfoIcon } from "./icons.tsx";
import "./Disclaimer.css";

export interface DisclaimerProps {
  /** "banner" sits under the header; "full" is the long text (e.g. in the print view). */
  variant?: "banner" | "full";
}

const SHORT_TEXT =
  "Planning tool only: results are estimates and are not compliance with the NTC Load Restraint Guide or mass limits.";

function FullText() {
  return (
    <p className="disclaimer-text">
      <strong>Planning tool only.</strong> Placements, axle loads and capacities are estimates worked out
      from typical values, not measurements. A plan is not a load restraint assessment: restrain every load
      as the NTC Load Restraint Guide requires. It does not confirm compliance with mass and dimension
      limits: check the vehicle's General or Higher Mass Limits (GML or HML), and any NHVR permit, notice or
      state route approval the vehicle and route need. All vehicle, body, pallet and container capacities
      are typical values for the class; check the actual vehicle's plates and specifications. The driver
      and operator remain responsible for a safe, legal and properly restrained load.
    </p>
  );
}

export default function Disclaimer({ variant = "banner" }: DisclaimerProps) {
  const [open, setOpen] = useState(false);
  const moreId = useId();

  if (variant === "full") {
    return (
      <div className="disclaimer disclaimer--full" data-testid="disclaimer">
        <FullText />
      </div>
    );
  }

  return (
    <div className="disclaimer disclaimer--banner" data-testid="disclaimer">
      <p className="disclaimer-line">
        <InfoIcon className="disclaimer-icon" />
        <span>{SHORT_TEXT}</span>
        <button type="button" className="disclaimer-toggle" aria-expanded={open} aria-controls={moreId}
                onClick={() => setOpen((o) => !o)}>
          {open ? "Less" : "More"}
          <ChevronIcon className="chevron" size={14} />
        </button>
      </p>
      <div id={moreId} className="disclaimer-more" hidden={!open}>
        <FullText />
      </div>
    </div>
  );
}
