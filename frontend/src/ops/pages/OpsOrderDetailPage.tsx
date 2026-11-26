// /ops/orders/:orderId — Order detail for dispatchers: lines, quote, timeline, PODs, accept / reject.
import { useState } from "react";
import { Link, useParams } from "react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api, unwrap, type Schemas } from "../../api/client";
import { errorMessage } from "../../api/errors";
import { PageHeader } from "../../shell/AppShell";
import { QueryState } from "../../shell/QueryState";
import { StatusChip } from "../../shell/StatusChip";
import {
  STATUS_LABEL, formatAddress, formatDate, formatDateTime, formatMoney, formatWindow,
} from "../../shell/format";
import { sizeText } from "../format";
import { useInvalidateOps } from "../queries";
import { RejectForm } from "../RejectForm";
import { LiveStatus, PodPhoto, ZoneTag } from "../ui";

type Order = Schemas["OrderRead"];

export default function OpsOrderDetailPage() {
  const orderId = Number(useParams().orderId);
  const query = useQuery({
    queryKey: ["ops", "order", orderId],
    queryFn: () => unwrap(api.GET("/api/ops/orders/{order_id}", { params: { path: { order_id: orderId } } })),
  });
  return (
    <QueryState query={query} loadingLabel="Loading order…">
      {(order) => <OrderDetail order={order} />}
    </QueryState>
  );
}

