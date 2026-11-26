// /portal/orders: the customer's orders with status chips and filters. The
// filters live in the URL (?group=active&from=…&to=…&q=…) so Back works.
import { useId, useMemo } from "react";
import { Link, useSearchParams } from "react-router";
import { PageHeader } from "../../shell/AppShell";
import { Empty, QueryState } from "../../shell/QueryState";
import { StatusChip } from "../../shell/StatusChip";
import { formatDate, formatKg, formatMoney, formatPallets, formatWindow } from "../../shell/format";
import { formatVolume, STATUS_GROUPS, isStatusGroup, matchesSearch, statusesForGroup } from "../logic";
import { useOrders } from "../queries";

export default function OrdersPage() {
  const uid = useId();
  const [params, setParams] = useSearchParams();
  const groupParam = params.get("group");
  const group = isStatusGroup(groupParam) ? groupParam : "all";
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  const search = params.get("q") ?? "";
  const filters = useMemo(() => ({ statuses: statusesForGroup(group), from, to }), [group, from, to]);
  const rangeInvalid = Boolean(from && to && from > to);
  const query = useOrders(rangeInvalid ? { ...filters, to: "" } : filters);

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value && !(key === "group" && value === "all")) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };
  const filtered = Boolean(group !== "all" || from || to || search);
  const id = (k: string) => `${uid}-${k}`;

  return (
    <>
      <PageHeader
        title="Orders"
        subtitle="Your delivery orders, newest first."
        actions={<Link to="/portal/orders/new" className="button-link primary">New order</Link>}
      />

      <section className="card" aria-label="Order filters">
        <div className="toolbar filters">
          <div className="field grow">
            <label htmlFor={id("q")}>Search</label>
            <input id={id("q")} type="search" placeholder="Order number or your reference" value={search}
                   onChange={(e) => setParam("q", e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor={id("group")}>Status</label>
            <select id={id("group")} value={group} onChange={(e) => setParam("group", e.target.value)}>
              {STATUS_GROUPS.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor={id("from")}>Delivery from</label>
            <input id={id("from")} type="date" value={from} max={to || undefined} onChange={(e) => setParam("from", e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor={id("to")}>Delivery to</label>
            <input id={id("to")} type="date" value={to} min={from || undefined}
                   aria-invalid={rangeInvalid ? true : undefined} aria-describedby={rangeInvalid ? id("to-err") : undefined}
                   onChange={(e) => setParam("to", e.target.value)} />
          </div>
          {filtered ? (
            <button type="button" className="secondary" onClick={() => setParams(new URLSearchParams(), { replace: true })}>Clear filters</button>
          ) : null}
        </div>
        {rangeInvalid ? <p className="field-error" id={id("to-err")}>The “to” date is before the “from” date, so it’s ignored.</p> : null}
      </section>

      <QueryState query={query} loadingLabel="Loading orders…">
        {(orders) => {
          const rows = orders.filter((o) => matchesSearch(o, search));
          return (
            <section className="card" aria-labelledby={id("list")}>
              <h2 id={id("list")} className="card-title">
                {STATUS_GROUPS.find((g) => g.value === group)?.label}
              </h2>
              <p className="muted small" role="status" aria-live="polite">
                {rows.length} order{rows.length === 1 ? "" : "s"}{filtered ? " match your filters" : ""}
                {query.isFetching ? " · updating…" : ""}
              </p>
              {rows.length === 0 ? (
                filtered ? <Empty>No orders match. Try clearing the filters.</Empty> : (
                  <Empty>No orders yet. <Link to="/portal/orders/new">Create your first order</Link>.</Empty>
                )
              ) : (
                <div className="table-wrap">
                  <table className="table stack orders-table">
                    <thead>
                      <tr>
                        <th scope="col">Order</th>
                        <th scope="col">Status</th>
                        <th scope="col">Delivery</th>
                        <th scope="col">Route</th>
                        <th scope="col" className="num">Load</th>
                        <th scope="col" className="num">Price</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((o) => (
                        <tr key={o.id}>
                          <td data-label="Order">
                            <span>
                              <Link to={`/portal/orders/${o.id}`} className="order-link">{o.reference}</Link>
                              {o.customer_reference ? <span className="cell-sub muted small">Ref {o.customer_reference}</span> : null}
                            </span>
                          </td>
                          <td data-label="Status"><StatusChip status={o.status} /></td>
                          <td data-label="Delivery">
                            <span>
                              {formatDate(o.delivery_date)}
                              <span className="cell-sub muted small">{formatWindow(o.window_start, o.window_end)}</span>
                            </span>
                          </td>
                          <td data-label="Route">
                            <span>
                              {o.pickup_label} <span aria-hidden="true">→</span><span className="visually-hidden">to</span> {o.delivery_label}
                              <span className="cell-sub muted small">{o.delivery_suburb}{o.zone ? ` · zone ${o.zone}` : " · not zoned"}</span>
                            </span>
                          </td>
                          <td data-label="Load" className="num">
                            <span>
                              {formatKg(o.total_weight_kg)}
                              <span className="cell-sub muted small">{formatVolume(o.total_volume_m3)} · {formatPallets(o.total_pallet_spaces)}</span>
                            </span>
                          </td>
                          <td data-label="Price" className="num">{o.amount != null ? formatMoney(o.amount) : <span className="muted">Not quoted yet</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          );
        }}
      </QueryState>
    </>
  );
}
