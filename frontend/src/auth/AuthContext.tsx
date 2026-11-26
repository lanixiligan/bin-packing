// Who is logged in. Orchestrator-owned.
//   const { user, login, logout } = useAuth();
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, unwrap, type Schemas } from "../api/client";
import { AUTH_EXPIRED_EVENT, tokenStore } from "../api/token";

export type Me = Schemas["MeRead"];
export type Role = Me["role"];

interface AuthState {
  user: Me | null;
  status: "loading" | "anonymous" | "authenticated";
  login(email: string, password: string): Promise<Me>;
  logout(): void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<Me | null>(null);
  const [status, setStatus] = useState<AuthState["status"]>(() =>
    tokenStore.current() ? "loading" : "anonymous",
  );

  const logout = useCallback(() => {
    const token = tokenStore.current();
    tokenStore.clear();
    setUser(null);
    setStatus("anonymous");
    queryClient.clear();
    if (token) {
      // JWTs can't be revoked server-side; this just tells the backend.
      void api.POST("/api/auth/jwt/logout", { headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
    }
  }, [queryClient]);

  // Restore the session from a saved token.
  useEffect(() => {
    if (!tokenStore.current()) return;
    let cancelled = false;
    unwrap(api.GET("/api/users/me"))
      .then((me) => {
        if (cancelled) return;
        setUser(me);
        setStatus("authenticated");
      })
      .catch(() => {
        if (cancelled) return;
        tokenStore.clear();
        setStatus("anonymous");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onExpired = () => logout();
    window.addEventListener(AUTH_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, onExpired);
  }, [logout]);

  const login = useCallback(async (email: string, password: string) => {
    const token = await unwrap(
      api.POST("/api/auth/jwt/login", {
        body: { username: email, password, grant_type: "password", scope: "" },
        bodySerializer: (b) => new URLSearchParams(b as Record<string, string>),
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      }),
    );
    tokenStore.set(token.access_token);
    queryClient.clear();
    const me = await unwrap(api.GET("/api/users/me"));
    setUser(me);
    setStatus("authenticated");
    return me;
  }, [queryClient]);

  const value = useMemo(() => ({ user, status, login, logout }), [user, status, login, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}

/** The logged-in user inside a role-guarded route (never null there). */
export function useMe(): Me {
  const { user } = useAuth();
  if (!user) throw new Error("useMe used outside a RequireRole route");
  return user;
}

export const HOME_BY_ROLE: Record<Role, string> = {
  customer: "/portal",
  dispatcher: "/ops",
  driver: "/driver",
};
