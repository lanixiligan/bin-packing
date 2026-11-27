// STUB (B-viz replaces the body, keeps the props). Step 3's drawing: top-down deck view to scale
// (colour by stop / weight / type + legend), side elevation against the height limit, item details
// on hover / tap / focus, and the same placements as a table for screen readers.
import type { PlanRequest, PlanResult, ReferenceData } from "../api/types.ts";

export interface LoadPlanViewProps {
  result: PlanResult;
  reference: ReferenceData;
  /** The request that produced `result` (item labels, stops). */
  request: PlanRequest;
}

export default function LoadPlanView({ result }: LoadPlanViewProps) {
  return <div data-testid="load-plan-view">{result.placements.length} placed</div>;
}
