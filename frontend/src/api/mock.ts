// In-browser mock API, used when VITE_MOCK_API=1 (`npm run dev:mock`).
// Each area registers handlers in its own mocks file (portal/mocks.ts,
// ops/mocks.ts, driver/mocks.ts); api/mocks.ts imports them all.
// Orchestrator-owned.
import type { paths } from "./schema";

export type Method = "get" | "post" | "put" | "patch" | "delete";

export interface MockRequest {
  params: Record<string, string>;
  query: URLSearchParams;
  /** Parsed JSON body, or a FormData for form/multipart bodies. */
  body: unknown;
  request: Request;
  /** Role of the mock token ("customer" | "dispatcher" | "driver"), or null. */
  role: string | null;
}

export interface MockResponse {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
}

type Handler = (req: MockRequest) => MockResponse | Promise<MockResponse>;

interface Route {
  method: Method;
  template: string;
  regex: RegExp;
  keys: string[];
  handler: Handler;
}

const routes: Route[] = [];

/** Register a mock: mock("get", "/api/portal/items/{item_id}", ({ params }) => ({ body: ... })). */
export function mock(method: Method, template: keyof paths & string, handler: Handler) {
  const keys: string[] = [];
  const pattern = template
    .replace(/[.*+?^$()|[\]\\]/g, "\\$&")
    .replace(/\{(\w+)\}/g, (_m, key: string) => {
      keys.push(key);
      return "([^/]+)";
    });
  routes.push({ method, template, regex: new RegExp(`^${pattern}$`), keys, handler });
}

/** Helpers for handler results. */
export const ok = (body: unknown, status = 200): MockResponse => ({ status, body });
export const fail = (status: number, detail: unknown): MockResponse => ({ status, body: { detail } });

const LATENCY_MS = 250;

export async function mockFetch(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const method = request.method.toLowerCase() as Method;
  const route = routes.find((r) => r.method === method && r.regex.test(url.pathname));
  await new Promise((r) => setTimeout(r, LATENCY_MS));
  if (!route) {
    console.warn(`[mock] no handler for ${request.method} ${url.pathname}`);
    return json({ detail: `Mock API: no handler for ${request.method} ${url.pathname}` }, 501);
  }
  const match = route.regex.exec(url.pathname)!;
  const params: Record<string, string> = {};
  route.keys.forEach((k, i) => (params[k] = decodeURIComponent(match[i + 1])));

  let body: unknown = undefined;
  const type = request.headers.get("content-type") ?? "";
  if (type.includes("application/json")) body = await request.json().catch(() => undefined);
  else if (type.includes("form")) body = await request.formData();

  const auth = request.headers.get("authorization") ?? "";
  const role = auth.startsWith("Bearer mock:") ? auth.slice("Bearer mock:".length) : null;

  try {
    const res = await route.handler({ params, query: url.searchParams, body, request, role });
    const status = res.status ?? 200;
    if (status === 204 || res.body === undefined) return new Response(null, { status, headers: res.headers });
    if (typeof res.body === "string" || res.body instanceof Blob) {
      return new Response(res.body, { status, headers: res.headers });
    }
    return json(res.body, status, res.headers);
  } catch (e) {
    console.error("[mock] handler error", e);
    return json({ detail: String(e) }, 500);
  }
}

function json(body: unknown, status: number, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

/** Small id generator for mock records. */
let nextId = 1000;
export const newId = () => ++nextId;
export const nowIso = () => new Date().toISOString();
