// STUB (B-results replaces the body, keeps the props). The headline: fits yes/no with the reasons,
// the vehicle used (and, in suggest mode, the vehicles tried).
import type { PlanResult, ReferenceData } from "../api/types.ts";

export interface PlanStatusProps {
  result: PlanResult;
  reference: ReferenceData;
}

export default function PlanStatus({ result }: PlanStatusProps) {
  return <div data-testid="plan-status">{result.fits ? "Fits" : "Doesn't fit"}</div>;
}
