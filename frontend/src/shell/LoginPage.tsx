// Login for all roles. Orchestrator-owned.
import { useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router";
import { HOME_BY_ROLE, useAuth } from "../auth/AuthContext";
import { MOCK_API } from "../api/client";
import { ErrorBox } from "./QueryState";
import "./shell.css";

export default function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  // Only follow same-site relative paths after login.
  const next = params.get("next");
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : null;

  if (user) return <Navigate to={safeNext ?? HOME_BY_ROLE[user.role]} replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const me = await login(email.trim(), password);
      const target = safeNext && safeNext.startsWith(HOME_BY_ROLE[me.role]) ? safeNext : HOME_BY_ROLE[me.role];
      navigate(target, { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-page">
      <form className="card login-card" onSubmit={submit}>
        <h1><span aria-hidden="true">🚚</span> Freight Ops</h1>
        <p className="muted">Sign in as a customer, dispatcher or driver.</p>
        <label className="field">
          <span>E-mail</span>
          <input type="email" autoComplete="username" required value={email}
                 onChange={(e) => setEmail(e.target.value)} autoFocus />
        </label>
        <label className="field">
          <span>Password</span>
          <input type="password" autoComplete="current-password" required value={password}
                 onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error ? <ErrorBox error={error} /> : null}
        <button type="submit" className="primary" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
        {MOCK_API ? (
          <p className="small muted">Mock API: any password. Use an e-mail containing “dispatch” or “driver” for those roles.</p>
        ) : null}
        <p className="small muted"><Link to="/demo">Bin packing demo</Link></p>
      </form>
    </div>
  );
}
