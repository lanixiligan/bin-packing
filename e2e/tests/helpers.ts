import { expect, type APIRequestContext } from "@playwright/test";

export const API = process.env.E2E_API_URL ?? "http://localhost:8000";
export const PASSWORD = "demo-pass-123";
export const USERS = {
  customer: "alice@acme.example.com",
  dispatcher: "dispatch@freightco.example.com",
  driver: "driver1@freightco.example.com",
};
const TZ = "Australia/Sydney"; // BUSINESS_TZ

/** "YYYY-MM-DD" in the business timezone, `offsetDays` from today. */
export function businessDate(offsetDays = 0): string {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}
export const businessMonth = () => businessDate().slice(0, 7);

/** A 1×1 PNG, for the proof-of-delivery photo. */
export const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

export async function login(request: APIRequestContext, email: string): Promise<Record<string, string>> {
  const res = await request.post(`${API}/api/auth/jwt/login`, { form: { username: email, password: PASSWORD } });
  expect(res.status(), `login ${email}`).toBe(200);
  const { access_token } = await res.json();
  return { Authorization: `Bearer ${access_token}` };
}

/** JSON call that must succeed with `status`; returns the parsed body. */
export async function call<T = any>(
  request: APIRequestContext,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  headers: Record<string, string>,
  data?: unknown,
  status = 200,
): Promise<T> {
  const res = await request.fetch(`${API}${path}`, { method, headers, data });
  const text = await res.text();
  expect(res.status(), `${method} ${path} → ${text.slice(0, 500)}`).toBe(status);
  return (text && res.headers()["content-type"]?.includes("json") ? JSON.parse(text) : text) as T;
}
