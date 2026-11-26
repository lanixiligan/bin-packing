// A button that asks for confirmation inline (no modal): "Archive" becomes
// "Archive SKU-1? [Yes, archive] [Keep]". Escape or "Keep" backs out and
// returns focus to the original button.
import { useEffect, useRef, useState } from "react";

export function ConfirmButton({ label, question, confirmLabel, keepLabel = "Keep", onConfirm, busy, accessibleLabel, className = "danger" }: {
  label: string;
  question: string;
  confirmLabel: string;
  keepLabel?: string;
  onConfirm: () => unknown;
  busy?: boolean;
  /** Longer label for screen readers when `label` alone is ambiguous in a list. */
  accessibleLabel?: string;
  className?: string;
}) {
  const [asking, setAsking] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);

  useEffect(() => {
    if (!asking && restoreFocus.current) {
      restoreFocus.current = false;
      triggerRef.current?.focus();
    }
  }, [asking]);

  const back = () => {
    restoreFocus.current = true;
    setAsking(false);
  };

  if (!asking) {
    return (
      <button ref={triggerRef} type="button" className={className} aria-label={accessibleLabel} onClick={() => setAsking(true)}>
        {label}
      </button>
    );
  }
  return (
    <span className="confirm" role="group" aria-label={question} onKeyDown={(e) => e.key === "Escape" && back()}>
      <span className="confirm-question">{question}</span>
      <button type="button" className="danger" autoFocus disabled={busy} onClick={() => void onConfirm()}>
        {busy ? "Working…" : confirmLabel}
      </button>
      <button type="button" className="secondary" disabled={busy} onClick={back}>{keepLabel}</button>
    </span>
  );
}
