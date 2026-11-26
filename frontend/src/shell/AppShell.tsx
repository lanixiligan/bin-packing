// Page chrome shared by the three role areas: header, nav, user menu.
// Each area's layout passes its own nav. Orchestrator-owned.
import type { ReactNode } from "react";
import { NavLink, Outlet } from "react-router";
import { useAuth } from "../auth/AuthContext";
import "./shell.css";

export interface NavItem {
  to: string;
  label: string;
  end?: boolean;
}

export function AppShell({ area, nav, variant = "wide", children }: {
  area: string;
  nav: NavItem[];
  /** "narrow" = phone-first single column (driver). */
  variant?: "wide" | "narrow";
  children?: ReactNode;
}) {
  const { user, logout } = useAuth();
  return (
    <div className={`shell shell-${variant}`}>
      <a href="#main" className="skip-link">Skip to content</a>
      <header className="shell-header">
        <div className="shell-brand">
          <span aria-hidden="true">🚚</span> Freight Ops <span className="shell-area">{area}</span>
        </div>
        <nav className="shell-nav" aria-label={`${area} navigation`}>
          {nav.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end}>
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="shell-user">
          <span className="shell-user-name" title={user?.email}>
            {user?.full_name || user?.email}
            {user?.company_name ? <span className="muted"> · {user.company_name}</span> : null}
          </span>
          <button type="button" className="secondary" onClick={logout}>Log out</button>
        </div>
      </header>
      <main id="main" className="shell-main" tabIndex={-1}>
        {children ?? <Outlet />}
      </main>
    </div>
  );
}

/** Title row of a page, with optional actions on the right. */
export function PageHeader({ title, subtitle, actions }: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="page-header">
      <div>
        <h1>{title}</h1>
        {subtitle ? <p className="muted page-subtitle">{subtitle}</p> : null}
      </div>
      {actions ? <div className="page-actions">{actions}</div> : null}
    </div>
  );
}
