// Route guard: only `role` may see the children. Orchestrator-owned.
import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router";
import { HOME_BY_ROLE, useAuth, type Role } from "./AuthContext";
import { Loading } from "../shell/QueryState";

export function RequireRole({ role, children }: { role: Role; children: ReactNode }) {
  const { user, status } = useAuth();
  const location = useLocation();
  if (status === "loading") return <Loading label="Signing you in…" />;
  if (!user) {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?next=${next}`} replace />;
  }
  if (user.role !== role) return <Navigate to={HOME_BY_ROLE[user.role]} replace />;
  return <>{children}</>;
}
