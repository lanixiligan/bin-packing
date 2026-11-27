// STUB (B-results replaces the body, keeps the props). A friendly empty / error state.
import type { ReactNode } from "react";

export interface EmptyStateProps {
  title: string;
  children?: ReactNode;
  /** e.g. a button to load sample freight or retry. */
  action?: ReactNode;
  tone?: "neutral" | "error";
}

export default function EmptyState({ title, children, action }: EmptyStateProps) {
  return <div data-testid="empty-state"><p>{title}</p>{children}{action}</div>;
}
