// A friendly empty or error state: icon, title, a short body and an optional action, centred.
// The error tone uses the error colours (AA on its soft background) and an alert icon labelled
// "Error", and is announced as an alert when it appears.
import type { ReactNode } from "react";
import { AlertIcon, InfoIcon } from "./icons.tsx";
import "./EmptyState.css";

export interface EmptyStateProps {
  title: string;
  children?: ReactNode;
  /** e.g. a button to load sample freight or retry. */
  action?: ReactNode;
  tone?: "neutral" | "error";
}

export default function EmptyState({ title, children, action, tone = "neutral" }: EmptyStateProps) {
  const error = tone === "error";
  return (
    <div className={`empty-state empty-state--${tone}`} role={error ? "alert" : undefined}
         data-testid="empty-state">
      <span className="empty-state-icon">
        {error ? <AlertIcon size={24} label="Error" /> : <InfoIcon size={24} />}
      </span>
      <h3 className="empty-state-title">{title}</h3>
      {children && <div className="empty-state-body">{children}</div>}
      {action && <div className="empty-state-action">{action}</div>}
    </div>
  );
}
