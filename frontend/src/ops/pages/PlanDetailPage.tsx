// /ops/plans/:planId — One plan through its life: the optimiser's progress,
// FFD vs OR-Tools in the 2D/3D truck views, "Save as draft", then the loads
// (move lines, assign vehicles and drivers), "Lock plan" and "Discard plan".
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, unwrap, type Schemas } from "../../api/client";
import { PageHeader } from "../../shell/AppShell";
import { ErrorBox, Loading, QueryState } from "../../shell/QueryState";
import { formatDate, formatDateTime } from "../../shell/format";
import JobProgress from "../plan/JobProgress";
import LoadEditor from "../plan/LoadEditor";
import LoadsTruckView from "../plan/LoadsTruckView";
import SolveComparison from "../plan/SolveComparison";
import { vehicleLimits } from "../queries";
import { ConfirmAction, ZoneTag } from "../ui";

type Plan = Schemas["PlanRead"];
type JobStatus = Schemas["JobStatus"];

const isDone = (s: JobStatus | undefined) => s === "succeeded" || s === "failed";

export default function PlanDetailPage() {
  const planId = Number(useParams().planId);
  const query = useQuery({
    queryKey: ["ops", "plan", planId],
    queryFn: () => unwrap(api.GET("/api/ops/plans/{plan_id}", { params: { path: { plan_id: planId } } })),
  });
  return (
    <>
      <p className="breadcrumb"><Link to="/ops/plans">← Plans</Link></p>
      <QueryState query={query} loadingLabel="Loading plan…">
        {(plan) => <PlanView plan={plan} />}
      </QueryState>
    </>
  );
}

function PlanView({ plan }: { plan: Plan }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [comparing, setComparing] = useState(false);

  // Poll the job about once a second until it's done.
  const job = useQuery({
    queryKey: ["ops", "job", plan.job_id],
    queryFn: () => unwrap(api.GET("/api/jobs/{job_id}", { params: { path: { job_id: plan.job_id } } })),
    refetchInterval: (q) => (isDone(q.state.data?.status) ? false : 1000),
  });
  const jobStatus = job.data?.status ?? plan.job_status;

  // When the job finishes, the plan's job_status (and the plans list) change too.
  useEffect(() => {
    if (isDone(job.data?.status) && job.data?.status !== plan.job_status) {
      void qc.invalidateQueries({ queryKey: ["ops", "plan", plan.id] });
      void qc.invalidateQueries({ queryKey: ["ops", "plans"] });
    }
  }, [job.data?.status, plan.job_status, plan.id, qc]);

  const hasLoads = plan.loads.length > 0;
  const showComparison = jobStatus === "succeeded" && plan.status === "draft" && (!hasLoads || comparing);
  const result = useQuery({
    queryKey: ["ops", "job-result", plan.job_id],
    queryFn: () => unwrap(api.GET("/api/jobs/{job_id}/result", { params: { path: { job_id: plan.job_id } } })),
    enabled: showComparison,
    staleTime: Infinity,
  });

  const discard = async () => {
    await unwrap(api.DELETE("/api/ops/plans/{plan_id}", { params: { path: { plan_id: plan.id } } }));
    qc.removeQueries({ queryKey: ["ops", "plan", plan.id] });
    void qc.invalidateQueries({ queryKey: ["ops"] });
    navigate("/ops/plans", { replace: true });
  };
  const lock = async () => {
    const p = await unwrap(api.POST("/api/ops/plans/{plan_id}/lock", { params: { path: { plan_id: plan.id } } }));
    qc.setQueryData(["ops", "plan", plan.id], p);
    void qc.invalidateQueries({ queryKey: ["ops"] });
  };

  const overLoads = plan.loads.filter((l) => l.over_capacity).length;
  const locked = plan.status === "locked";
  const n = plan.order_ids.length;

  return (
    <>
      <PageHeader
        title={<>Plan #{plan.id} <span className={`chip plan-${plan.status}`}>{locked ? "🔒 Locked" : "Draft"}</span></>}
        subtitle={
          <>
            {formatDate(plan.delivery_date)} · zone <ZoneTag zone={plan.zone} /> · {n} order{n === 1 ? "" : "s"} ·
            packed for <b>{plan.vehicle.name}</b> ({vehicleLimits(plan.vehicle)})
            {plan.method ? <> · saved from {plan.method === "ortools" ? "OR-Tools" : "FFD"}</> : null}
            {locked && plan.locked_at ? <> · locked {formatDateTime(plan.locked_at)}</> : null}
          </>
        }
        actions={!locked ? (
          <div className="plan-actions">
            {hasLoads ? (
              <ConfirmAction
                label="🔒 Lock plan"
                question={
                  <>
                    Lock plan #{plan.id}? Its {n} order{n === 1 ? "" : "s"} move to “Planned” and the loads can't be edited any
                    more. Vehicles and drivers can still be assigned, and drivers see their loads on their run.
                  </>
                }
                confirmLabel="Yes, lock the plan"
                disabled={overLoads > 0}
                disabledReason={overLoads > 0 ? "A load is over capacity." : undefined}
                onConfirm={lock}
              />
            ) : null}
            <ConfirmAction
              label="Discard plan"
              question={<>Discard plan #{plan.id}? Its {n} order{n === 1 ? "" : "s"} go back to the batch, unplanned. This can't be undone.</>}
              confirmLabel="Yes, discard it"
              danger
              onConfirm={discard}
            />
          </div>
        ) : null}
      />

      {jobStatus === "queued" || jobStatus === "running" ? (
        job.data ? <JobProgress job={job.data} orderCount={n} /> : <Loading label="Checking the optimiser…" />
      ) : null}
      {job.error && !isDone(jobStatus) ? <ErrorBox error={job.error} onRetry={() => void job.refetch()} /> : null}

      {jobStatus === "failed" ? (
        <section className="card" aria-labelledby="failed-h">
          <h2 id="failed-h">The optimiser failed</h2>
          <div className="error" role="alert">⚠️ {job.data?.error ?? "The solve job failed."}</div>
          <p className="muted">Discard the plan to release its orders, then plan the batch again.</p>
        </section>
      ) : null}

      {showComparison ? (
        <>
          {hasLoads ? (
            <div className="compare-head">
              <h2>Optimiser results</h2>
              <button type="button" className="secondary" onClick={() => setComparing(false)}>Back to the loads</button>
            </div>
          ) : null}
          <QueryState query={result} loadingLabel="Loading the optimiser's results…">
            {(r) => <SolveComparison plan={plan} result={r} replacing={hasLoads} onSaved={() => setComparing(false)} />}
          </QueryState>
        </>
      ) : null}

      {hasLoads && !comparing ? (
        <>
          {!locked && jobStatus === "succeeded" ? (
            <p className="small">
              <button type="button" className="link-button" onClick={() => setComparing(true)}>
                Compare the optimiser's results again
              </button>{" "}
              <span className="muted">(saving another method replaces these loads)</span>
            </p>
          ) : null}
          {/* keyed by status: locking resets the editor (messages, open forms) */}
          <LoadEditor key={plan.status} plan={plan} />
          <LoadsTruckView plan={plan} />
        </>
      ) : null}

      {locked && !hasLoads ? <p className="muted">This plan has no loads.</p> : null}
    </>
  );
}
