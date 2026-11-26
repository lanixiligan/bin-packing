// /driver/orders/:orderId — One stop: addresses with Maps and phone links,
// the items on this load, notes, and the actions the order allows next.
import { useState } from "react";
import { Link, useLocation, useParams } from "react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, unwrap, type Schemas } from "../../api/client";
import { errorMessage } from "../../api/errors";
import { PageHeader } from "../../shell/AppShell";
import { QueryState } from "../../shell/QueryState";
import { StatusChip } from "../../shell/StatusChip";
import { STATUS_LABEL, formatDate, formatDateTime, formatKg, formatWindow } from "../../shell/format";
import { PodPhoto } from "../../ops/ui";
import AddressBlock from "../AddressBlock";
import { itemCount, plural, useDriverOrder, type DriverOrder } from "../util";

type StatusAction = Schemas["DriverStatusUpdate"]["status"];

export default function DriverOrderPage() {
  const orderId = Number(useParams().orderId);
  const location = useLocation();
  const date = (location.state as { date?: string } | null)?.date;
  const query = useDriverOrder(orderId);
  const back = date ? `/driver/run?date=${date}` : "/driver/run";
  return (
    <>
      <p className="breadcrumb"><Link className="back-link" to={back}>← Run</Link></p>
      <QueryState query={query} loadingLabel="Loading the stop…">
        {(o) => <Stop order={o} back={back} />}
      </QueryState>
    </>
  );
}

function Stop({ order, back }: { order: DriverOrder; back: string }) {
  const qc = useQueryClient();
  const [message, setMessage] = useState("");
  const setStatus = useMutation({
    mutationFn: (body: { status: StatusAction; note?: string | null }) =>
      unwrap(api.POST("/api/driver/orders/{order_id}/status", { params: { path: { order_id: order.order_id } }, body })),
    onMutate: () => setMessage(""),
    onSuccess: (o) => {
      qc.setQueryData(["driver", "order", o.order_id], o);
      void qc.invalidateQueries({ queryKey: ["driver", "run"] });
      setMessage(o.status === "exception"
        ? `Problem reported: ${o.reference} is marked as an exception.`
        : `${o.reference} is now ${STATUS_LABEL[o.status].toLowerCase()}.`);
    },
  });
  const next = order.next_statuses;
  const deliveryLeg = order.status !== "planned";

  return (
    <>
      <PageHeader
        title={<>{order.reference} <StatusChip status={order.status} /></>}
        subtitle={`${order.company_name} · ${formatDate(order.delivery_date)} · ${formatWindow(order.window_start, order.window_end)}`}
      />

      <div role="status" aria-live="polite">
        {message ? <p className="live-msg good">✓ {message}</p> : null}
      </div>

      {next.length ? (
        <section className="card stop-actions" aria-label="Actions">
          {next.includes("picked_up") ? (
            <button type="button" className="tap-button primary big" disabled={setStatus.isPending} onClick={() => setStatus.mutate({ status: "picked_up" })}>
              ✓ Picked up
            </button>
          ) : null}
          {next.includes("in_transit") ? (
            <button type="button" className="tap-button primary big" disabled={setStatus.isPending} onClick={() => setStatus.mutate({ status: "in_transit" })}>
              🚚 In transit
            </button>
          ) : null}
          {next.includes("delivered") ? (
            <Link className="tap-button primary big" to={`/driver/orders/${order.order_id}/pod`} state={{ back }}>
              Deliver → proof of delivery
            </Link>
          ) : null}
          {setStatus.isPending ? <p className="small muted"><span className="spinner" aria-hidden="true" /> Saving…</p> : null}
          {setStatus.error ? <div className="error" role="alert">⚠️ {errorMessage(setStatus.error)}</div> : null}
          {next.includes("exception") ? (
            <ReportProblem
              order={order}
              busy={setStatus.isPending}
              onReport={(note) => setStatus.mutateAsync({ status: "exception", note })}
            />
          ) : null}
        </section>
      ) : null}

      <section className="card" aria-label="Addresses">
        {/* the leg that's next comes first */}
        {deliveryLeg ? (
          <>
            <AddressBlock title="Deliver to" address={order.delivery_address} />
            <AddressBlock title="Picked up from" address={order.pickup_address} />
          </>
        ) : (
          <>
            <AddressBlock title="Pick up from" address={order.pickup_address} />
            <AddressBlock title="Then deliver to" address={order.delivery_address} />
          </>
        )}
      </section>

      <section className="card" aria-labelledby="items-h">
        <h2 id="items-h">Items on your load <span className="muted small">({plural(itemCount(order), "unit")}, {formatKg(order.total_weight_kg)})</span></h2>
        <ul className="item-list">
          {order.lines.map((l, i) => (
            <li key={`${l.item_sku}-${i}`}>
              <span className="item-qty">{l.quantity} ×</span>
              <span>{l.item_name} <span className="small muted">{l.item_sku}</span></span>
            </li>
          ))}
        </ul>
        {order.notes ? (
          <>
            <h3>Notes</h3>
            <p className="order-notes">{order.notes}</p>
          </>
        ) : null}
      </section>

      {order.pods.length ? (
        <section className="card" aria-labelledby="pod-h">
          <h2 id="pod-h">Proof of delivery</h2>
          {order.pods.map((p) => (
            <figure key={p.id} className="pod">
              <PodPhoto url={p.photo_url} alt={`Delivery photo for ${order.reference}`} />
              <figcaption>
                Received by <b>{p.signed_by}</b> · {formatDateTime(p.created_at)}
                {p.note ? <div className="small">“{p.note}”</div> : null}
              </figcaption>
            </figure>
          ))}
        </section>
      ) : null}
    </>
  );
}

