// /portal/orders/:orderId: an order with its addresses, lines, quote, event
// timeline and proof of delivery, plus the actions its status allows.
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Link, useLocation, useNavigate, useParams } from "react-router";
import { api, unwrap } from "../../api/client";
import { PageHeader } from "../../shell/AppShell";
import { ErrorBox, QueryState } from "../../shell/QueryState";
import { StatusChip } from "../../shell/StatusChip";
import { formatDate, formatDateTime, formatKg, formatMoney, formatPallets, formatWindow } from "../../shell/format";
import { ConfirmButton } from "../components/ConfirmButton";
import { AddressBlock, Notice, OrderTimeline, PodCard, QuoteDetails, TotalsRow } from "../components/OrderParts";
import { formatVolume, canCancel, canEdit, canSubmit, lastEventTo, orderLineTotals } from "../logic";
import { useOrder, useOrderSaved, useQuotePreview } from "../queries";
import type { Order } from "../types";

export default function OrderDetailPage() {
  const { orderId } = useParams();
  const id = orderId && /^\d+$/.test(orderId) ? Number(orderId) : null;
  const query = useOrder(id);
  const location = useLocation();
  const flash = (location.state as { flash?: string } | null)?.flash ?? null;

  if (id == null) return <Notice tone="bad" title="Order not found." role="alert"><Link to="/portal/orders">Back to orders</Link></Notice>;
  return (
    <>
      <p className="back-link"><Link to="/portal/orders">← All orders</Link></p>
      <QueryState query={query} loadingLabel="Loading the order…">
        {(order) => <OrderDetail order={order} flash={flash} />}
      </QueryState>
    </>
  );
}

