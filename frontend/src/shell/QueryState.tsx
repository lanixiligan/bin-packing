// Loading / error / empty states. Orchestrator-owned.
import type { ReactNode } from "react";
import { errorMessage } from "../api/errors";

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="state state-loading" role="status">
      <span className="spinner" aria-hidden="true" /> {label}
    </div>
  );
}

export function ErrorBox({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div className="error" role="alert">
      ⚠️ {errorMessage(error)}
      {onRetry ? (
        <>
          {" "}
          <button type="button" className="link-button" onClick={onRetry}>Try again</button>
        </>
      ) : null}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="state state-empty muted">{children}</div>;
}

/** Render a TanStack Query result: spinner, error with retry, or children(data). */
export function QueryState<T>({ query, children, loadingLabel }: {
  query: { data: T | undefined; error: unknown; isPending: boolean; refetch: () => unknown };
  children: (data: T) => ReactNode;
  loadingLabel?: string;
}) {
  if (query.isPending) return <Loading label={loadingLabel} />;
  if (query.error) return <ErrorBox error={query.error} onRetry={() => void query.refetch()} />;
  return <>{children(query.data as T)}</>;
}