/** "Report a problem": a note is required, then a confirmation. */
function ReportProblem({ order, busy, onReport }: {
  order: DriverOrder;
  busy: boolean;
  onReport: (note: string) => Promise<unknown>;
}) {
  const [step, setStep] = useState<"closed" | "note" | "confirm">("closed");
  const [note, setNote] = useState("");
  const [touched, setTouched] = useState(false);
  const missing = !note.trim();

  if (step === "closed") {
    return (
      <button type="button" className="tap-button danger" onClick={() => setStep("note")}>
        ⚠️ Report a problem
      </button>
    );
  }
  if (step === "note") {
    return (
      <form
        className="problem-form"
        onSubmit={(e) => {
          e.preventDefault();
          setTouched(true);
          if (!missing) setStep("confirm");
        }}
      >
        <label className="field" htmlFor="problem-note">
          <span>What went wrong? <span className="hint">(required, the dispatcher and customer see it)</span></span>
          <textarea
            id="problem-note"
            rows={3}
            maxLength={1000}
            value={note}
            // opened on demand: start typing right away
            autoFocus
            aria-invalid={touched && missing ? true : undefined}
            aria-describedby={touched && missing ? "problem-note-err" : undefined}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>
        {touched && missing ? <p id="problem-note-err" className="field-error">Describe the problem.</p> : null}
        <div className="tap-row">
          <button type="submit" className="tap-button danger">Continue</button>
          <button type="button" className="tap-button secondary" onClick={() => setStep("closed")}>Cancel</button>
        </div>
      </form>
    );
  }
  return (
    <div className="confirm-box" role="group" aria-labelledby="problem-q">
      <p id="problem-q" className="confirm-question">
        Mark {order.reference} as an <b>exception</b>? Its delivery stops here and this can't be undone.
      </p>
      <p className="small">“{note.trim()}”</p>
      <div className="tap-row">
        <button
          type="button"
          className="tap-button danger"
          disabled={busy}
          // the confirmation replaces the form, so focus moves to it
          autoFocus
          onClick={async () => {
            try {
              await onReport(note.trim());
              setStep("closed");
              setNote("");
            } catch {
              // the error is shown by the page
            }
          }}
        >
          {busy ? "Reporting…" : "Yes, report the problem"}
        </button>
        <button type="button" className="tap-button secondary" disabled={busy} onClick={() => setStep("note")}>Back</button>
      </div>
    </div>
  );
}
