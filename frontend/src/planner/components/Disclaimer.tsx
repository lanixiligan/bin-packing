// STUB (B-results replaces the body, keeps the props). Planning-tool disclaimer: not legal
// compliance with the NTC Load Restraint Guide or with mass limits.
export interface DisclaimerProps {
  /** "banner" sits under the header; "full" is the long text (e.g. in the print view). */
  variant?: "banner" | "full";
}

export default function Disclaimer(_props: DisclaimerProps) {
  return <p data-testid="disclaimer">Planning tool only.</p>;
}
