// STUB (B-results replaces the body, keeps the props). One bar per axle group, load vs limit:
// amber near the limit (status "near"), red over it, never colour alone.
import type { AxleLoad, MassScheme } from "../api/types.ts";

export interface AxleLoadPanelProps {
  axleLoads: AxleLoad[];
  massScheme: MassScheme;
}

export default function AxleLoadPanel({ axleLoads }: AxleLoadPanelProps) {
  return <div data-testid="axle-loads">{axleLoads.length} axle groups</div>;
}
