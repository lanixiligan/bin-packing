// /ops/orders — Orders filtered by status, date, zone and company; accept and reject.
import { Fragment, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api, unwrap, type Schemas } from "../../api/client";
import { errorMessage } from "../../api/errors";
import { PageHeader } from "../../shell/AppShell";
import { Empty, QueryState } from "../../shell/QueryState";
import { StatusChip } from "../../shell/StatusChip";
import { STATUS_LABEL, STATUS_ORDER, formatDate, formatMoney, formatWindow, type OrderStatus } from "../../shell/format";
import { sizeText } from "../format";
import { useCompanies, useInvalidateOps, useZones } from "../queries";
import { RejectForm } from "../RejectForm";
import { LiveStatus, ZoneTag } from "../ui";

type Order = Schemas["OrderSummary"];
const STATUSES = STATUS_ORDER.filter((s) => s !== "draft");

export default function OrderQueuePage() {
  const [params, setParams] = useSearchParams();
  const status = params.get("status") ?? "submitted"; // "" = any status
  const date = params.get("date") ?? "";
  const zone = params.get("zone") ?? "";
  const companyId = params.get("company") ?? "";

  const setFilter = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    next.set(key, value);
    if (!value && key !== "status") next.delete(key);
    setParams(next, { replace: true });
  };

  const query = useQuery({
    queryKey: ["ops", "orders", { status, date, zone, companyId }],
    queryFn: () =>
      unwrap(api.GET("/api/ops/orders", {
        params: {
          query: {
            status: status ? [status as OrderStatus] : undefined,
            delivery_date: date || undefined,
            zone: zone || undefined,
            company_id: companyId ? Number(companyId) : undefined,
          },
        },
      })),
  });
  const zones = useZones();
  const companies = useCompanies();

  const [message, setMessage] = useState<{ text: string; tone: "good" | "bad" } | null>(null);

  return (
    <>
      <PageHeader title="Order queue" subtitle="Accept or reject submitted orders. Accepted orders are batched by delivery date and zone on the Plans page." />

      <form className="toolbar card filters" role="search" aria-label="Filter orders" onSubmit={(e) => e.preventDefault()}>
        <label className="field">
          <span>Status</span>
          <select value={status} onChange={(e) => setFilter("status", e.target.value)}>
            <option value="">Any status</option>
            {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Delivery date</span>
          <input type="date" value={date} onChange={(e) => setFilter("date", e.target.value)} />
        </label>
        <label className="field">
          <span>Zone</span>
          <select value={zone} onChange={(e) => setFilter("zone", e.target.value)}>
            <option value="">Any zone</option>
            <option value="none">No zone (unzoned address)</option>
            {zones.data?.map((z) => <option key={z.code} value={z.code}>{z.code} · {z.name}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Company</span>
          <select value={companyId} onChange={(e) => setFilter("company", e.target.value)}>
            <option value="">Any company</option>
            {companies.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        {(date || zone || companyId || status !== "submitted") && (
          <button type="button" className="secondary" onClick={() => setParams(new URLSearchParams(), { replace: true })}>
            Reset filters
          </button>
        )}
      </form>

      <LiveStatus message={message?.text} tone={message?.tone} />

      <QueryState query={query} loadingLabel="Loading orders…">
        {(orders) => <OrderTable orders={orders} onMessage={setMessage} />}
      </QueryState>
    </>
  );
}

function OrderTable({ orders, onMessage }: { orders: Order[]; onMessage: (m: { text: string; tone: "good" | "bad" }) => void }) {
  const invalidate = useInvalidateOps();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [rejecting, setRejecting] = useState<number | null>(null);
  const [busyIds, setBusyIds] = useState<Set<number>>(new Set());

  const submitted = orders.filter((o) => o.status === "submitted");
  const selectedSubmitted = submitted.filter((o) => selected.has(o.id));
  const allSelected = submitted.length > 0 && selectedSubmitted.length === submitted.length;

  const setBusy = (id: number, on: boolean) =>
    setBusyIds((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  async function accept(o: Order) {
    setBusy(o.id, true);
    try {
      await unwrap(api.POST("/api/ops/orders/{order_id}/accept", { params: { path: { order_id: o.id } }, body: {} }));
      onMessage({ text: `Accepted ${o.reference}.`, tone: "good" });
      setSelected((s) => {
        const next = new Set(s);
        next.delete(o.id);
        return next;
      });
    } catch (e) {
      onMessage({ text: `${o.reference}: ${errorMessage(e)}`, tone: "bad" });
    } finally {
      setBusy(o.id, false);
      void invalidate();
    }
  }

  const bulk = useMutation({
    mutationFn: async (list: Order[]) => {
      const failed: string[] = [];
      for (const o of list) {
        try {
          await unwrap(api.POST("/api/ops/orders/{order_id}/accept", { params: { path: { order_id: o.id } }, body: {} }));
        } catch (e) {
          failed.push(`${o.reference}: ${errorMessage(e)}`);
        }
      }
      return { done: list.length - failed.length, failed };
    },
    onSuccess: ({ done, failed }) => {
      setSelected(new Set());
      onMessage(
        failed.length
          ? { text: `Accepted ${done} order${done === 1 ? "" : "s"}. Not accepted: ${failed.join("; ")}`, tone: "bad" }
          : { text: `Accepted ${done} order${done === 1 ? "" : "s"}.`, tone: "good" },
      );
    },
    onSettled: () => void invalidate(),
  });

  if (!orders.length) return <Empty>No orders match these filters.</Empty>;

  return (
    <div className="card">
      <div className="table-actions">
        <span className="muted small">{orders.length} order{orders.length === 1 ? "" : "s"}</span>
        {submitted.length > 0 && (
          <button
            type="button"
            className="primary"
            disabled={!selectedSubmitted.length || bulk.isPending}
            onClick={() => bulk.mutate(selectedSubmitted)}
          >
            {bulk.isPending ? "Accepting…" : `Accept selected (${selectedSubmitted.length})`}
          </button>
        )}
      </div>
      <div className="table-wrap">
        <table className="table stack orders-table">
          <caption className="sr-only">Orders</caption>
          <thead>
            <tr>
              <th scope="col">
                {submitted.length > 0 ? (
                  <input
                    type="checkbox"
                    aria-label="Select all submitted orders"
                    checked={allSelected}
                    onChange={(e) => setSelected(e.target.checked ? new Set(submitted.map((o) => o.id)) : new Set())}
                  />
                ) : <span className="sr-only">Select</span>}
              </th>
              <th scope="col">Reference</th>
              <th scope="col">Company</th>
              <th scope="col">Delivery</th>
              <th scope="col">Suburb</th>
              <th scope="col">Zone</th>
              <th scope="col">Totals</th>
              <th scope="col" className="num">Amount</th>
              <th scope="col">Status</th>
              <th scope="col"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => (
              <Fragment key={o.id}>
                <tr>
                  <td data-label="Select">
                    {o.status === "submitted" ? (
                      <input
                        type="checkbox"
                        aria-label={`Select ${o.reference}`}
                        checked={selected.has(o.id)}
                        onChange={(e) =>
                          setSelected((s) => {
                            const next = new Set(s);
                            if (e.target.checked) next.add(o.id);
                            else next.delete(o.id);
                            return next;
                          })
                        }
                      />
                    ) : null}
                  </td>
                  <td data-label="Reference">
                    <Link to={`/ops/orders/${o.id}`}><b>{o.reference}</b></Link>
                    {o.customer_reference ? <div className="small muted">{o.customer_reference}</div> : null}
                  </td>
                  <td data-label="Company">{o.company_name}</td>
                  <td data-label="Delivery">
                    {formatDate(o.delivery_date)}
                    <div className="small muted">{formatWindow(o.window_start, o.window_end)}</div>
                  </td>
                  <td data-label="Suburb">{o.delivery_suburb}</td>
                  <td data-label="Zone"><ZoneTag zone={o.zone} /></td>
                  <td data-label="Totals">
                    {sizeText(o.total_weight_kg, o.total_volume_m3, o.total_pallet_spaces)}
                    <div className="small muted">{o.total_units} unit{o.total_units === 1 ? "" : "s"}</div>
                  </td>
                  <td data-label="Amount" className="num">{formatMoney(o.amount)}</td>
                  <td data-label="Status"><StatusChip status={o.status} /></td>
                  <td data-label="Actions">
                    {o.status === "submitted" ? (
                      <div className="row-actions">
                        <button type="button" className="primary" disabled={busyIds.has(o.id)} onClick={() => void accept(o)}>
                          {busyIds.has(o.id) ? "Accepting…" : "Accept"}
                          <span className="sr-only"> {o.reference}</span>
                        </button>
                        <button
                          type="button"
                          className="danger"
                          aria-expanded={rejecting === o.id}
                          aria-controls={`reject-${o.id}`}
                          onClick={() => setRejecting(rejecting === o.id ? null : o.id)}
                        >
                          Reject<span className="sr-only"> {o.reference}</span>
                        </button>
                      </div>
                    ) : null}
                  </td>
                </tr>
                {rejecting === o.id && (
                  <tr className="inline-form-row" id={`reject-${o.id}`}>
                    <td colSpan={10}>
                      <RejectForm
                        order={o}
                        onDone={(text) => {
                          setRejecting(null);
                          onMessage({ text, tone: "good" });
                          void invalidate();
                        }}
                        onCancel={() => setRejecting(null)}
                      />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
