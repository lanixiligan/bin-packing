// STUB (B-results replaces the body, keeps the props). Warnings grouped by severity, each with what
// is wrong, what to try next, and the freight lines it concerns.
import type { PlanRequest, PlanWarning } from "../api/types.ts";

export interface WarningsListProps {
  warnings: PlanWarning[];
  /** To name the freight lines a warning concerns. */
  request: PlanRequest;
}

export default function WarningsList({ warnings }: WarningsListProps) {
  return <div data-testid="warnings">{warnings.length} warnings</div>;
}
