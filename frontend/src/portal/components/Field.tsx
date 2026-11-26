// A labelled form field with an optional hint and error, wired up for screen
// readers (aria-invalid, aria-describedby). The child gets the input props:
//   <Field id="sku" label="SKU" error={errors.sku}>{(p) => <input {...p} value=… />}</Field>
import type { ReactNode } from "react";

export interface InputA11yProps {
  id: string;
  "aria-invalid"?: true;
  "aria-describedby"?: string;
}

export function Field({ id, label, hint, error, required, className, children }: {
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  required?: boolean;
  className?: string;
  children: (props: InputA11yProps) => ReactNode;
}) {
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(" ");
  return (
    <div className={`field${error ? " has-error" : ""}${className ? ` ${className}` : ""}`}>
      <label htmlFor={id}>
        {label}
        {required ? <span className="required" aria-hidden="true"> *</span> : null}
      </label>
      {children({ id, "aria-invalid": error ? true : undefined, "aria-describedby": describedBy || undefined })}
      {hint ? <span className="hint" id={`${id}-hint`}>{hint}</span> : null}
      {error ? <span className="field-error" id={`${id}-error`}>{error}</span> : null}
    </div>
  );
}

/** "Please fix N problems" summary shown above a form after a failed attempt. */
export function ErrorSummary({ count, messages }: { count: number; messages?: string[] }) {
  if (count === 0 && !messages?.length) return null;
  return (
    <div className="error" role="alert">
      {count > 0 ? <p className="error-title">Please fix {count === 1 ? "the problem" : `${count} problems`} marked below.</p> : null}
      {messages?.length ? (
        <ul className="error-list">
          {messages.map((m) => <li key={m}>{m}</li>)}
        </ul>
      ) : null}
    </div>
  );
}
