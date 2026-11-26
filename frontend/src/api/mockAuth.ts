// Mock login for VITE_MOCK_API=1. Any password works; the e-mail picks the role:
//   contains "dispatch" → dispatcher, "driver" → driver, anything else → customer.
// Orchestrator-owned.
import { fail, mock, ok } from "./mock";

const USERS = {
  customer: { id: "00000000-0000-4000-8000-000000000001", email: "alice@acme.example.com", full_name: "Alice Nguyen", role: "customer", company_id: 1, company_name: "Acme Hardware", driver_id: null },
  dispatcher: { id: "00000000-0000-4000-8000-000000000002", email: "dispatch@freightco.example.com", full_name: "Dana Dispatcher", role: "dispatcher", company_id: null, company_name: null, driver_id: null },
  driver: { id: "00000000-0000-4000-8000-000000000003", email: "driver1@freightco.example.com", full_name: "Dave Driver", role: "driver", company_id: null, company_name: null, driver_id: 1 },
} as const;

mock("post", "/api/auth/jwt/login", ({ body }) => {
  const form = body as FormData;
  const email = String(form.get("username") ?? "");
  if (!email) return fail(400, "LOGIN_BAD_CREDENTIALS");
  const role = email.includes("dispatch") ? "dispatcher" : email.includes("driver") ? "driver" : "customer";
  return ok({ access_token: `mock:${role}`, token_type: "bearer" });
});

mock("post", "/api/auth/jwt/logout", () => ({ status: 204 }));

mock("get", "/api/users/me", ({ role }) => {
  if (!role || !(role in USERS)) return fail(401, "Unauthorized");
  return ok({ ...USERS[role as keyof typeof USERS], is_active: true, is_superuser: false, is_verified: false });
});

mock("post", "/api/auth/register", ({ body }) => {
  const b = body as { email: string; full_name: string };
  return ok({ ...USERS.customer, email: b.email, full_name: b.full_name, is_active: true, is_superuser: false, is_verified: false }, 201);
});
