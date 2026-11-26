// Reject an order with a reason (shown to the customer). Used by the order
// queue and the order detail page.
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { api, unwrap } from "../api/client";
import { errorMessage } from "../api/errors";

/** Reject with a reason (shown to the customer). Used by the queue and the order page. */
export function RejectForm({ order, onDone, onCancel }: {
  order: { id: number; reference: string };
  onDone: (message: string) => void;
  onCancel: () => void;
}) {
  const [note, setNote] = useState("");
  const [touched, setTouched] = useState(false);
  const reject = useMutation({
    mutationFn: () =>
      unwrap(api.POST("/api/ops/orders/{order_id}/reject", { params: { path: { order_id: order.id } }, body: { note: note.trim() } })),
    onSuccess: () => onDone(`Rejected ${order.reference}.`),
  });
  const missing = !note.trim();
  const fieldId = `reject-note-${order.id}`;

  return (
    <form
      className="reject-form"
      onSubmit={(e) => {
        e.preventDefault();
        setTouched(true);
        if (!missing) reject.mutate();
      }}
    >
      <label className="field" htmlFor={fieldId}>
        <span>Reason for rejecting {order.reference} <span className="hint">(shown to the customer)</span></span>
      </label>
      <textarea
        id={fieldId}
        rows={2}
        value={note}
        maxLength={1000}
        autoFocus
        aria-invalid={touched && missing ? true : undefined}
        aria-describedby={touched && missing ? `${fieldId}-err` : undefined}
        onChange={(e) => setNote(e.target.value)}
      />
      {touched && missing ? <span id={`${fieldId}-err`} className="field-error">Enter a reason.</span> : null}
      <div className="form-actions">
        <button type="submit" className="danger" disabled={reject.isPending}>{reject.isPending ? "Rejecting…" : "Reject order"}</button>
        <button type="button" className="secondary" onClick={onCancel}>Cancel</button>
      </div>
      {reject.error ? <div className="error" role="alert">⚠️ {errorMessage(reject.error)}</div> : null}
    </form>
  );
}