function OrderDetail({ order, flash }: { order: Order; flash: string | null }) {
  const navigate = useNavigate();
  const orderSaved = useOrderSaved();
  const [message, setMessage] = useState<string>(flash ?? "");

  const submit = useMutation({
    mutationFn: () => unwrap(api.POST("/api/portal/orders/{order_id}/submit", { params: { path: { order_id: order.id } } })),
    onSuccess: (o) => {
      orderSaved(o);
      setMessage(`Order submitted.${o.quote ? ` Quoted price: ${formatMoney(o.quote.amount)}${o.quote.provisional ? " (provisional)" : ""}.` : ""}`);
    },
  });
  const cancel = useMutation({
    mutationFn: () => unwrap(api.POST("/api/portal/orders/{order_id}/cancel", { params: { path: { order_id: order.id } } })),
    onSuccess: (o) => {
      orderSaved(o);
      setMessage("Order cancelled.");
    },
  });

  const rejection = order.status === "rejected" ? lastEventTo(order.events, "rejected") : undefined;
  const problem = order.status === "exception" ? lastEventTo(order.events, "exception") : undefined;
  const cancellation = order.status === "cancelled" ? lastEventTo(order.events, "cancelled") : undefined;
  const totals = orderLineTotals(order);
  const busy = submit.isPending || cancel.isPending;

  const actions = (
    <>
      {canEdit(order.status) ? <Link to={`/portal/orders/${order.id}/edit`} className="button-link">Edit</Link> : null}
      {canSubmit(order.status) ? (
        <button type="button" className="primary" disabled={busy} onClick={() => submit.mutate()}>
          {submit.isPending ? "Submitting…" : "Submit order"}
        </button>
      ) : null}
      {canCancel(order.status) ? (
        <ConfirmButton
          label="Cancel order"
          question={`Cancel ${order.reference}? This can’t be undone.`}
          confirmLabel="Yes, cancel it"
          keepLabel="Keep order"
          busy={cancel.isPending}
          onConfirm={() => cancel.mutate()}
        />
      ) : null}
      {order.status === "rejected" || order.status === "cancelled" ? (
        <button type="button" className="secondary" onClick={() => navigate(`/portal/orders/new?from=${order.id}`)}>Copy to a new order</button>
      ) : null}
    </>
  );

  return (
    <>
      <PageHeader
        title={<span className="title-with-chip">{order.reference} <StatusChip status={order.status} /></span>}
        subtitle={<>
          {order.customer_reference ? <>Your reference {order.customer_reference} · </> : null}
          Created {formatDateTime(order.created_at)}
          {order.submitted_at ? <> · submitted {formatDateTime(order.submitted_at)}</> : null}
        </>}
        actions={actions}
      />

      <div role="status" aria-live="polite">{message ? <Notice tone="good">{message}</Notice> : null}</div>
      {submit.error ? <ErrorBox error={submit.error} /> : null}
      {cancel.error ? <ErrorBox error={cancel.error} /> : null}

      {order.status === "rejected" ? (
        <Notice tone="bad" title="Dispatch rejected this order" role="note">
          <p className="reason"><strong>Reason:</strong> {rejection?.note ?? "No reason was given."}</p>
          <p className="small">
            {rejection ? <>Rejected by {rejection.actor_name ?? "dispatch"} on {formatDateTime(rejection.created_at)}. </> : null}
            You can copy it to a new order, fix it and submit again.
          </p>
        </Notice>
      ) : null}
      {order.status === "exception" ? (
        <Notice tone="bad" title="There was a problem with this delivery" role="note">
          <p className="reason">{problem?.note ?? "The driver reported a problem."}</p>
          <p className="small">Dispatch will contact you to arrange the next step.</p>
        </Notice>
      ) : null}
      {order.status === "cancelled" && cancellation?.note ? (
        <Notice tone="info" title="Cancelled" role="note"><p className="reason">{cancellation.note}</p></Notice>
      ) : null}
      {order.status === "draft" ? (
        <Notice tone="info" title="This order is a draft." role="note">Dispatch won’t see it until you submit it.</Notice>
      ) : null}

      <div className="detail-grid">
        <div className="detail-main">
          <section className="card" aria-labelledby="route-h">
            <h2 id="route-h" className="card-title">Route and timing</h2>
            <div className="route">
              <AddressBlock address={order.pickup_address} heading="Pickup" />
              <AddressBlock address={order.delivery_address} heading="Delivery" />
            </div>
            <dl className="facts">
              <div><dt>Delivery date</dt><dd>{formatDate(order.delivery_date)}</dd></div>
              <div><dt>Window</dt><dd>{formatWindow(order.window_start, order.window_end)}</dd></div>
              {order.delivered_at ? <div><dt>Delivered</dt><dd>{formatDateTime(order.delivered_at)}</dd></div> : null}
              {order.notes ? <div className="facts-wide"><dt>Notes</dt><dd>{order.notes}</dd></div> : null}
            </dl>
          </section>

          <section className="card" aria-labelledby="lines-h">
            <h2 id="lines-h" className="card-title">Items</h2>
            <div className="table-wrap">
              <table className="table stack">
                <thead>
                  <tr>
                    <th scope="col">Item</th>
                    <th scope="col" className="num">Qty</th>
                    <th scope="col" className="num">Weight</th>
                    <th scope="col" className="num">Volume</th>
                    <th scope="col" className="num">Pallets</th>
                  </tr>
                </thead>
                <tbody>
                  {order.lines.map((l) => (
                    <tr key={l.id}>
                      <td data-label="Item"><span><code>{l.item_sku}</code> {l.item_name}</span></td>
                      <td data-label="Qty" className="num">{l.quantity.toLocaleString()}</td>
                      <td data-label="Weight" className="num">{formatKg(l.unit_weight_kg * l.quantity)}</td>
                      <td data-label="Volume" className="num">{formatVolume(l.unit_volume_m3 * l.quantity)}</td>
                      <td data-label="Pallets" className="num">{formatPallets(l.unit_pallet_spaces * l.quantity)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <TotalsRow totals={totals} label="Order totals" />
          </section>

          {order.pods.length ? (
            <section className="card" aria-labelledby="pod-h">
              <h2 id="pod-h" className="card-title">Proof of delivery</h2>
              {order.pods.map((p) => <PodCard key={p.id} pod={p} />)}
            </section>
          ) : null}
        </div>

        <div className="detail-side">
          <section className="card" aria-labelledby="price-h">
            <h2 id="price-h" className="card-title">Price</h2>
            {order.quote ? <QuoteDetails quote={order.quote} stored /> : order.status === "draft" ? <DraftEstimate order={order} /> : (
              <p className="muted">This order was never priced.</p>
            )}
          </section>
          <section className="card" aria-labelledby="timeline-h">
            <h2 id="timeline-h" className="card-title">History</h2>
            <OrderTimeline events={order.events} />
          </section>
        </div>
      </div>
    </>
  );
}

/** For a draft: what it would cost if submitted now. */
function DraftEstimate({ order }: { order: Order }) {
  const quote = useQuotePreview(order.lines.length ? {
    delivery_address_id: order.delivery_address.id,
    lines: order.lines.map((l) => ({ item_id: l.item_id, quantity: l.quantity })),
  } : null);
  return (
    <div role="status" aria-live="polite">
      {quote.isPending ? <p className="muted small">Working out the price…</p> : quote.error ? <ErrorBox error={quote.error} /> : (
        <>
          <QuoteDetails quote={quote.data} stored={false} />
          <p className="small muted">The price is fixed when you submit.</p>
        </>
      )}
    </div>
  );
}