function OrderDetail({ order }: { order: Order }) {
  const invalidate = useInvalidateOps();
  const [rejecting, setRejecting] = useState(false);
  const [message, setMessage] = useState("");
  const accept = useMutation({
    mutationFn: () => unwrap(api.POST("/api/ops/orders/{order_id}/accept", { params: { path: { order_id: order.id } }, body: {} })),
    onSuccess: () => setMessage(`Accepted ${order.reference}.`),
    onSettled: () => void invalidate(),
  });

  return (
    <>
      <p className="breadcrumb"><Link to="/ops/orders">← Order queue</Link></p>
      <PageHeader
        title={<>{order.reference} <StatusChip status={order.status} /></>}
        subtitle={`${order.company_name}${order.customer_reference ? ` · their reference ${order.customer_reference}` : ""}`}
        actions={order.status === "submitted" ? (
          <>
            <button type="button" className="primary" disabled={accept.isPending} onClick={() => accept.mutate()}>
              {accept.isPending ? "Accepting…" : "Accept"}
            </button>
            <button type="button" className="danger" aria-expanded={rejecting} onClick={() => setRejecting((r) => !r)}>Reject</button>
          </>
        ) : order.plan_id != null ? (
          <Link className="button-link" to={`/ops/plans/${order.plan_id}`}>Open plan #{order.plan_id}</Link>
        ) : null}
      />
      <LiveStatus message={message} tone="good" />
      {accept.error ? <div className="error" role="alert">⚠️ {errorMessage(accept.error)}</div> : null}
      {rejecting && order.status === "submitted" && (
        <section className="card" aria-label="Reject order">
          <RejectForm
            order={order}
            onDone={(text) => {
              setRejecting(false);
              setMessage(text);
              void invalidate();
            }}
            onCancel={() => setRejecting(false)}
          />
        </section>
      )}

      <div className="detail-grid">
        <section className="card" aria-labelledby="delivery-h">
          <h2 id="delivery-h">Delivery</h2>
          <dl className="facts">
            <dt>Date</dt>
            <dd>{formatDate(order.delivery_date)} · {formatWindow(order.window_start, order.window_end)}</dd>
            <dt>Pick up</dt>
            <dd><AddressBlock a={order.pickup_address} /></dd>
            <dt>Deliver to</dt>
            <dd><AddressBlock a={order.delivery_address} /> <ZoneTag zone={order.zone} /></dd>
            {order.notes ? (<><dt>Notes</dt><dd>{order.notes}</dd></>) : null}
          </dl>
        </section>

        <section className="card" aria-labelledby="quote-h">
          <h2 id="quote-h">Quote</h2>
          {order.quote ? (
            <dl className="facts">
              <dt>Amount</dt>
              <dd><b>{formatMoney(order.quote.amount)}</b>{order.quote.provisional ? <span className="chip warn-chip">Provisional</span> : null}</dd>
              <dt>Zone</dt>
              <dd>{order.quote.zone_code ?? "No zone (default rate)"}</dd>
              <dt>Rate</dt>
              <dd>{formatMoney(order.quote.rate_per_kg)} per kg</dd>
              <dt>Cubic weight</dt>
              <dd>
                {order.quote.cubic_weight_kg.toLocaleString()} kg
                <span className="small muted"> (max of {order.quote.total_weight_kg.toLocaleString()} kg and {order.quote.total_volume_m3.toLocaleString()} m³ × 250)</span>
              </dd>
            </dl>
          ) : <p className="muted">Not quoted yet.</p>}
        </section>
      </div>

      <section className="card" aria-labelledby="lines-h">
        <h2 id="lines-h">Items</h2>
        <div className="table-wrap">
          <table className="table stack">
            <thead>
              <tr>
                <th scope="col">Item</th>
                <th scope="col">SKU</th>
                <th scope="col" className="num">Quantity</th>
                <th scope="col">Per unit</th>
                <th scope="col">Line total</th>
              </tr>
            </thead>
            <tbody>
              {order.lines.map((l) => (
                <tr key={l.id}>
                  <td data-label="Item">{l.item_name}</td>
                  <td data-label="SKU">{l.item_sku}</td>
                  <td data-label="Quantity" className="num">{l.quantity}</td>
                  <td data-label="Per unit">{sizeText(l.unit_weight_kg, l.unit_volume_m3, l.unit_pallet_spaces)}</td>
                  <td data-label="Line total">{sizeText(l.unit_weight_kg * l.quantity, l.unit_volume_m3 * l.quantity, l.unit_pallet_spaces * l.quantity)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" colSpan={2}>Total</th>
                <td className="num" data-label="Units">{order.total_units}</td>
                <td />
                <td data-label="Total"><b>{sizeText(order.total_weight_kg, order.total_volume_m3, order.total_pallet_spaces)}</b></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      <div className="detail-grid">
        <section className="card" aria-labelledby="timeline-h">
          <h2 id="timeline-h">Timeline</h2>
          <ol className="timeline">
            {order.events.map((e) => (
              <li key={e.id}>
                <span className="timeline-status"><b>{STATUS_LABEL[e.to_status]}</b></span>
                <span className="small muted">
                  {" "}· {formatDateTime(e.created_at)}
                  {e.actor_name ? ` · ${e.actor_name}${e.actor_role ? ` (${e.actor_role})` : ""}` : ""}
                </span>
                {e.note ? <div className="timeline-note">“{e.note}”</div> : null}
              </li>
            ))}
          </ol>
        </section>

        {order.pods.length > 0 && (
          <section className="card" aria-labelledby="pod-h">
            <h2 id="pod-h">Proof of delivery</h2>
            {order.pods.map((p) => (
              <figure key={p.id} className="pod">
                <PodPhoto url={p.photo_url} alt={`Delivery photo for ${order.reference}`} />
                <figcaption>
                  Received by <b>{p.signed_by}</b> · {formatDateTime(p.created_at)}
                  {p.driver_name ? ` · driver ${p.driver_name}` : ""}
                  {p.note ? <div className="small">“{p.note}”</div> : null}
                </figcaption>
              </figure>
            ))}
          </section>
        )}
      </div>
    </>
  );
}

function AddressBlock({ a }: { a: Schemas["AddressRead"] }) {
  return (
    <span>
      <b>{a.label}</b>, {formatAddress(a)}
      {a.contact_name || a.phone ? (
        <span className="small muted">
          {" "}· {a.contact_name}{a.phone ? <> · <a href={`tel:${a.phone.replace(/\s+/g, "")}`}>{a.phone}</a></> : null}
        </span>
      ) : null}
    </span>
  );
}
