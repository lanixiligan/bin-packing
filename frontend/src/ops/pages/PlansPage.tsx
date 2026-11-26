// /ops/plans — Batches by date + zone, and existing plans.
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { api, unwrap } from "../../api/client";
import { PageHeader } from "../../shell/AppShell";
import { Empty, QueryState } from "../../shell/QueryState";
import { formatDate, formatDateTime, todayIso } from "../../shell/format";
import { sizeText } from "../format";
import { ZoneTag } from "../ui";

const JOB_LABEL = { queued: "Queued", running: "Running", succeeded: "Solved", failed: "Failed" } as const;

export default function PlansPage() {
  const batches = useQuery({
    queryKey: ["ops", "batches", { from: todayIso() }],
    queryFn: () => unwrap(api.GET("/api/ops/batches", { params: { query: { from_date: todayIso() } } })),
  });
  const plans = useQuery({
    queryKey: ["ops", "plans"],
    queryFn: () => unwrap(api.GET("/api/ops/plans")),
    // keep the job column fresh while something is solving
    refetchInterval: (q) => (q.state.data?.some((p) => p.job_status === "queued" || p.job_status === "running") ? 2000 : false),
  });

  return (
    <>
      <PageHeader
        title="Plans"
        subtitle="Accepted orders are grouped by delivery date and zone. Plan a batch to pack it into loads."
        actions={<Link className="button-link primary" to="/ops/plans/new">New plan</Link>}
      />

      <section className="card" aria-labelledby="batches-h">
        <h2 id="batches-h">Batches from today</h2>
        <QueryState query={batches} loadingLabel="Loading batches…">
          {(rows) =>
            !rows.length ? <Empty>No accepted orders waiting. Accept orders in the <Link to="/ops/orders">order queue</Link>.</Empty> : (
              <div className="table-wrap">
                <table className="table stack">
                  <thead>
                    <tr>
                      <th scope="col">Delivery date</th>
                      <th scope="col">Zone</th>
                      <th scope="col" className="num">Unplanned orders</th>
                      <th scope="col">Unplanned totals</th>
                      <th scope="col">Plans</th>
                      <th scope="col"><span className="sr-only">Actions</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((b) => (
                      <tr key={`${b.delivery_date}-${b.zone ?? "none"}`}>
                        <td data-label="Delivery date">{formatDate(b.delivery_date)}</td>
                        <td data-label="Zone">
                          <ZoneTag zone={b.zone} />
                          {b.zone_name ? <span className="small muted"> {b.zone_name}</span> : null}
                        </td>
                        <td data-label="Unplanned orders" className="num">
                          {b.unplanned_orders}
                          {b.planned_orders ? <div className="small muted">{b.planned_orders} in plans</div> : null}
                        </td>
                        <td data-label="Unplanned totals">
                          {b.unplanned_orders ? sizeText(b.total_weight_kg, b.total_volume_m3, b.total_pallet_spaces) : <span className="muted">—</span>}
                        </td>
                        <td data-label="Plans">
                          {b.plan_ids.length ? b.plan_ids.map((id, i) => (
                            <span key={id}>{i > 0 ? ", " : ""}<Link to={`/ops/plans/${id}`}>#{id}</Link></span>
                          )) : <span className="muted">—</span>}
                        </td>
                        <td data-label="Actions">
                          {b.zone == null ? (
                            <Link to="/ops/zones?addresses=none">Set address zones first</Link>
                          ) : b.unplanned_orders > 0 ? (
                            <Link
                              className="button-link primary"
                              to={`/ops/plans/new?date=${b.delivery_date}&zone=${encodeURIComponent(b.zone)}`}
                            >
                              Plan this batch<span className="sr-only">: {b.zone}, {formatDate(b.delivery_date)}</span>
                            </Link>
                          ) : <span className="muted small">All planned</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          }
        </QueryState>
      </section>

      <section className="card" aria-labelledby="plans-h">
        <h2 id="plans-h">All plans</h2>
        <QueryState query={plans} loadingLabel="Loading plans…">
          {(rows) =>
            !rows.length ? <Empty>No plans yet.</Empty> : (
              <div className="table-wrap">
                <table className="table stack">
                  <thead>
                    <tr>
                      <th scope="col">Plan</th>
                      <th scope="col">Delivery date</th>
                      <th scope="col">Zone</th>
                      <th scope="col">Status</th>
                      <th scope="col">Optimiser</th>
                      <th scope="col" className="num">Orders</th>
                      <th scope="col" className="num">Loads</th>
                      <th scope="col">Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((p) => (
                      <tr key={p.id}>
                        <td data-label="Plan"><Link to={`/ops/plans/${p.id}`}><b>Plan #{p.id}</b></Link></td>
                        <td data-label="Delivery date">{formatDate(p.delivery_date)}</td>
                        <td data-label="Zone"><ZoneTag zone={p.zone} /></td>
                        <td data-label="Status">
                          <span className={`chip plan-${p.status}`}>{p.status === "locked" ? "🔒 Locked" : "Draft"}</span>
                        </td>
                        <td data-label="Optimiser">
                          {JOB_LABEL[p.job_status]}
                          {p.method ? <span className="small muted"> · saved {p.method === "ortools" ? "OR-Tools" : "FFD"}</span> : null}
                        </td>
                        <td data-label="Orders" className="num">{p.order_count}</td>
                        <td data-label="Loads" className="num">{p.load_count || <span className="muted">—</span>}</td>
                        <td data-label="Created">{formatDateTime(p.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          }
        </QueryState>
      </section>
    </>
  );
}
