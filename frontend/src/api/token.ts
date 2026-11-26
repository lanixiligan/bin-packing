// Where the JWT lives between page loads. Orchestrator-owned.
const KEY = "freight.token";

export const tokenStore = {
  get(): string | null {
    try {
      return localStorage.getItem(KEY);
    } catch {
      return null;
    }
  },
  set(token: string) {
    try {
      localStorage.setItem(KEY, token);
    } catch {
      /* private mode: token lives only in memory for this tab */
    }
    memory = token;
  },
  clear() {
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
    memory = null;
  },
  current(): string | null {
    return memory ?? tokenStore.get();
  },
};

let memory: string | null = null;

/** Fired on window when the API answers 401: AuthContext logs the user out. */
export const AUTH_EXPIRED_EVENT = "freight:auth-expired";
