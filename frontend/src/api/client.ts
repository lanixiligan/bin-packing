// The typed API client. Types come from the backend's OpenAPI schema:
//   make api-types   (or: backend → python -m scripts.export_openapi; npm run api:types)
// Orchestrator-owned.
import createClient, { type Middleware } from "openapi-fetch";
import type { components, paths } from "./schema";
import { ApiError, messageFromDetail } from "./errors";
import { mockFetch } from "./mock";
import { AUTH_EXPIRED_EVENT, tokenStore } from "./token";

/** All API models by name: Schemas["OrderRead"], Schemas["PlanRead"], ... */
export type Schemas = components["schemas"];

export const MOCK_API = import.meta.env.VITE_MOCK_API === "1";

const auth: Middleware = {
  onRequest({ request }) {
    const token = tokenStore.current();
    if (token && !request.headers.has("Authorization")) {
      request.headers.set("Authorization", `Bearer ${token}`);
    }
    return request;
  },
  onResponse({ response, request }) {
    if (response.status === 401 && !request.url.includes("/api/auth/jwt/login")) {
      window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
    }
    return response;
  },
};

export const api = createClient<paths>({
  baseUrl: "",
  fetch: (request: Request) => (MOCK_API ? mockFetch(request) : fetch(request)),
});
api.use(auth);

type Result<T> = { data?: T; error?: unknown; response: Response };

/**
 * Await an openapi-fetch call and return its data, or throw an ApiError with
 * a readable message:
 *   const items = await unwrap(api.GET("/api/portal/items"));
 */
export async function unwrap<T>(call: Promise<Result<T>>): Promise<T> {
  const { data, error, response } = await call;
  if (!response.ok) {
    const detail = (error as { detail?: unknown } | undefined)?.detail ?? error;
    throw new ApiError(response.status, messageFromDetail(detail, response.status), detail);
  }
  return data as T;
}

/**
 * Fetch a protected binary (e.g. a POD photo at PodRead.photo_url) with the
 * bearer token and return an object URL for <img src>. Revoke it when done.
 */
export async function fetchBlobUrl(path: string): Promise<string> {
  const headers: Record<string, string> = {};
  const token = tokenStore.current();
  if (token) headers.Authorization = `Bearer ${token}`;
  const req = new Request(new URL(path, window.location.origin), { headers });
  const res = await (MOCK_API ? mockFetch(req) : fetch(req));
  if (!res.ok) throw new ApiError(res.status, messageFromDetail(undefined, res.status), undefined);
  return URL.createObjectURL(await res.blob());
}

/** Download a protected file (e.g. invoice CSV) with the bearer token. */
export async function downloadFile(path: string, filename: string): Promise<void> {
  const url = await fetchBlobUrl(path);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
