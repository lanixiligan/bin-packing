// Small building blocks shared by the ops pages.
import { useEffect, useId, useState, type ReactNode } from "react";
import { errorMessage } from "../api/errors";
import { fetchBlobUrl, type Schemas } from "../api/client";
import DimBars from "../components/DimBars.jsx";
import { describeUsage, limitedDims, overDims } from "../components/capacity";

/** A polite live region: screen readers announce what changes inside it. */
export function LiveStatus({ message, tone = "info" }: { message: ReactNode; tone?: "info" | "good" | "bad" }) {
  return (
    <div role="status" aria-live="polite" className="live-slot">
      {message ? <div className={`live-msg ${tone}`}>{message}</div> : null}
    </div>
  );
}

/**
 * A button that asks for confirmation inline before running `onConfirm`.
 * Errors from `onConfirm` are shown next to it.
 */
export function ConfirmAction({ label, question, confirmLabel, onConfirm, danger = false, disabled = false, disabledReason }: {
  label: string;
  question: ReactNode;
  confirmLabel: string;
  onConfirm: () => Promise<unknown>;
  danger?: boolean;
  disabled?: boolean;
  disabledReason?: string;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const id = useId();

  if (!open) {
    return (
      <span className="confirm-action">
        <button
          type="button"
          className={danger ? "danger" : "primary"}
          disabled={disabled}
          aria-describedby={disabled && disabledReason ? `${id}-why` : undefined}
          onClick={() => {
            setError(null);
            setOpen(true);
          }}
        >
          {label}
        </button>
        {disabled && disabledReason ? <span id={`${id}-why`} className="small muted">{disabledReason}</span> : null}
      </span>
    );
  }
  return (
    <div className="confirm-box" role="group" aria-labelledby={`${id}-q`}>
      <p id={`${id}-q`} className="confirm-question">{question}</p>
      <div className="confirm-buttons">
        <button
          type="button"
          className={danger ? "danger" : "primary"}
          disabled={busy}
          // the dialog-less confirm gets focus, so keyboard users land on it
          autoFocus
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              await onConfirm();
              setOpen(false);
            } catch (e) {
              setError(e);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Working…" : confirmLabel}
        </button>
        <button type="button" className="secondary" onClick={() => setOpen(false)} disabled={busy}>Cancel</button>
      </div>
      {error ? <div className="error" role="alert">⚠️ {errorMessage(error)}</div> : null}
    </div>
  );
}

/** Fill bars for a load: one per limited dimension, with the numbers for screen readers. */
export function FillBars({ usage, capacity }: { usage: Schemas["Usage"]; capacity: Schemas["Capacity"] }) {
  const over = overDims(usage, capacity);
  return (
    <div className="fill-bars">
      <DimBars usage={usage} cap={capacity} />
      <p className="sr-only">
        {describeUsage(usage, capacity)}
        {over.length ? `. Over capacity in ${over.map((d) => d.label.toLowerCase()).join(" and ")}.` : ""}
      </p>
      <p className="fill-bars-numbers small muted" aria-hidden="true">
        {limitedDims(capacity).map((d) => (
          <span key={d.dim}>
            {d.label}: {d.format(usage[d.field])} / {d.format(capacity[d.field] as number)}
          </span>
        ))}
      </p>
    </div>
  );
}

/** The zone code, or a visible "No zone" marker (text, not just color). */
export function ZoneTag({ zone }: { zone: string | null }) {
  return zone ? <span className="zone-tag">{zone}</span> : <span className="zone-tag none">No zone</span>;
}

/** A POD photo fetched with the bearer token. */
export function PodPhoto({ url, alt }: { url: string; alt: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let revoke: string | null = null;
    let cancelled = false;
    fetchBlobUrl(url)
      .then((u) => {
        if (cancelled) URL.revokeObjectURL(u);
        else {
          revoke = u;
          setSrc(u);
        }
      })
      .catch(() => !cancelled && setError(true));
    return () => {
      cancelled = true;
      if (revoke) URL.revokeObjectURL(revoke);
    };
  }, [url]);
  if (error) return <p className="muted small">The photo couldn't be loaded.</p>;
  if (!src) return <div className="pod-photo placeholder-photo" role="img" aria-label={`${alt} (loading)`} />;
  return <img className="pod-photo" src={src} alt={alt} />;
}
