// Progress card while the solve job is queued or running, like the demo's
// SolvingProgress: elapsed time against the solver's time limit.
import { useEffect, useState } from "react";
import type { Schemas } from "../../api/client";

export default function JobProgress({ job, orderCount }: { job: Schemas["JobRead"]; orderCount: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(id);
  }, []);

  const limit = job.time_limit_s ?? 10;
  const started = job.started_at ? Date.parse(job.started_at) : null;
  const elapsed = started ? Math.max(0, (now - started) / 1000) : 0;
  const shown = Math.min(elapsed, limit);
  const queued = job.status === "queued";

  return (
    <section className="card progress-card" aria-label="Optimiser progress">
      <p className="progress-title" role="status">
        {queued
          ? "Waiting for a solver worker…"
          : `Packing ${orderCount} order${orderCount === 1 ? "" : "s"}…`}
      </p>
      <p className="muted small">
        FFD finishes almost instantly. OR-Tools keeps searching until it proves the
        best answer, or stops at the {limit} s limit. This page updates by itself.
      </p>
      <progress
        max={limit}
        value={queued ? undefined : shown}
        aria-label={queued ? "Waiting to start" : "Time used of the solver limit"}
      />
      <p className="small progress-time" aria-hidden="true">
        {queued ? "Queued" : `${shown.toFixed(1)} s of up to ${limit} s`}
      </p>
    </section>
  );
}
