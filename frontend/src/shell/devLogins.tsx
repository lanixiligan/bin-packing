// One-click logins for the seed accounts (backend/scripts/seed.py), for the Vite dev
// server only (`npm run dev`, `npm run dev:mock`, `make dev`). LoginPage renders
// <DevQuickLogins> behind `import.meta.env.DEV`, which is the literal `false` in
// production builds, so this whole module (and the known password) is left out.
import type { Role } from "../auth/AuthContext";

export const DEV_PASSWORD = "demo-pass-123";

const DEV_LOGINS: { role: Role; name: string; email: string }[] = [
  { role: "customer", name: "Alice Nguyen", email: "alice@acme.example.com" },
  { role: "customer", name: "Bob Fraser", email: "bob@acme.example.com" },
  { role: "dispatcher", name: "Dana Dispatch", email: "dispatch@freightco.example.com" },
  { role: "driver", name: "Dave Kowalski", email: "driver1@freightco.example.com" },
  { role: "driver", name: "Priya Singh", email: "driver2@freightco.example.com" },
];

const ROLE_LABEL: Record<Role, string> = { customer: "Customer", dispatcher: "Dispatcher", driver: "Driver" };

export function DevQuickLogins({ busy, mock, onPick }: {
  busy: string | null;       // e-mail being signed in, if any
  mock: boolean;
  onPick: (email: string, password: string) => void;
}) {
  return (
    <section className="quick-logins" aria-labelledby="quick-logins-title">
      <h2 id="quick-logins-title">Log in as…</h2>
      <p className="small muted">
        Seed accounts, development only. {mock ? "Mock API." : "If these fail, run make seed."}
      </p>
      <div className="quick-login-list">
        {DEV_LOGINS.map((acct) => (
          <button key={acct.email} type="button" className="quick-login" disabled={busy !== null}
                  onClick={() => onPick(acct.email, DEV_PASSWORD)}>
            <span className={`quick-login-role role-${acct.role}`}>{ROLE_LABEL[acct.role]}</span>
            <span className="quick-login-name">{busy === acct.email ? "Signing in…" : acct.name}</span>
          </button>
        ))}
      </div>
      <p className="quick-login-divider small muted"><span>or sign in with e-mail</span></p>
    </section>
  );
}
