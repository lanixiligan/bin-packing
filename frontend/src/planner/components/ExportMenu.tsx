// STUB (B-results replaces the body, keeps the props). Export the load plan as CSV and as a print
// view (the browser's print dialog saves PDF).
import type { PlanRequest, PlanResult, ReferenceData } from "../api/types.ts";

export interface ExportMenuProps {
  result: PlanResult;
  request: PlanRequest;
  reference: ReferenceData;
}

export default function ExportMenu(_props: ExportMenuProps) {
  return <div data-testid="export-menu" />;
}
