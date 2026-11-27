// STUB (B-results replaces the body, keeps the props). Pallet spaces, TEU, payload and volume as
// progress bars with exact numbers beside them.
import type { Utilisation } from "../api/types.ts";

export interface UtilisationSummaryProps {
  utilisation: Utilisation;
}

export default function UtilisationSummary({ utilisation }: UtilisationSummaryProps) {
  return <div data-testid="utilisation">{utilisation.payload_kg.pct} %</div>;
}
