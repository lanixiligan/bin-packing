// Mock handlers for the ops and jobs APIs (used only with VITE_MOCK_API=1).
// The data lives in ./mockDb.ts, shared with the driver mocks. Handlers check
// the role like the real API (401 without a token, 403 for other roles) and
// answer errors in the same shapes (string detail, validation list, or the
// InfeasibleDetail object of POST /api/ops/plans).
import { fail, mock, ok, type Method, type MockRequest, type MockResponse } from "../api/mock.ts";
import type { Schemas } from "../api/client";
import type { paths } from "../api/schema";
import {
  MockHttpError, createPlan, db, discardPlan, httpError, invoice, invoiceCsv, job,
  jobRead, jobStatus, lockPlan, moveLine, nextId, opsAddress, order, orderRead, orderSummary, plan, planRead,
  planSummary, saveDraft, setLineApproval, transition, updateLoad, validationError, actors, driverRead, address,
} from "./mockDb.ts";

type Handler = (req: MockRequest) => MockResponse | Promise<MockResponse>;

/** Role check + MockHttpError → error response. Exported for the driver mocks. */
export function guarded(role: "dispatcher" | "driver" | "any", handler: Handler): Handler {
  return async (req) => {
    if (!req.role) return fail(401, "Unauthorized");
    if (role !== "any" && req.role !== role) return fail(403, "Forbidden");
    try {
      return await handler(req);
    } catch (e) {
      if (e instanceof MockHttpError) return fail(e.status, e.detail);
      throw e;
    }
  };
}

const ops = (method: Method, path: keyof paths & string, handler: Handler) =>
  mock(method, path, guarded("dispatcher", handler));

const json = <T>(req: MockRequest) => (req.body ?? {}) as T;
const intParam = (v: string) => {
  const n = Number(v);
  if (!Number.isInteger(n)) throw validationError("Input should be a valid integer", ["path"]);
  return n;
};
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
function monthParam(req: MockRequest) {
  const m = req.query.get("month") ?? "";
  if (!MONTH_RE.test(m)) throw validationError(`String should match pattern '^\\d{4}-(0[1-9]|1[0-2])$'`, ["query", "month"]);
  return m;
}
const nowIso = () => new Date().toISOString();

// ---- Order queue -------------------------------------------------------------

ops("get", "/api/ops/orders", ({ query }) => {
  const statuses = query.getAll("status");
  const date = query.get("delivery_date");
  const zone = query.get("zone");
  const companyId = query.get("company_id");
  const limit = Math.min(500, Number(query.get("limit") ?? 200));
  const offset = Number(query.get("offset") ?? 0);
  const rows = db.orders
    .filter((o) => o.status !== "draft")
    .filter((o) => !statuses.length || statuses.includes(o.status))
    .filter((o) => !date || o.delivery_date === date)
    .filter((o) => {
      if (!zone) return true;
      const z = address(o.delivery_address_id).zone;
      return zone === "none" ? z == null : z === zone;
    })
    .filter((o) => !companyId || o.company_id === Number(companyId))
    .sort((a, b) => a.delivery_date.localeCompare(b.delivery_date) || a.id - b.id)
    .slice(offset, offset + limit)
    .map(orderSummary);
  return ok(rows);
});

ops("get", "/api/ops/orders/{order_id}", ({ params }) => {
  const o = order(intParam(params.order_id));
  if (o.status === "draft") throw httpError(404, "Order not found.");
  return ok(orderRead(o));
});

ops("post", "/api/ops/orders/{order_id}/accept", (req) => {
  const o = order(intParam(req.params.order_id));
  if (o.status === "draft") throw httpError(404, "Order not found.");
  transition(o, "accepted", actors.dispatcher, json<{ note?: string | null }>(req).note ?? null);
  return ok(orderRead(o));
});

ops("post", "/api/ops/orders/{order_id}/reject", (req) => {
  const o = order(intParam(req.params.order_id));
  if (o.status === "draft") throw httpError(404, "Order not found.");
  const note = json<{ note?: string }>(req).note?.trim();
  if (!note) throw validationError("String should have at least 1 character", ["body", "note"]);
  transition(o, "rejected", actors.dispatcher, note);
  return ok(orderRead(o));
});

ops("get", "/api/ops/batches", ({ query }) => {
  const from = query.get("from_date");
  const to = query.get("to_date");
  const groups = new Map<string, Schemas["BatchSummary"]>();
  for (const o of db.orders) {
    if (o.status !== "accepted" && o.status !== "planned") continue;
    if ((from && o.delivery_date < from) || (to && o.delivery_date > to)) continue;
    const zone = address(o.delivery_address_id).zone;
    const key = `${o.delivery_date}|${zone ?? ""}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        delivery_date: o.delivery_date, zone, zone_name: db.zones.find((z) => z.code === zone)?.name ?? null,
        unplanned_orders: 0, planned_orders: 0, total_weight_kg: 0, total_volume_m3: 0, total_pallet_spaces: 0, plan_ids: [],
      };
      groups.set(key, g);
    }
    if (o.plan_id == null) {
      const s = orderSummary(o);
      g.unplanned_orders += 1;
      g.total_weight_kg = Math.round((g.total_weight_kg + s.total_weight_kg) * 100) / 100;
      g.total_volume_m3 = Math.round((g.total_volume_m3 + s.total_volume_m3) * 100) / 100;
      g.total_pallet_spaces = Math.round((g.total_pallet_spaces + s.total_pallet_spaces) * 100) / 100;
    } else {
      g.planned_orders += 1;
      if (!g.plan_ids.includes(o.plan_id)) g.plan_ids.push(o.plan_id);
    }
  }
  return ok([...groups.values()].sort((a, b) => a.delivery_date.localeCompare(b.delivery_date) || (a.zone ?? "~").localeCompare(b.zone ?? "~")));
});

// ---- Zones and addresses -----------------------------------------------------------

function checkRate(v: unknown): string {
  const n = Number(v);
  if (!(n > 0)) throw validationError("Input should be greater than 0", ["body", "rate_per_kg"]);
  return n.toFixed(4);
}

ops("get", "/api/ops/zones", () => ok([...db.zones].sort((a, b) => a.code.localeCompare(b.code))));

ops("post", "/api/ops/zones", (req) => {
  const b = json<{ code?: string; name?: string; rate_per_kg?: unknown }>(req);
  const code = (b.code ?? "").trim().toUpperCase();
  if (!/^[A-Z0-9_-]{1,32}$/.test(code)) throw validationError("Value error, Zone code must be 1-32 characters: A-Z, 0-9, '_' or '-'.", ["body", "code"]);
  if (!b.name?.trim()) throw validationError("String should have at least 1 character", ["body", "name"]);
  if (db.zones.some((z) => z.code === code)) throw httpError(409, `Zone ${code} already exists.`);
  const zone: Schemas["ZoneRead"] = { code, name: b.name.trim(), rate_per_kg: checkRate(b.rate_per_kg), active: true, created_at: nowIso() };
  db.zones.push(zone);
  return ok(zone, 201);
});

ops("patch", "/api/ops/zones/{code}", (req) => {
  const zone = db.zones.find((z) => z.code === req.params.code);
  if (!zone) throw httpError(404, "Zone not found.");
  const b = json<{ name?: string; rate_per_kg?: unknown; active?: boolean }>(req);
  if (b.name !== undefined) {
    if (!b.name?.trim()) throw validationError("String should have at least 1 character", ["body", "name"]);
    zone.name = b.name.trim();
  }
  if (b.rate_per_kg !== undefined) zone.rate_per_kg = checkRate(b.rate_per_kg);
  if (b.active !== undefined) zone.active = !!b.active;
  return ok(zone);
});

ops("get", "/api/ops/addresses", ({ query }) => {
  const zone = query.get("zone");
  const companyId = query.get("company_id");
  return ok(
    db.addresses
      .filter((a) => !a.archived)
      .filter((a) => !zone || (zone === "none" ? a.zone == null : a.zone === zone))
      .filter((a) => !companyId || a.company_id === Number(companyId))
      .map(opsAddress),
  );
});

ops("patch", "/api/ops/addresses/{address_id}", (req) => {
  const a = address(intParam(req.params.address_id));
  const { zone } = json<{ zone?: string | null }>(req);
  if (zone === undefined) throw validationError("Field required", ["body", "zone"]);
  if (zone !== null) {
    const z = db.zones.find((x) => x.code === zone);
    if (!z) throw httpError(422, `Zone ${zone} doesn't exist.`);
    if (!z.active) throw httpError(422, `Zone ${zone} is inactive.`);
  }
  a.zone = zone;
  return ok(opsAddress(a));
});

// ---- Fleet ---------------------------------------------------------------------------

type VehicleBody = Partial<Pick<Schemas["VehicleRead"], "name" | "registration" | "max_weight_kg" | "max_volume_m3" | "max_pallets" | "active">>;

function checkVehicle(v: VehicleBody) {
  if (!v.name?.trim()) throw validationError("String should have at least 1 character", ["body", "name"]);
  if (!v.registration?.trim()) throw validationError("String should have at least 1 character", ["body", "registration"]);
  for (const f of ["max_weight_kg", "max_volume_m3", "max_pallets"] as const) {
    const x = v[f];
    if (x != null && !(x > 0)) throw validationError("Input should be greater than 0", ["body", f]);
  }
  if (v.max_pallets != null && !Number.isInteger(v.max_pallets)) {
    throw validationError("Input should be a valid integer", ["body", "max_pallets"]);
  }
  if (v.max_weight_kg == null && v.max_volume_m3 == null && v.max_pallets == null) {
    throw validationError("Value error, Set at least one capacity: weight, volume or pallets.");
  }
}

ops("get", "/api/ops/vehicles", ({ query }) => {
  const all = query.get("include_inactive") === "true";
  return ok(db.vehicles.filter((v) => all || v.active));
});

ops("post", "/api/ops/vehicles", (req) => {
  const b = json<VehicleBody>(req);
  checkVehicle(b);
  const v: Schemas["VehicleRead"] = {
    id: nextId(), name: b.name!.trim(), registration: b.registration!.trim().toUpperCase(),
    max_weight_kg: b.max_weight_kg ?? null, max_volume_m3: b.max_volume_m3 ?? null, max_pallets: b.max_pallets ?? null,
    active: b.active ?? true, created_at: nowIso(),
  };
  db.vehicles.push(v);
  return ok(v, 201);
});

ops("patch", "/api/ops/vehicles/{vehicle_id}", (req) => {
  const v = db.vehicles.find((x) => x.id === intParam(req.params.vehicle_id));
  if (!v) throw httpError(404, "Vehicle not found.");
  const next = { ...v, ...json<VehicleBody>(req) };
  checkVehicle(next);
  Object.assign(v, next, { registration: next.registration.trim().toUpperCase(), name: next.name.trim() });
  return ok(v);
});

ops("get", "/api/ops/drivers", ({ query }) => {
  const all = query.get("include_inactive") === "true";
  return ok(db.drivers.filter((d) => all || d.active).map(driverRead));
});

ops("post", "/api/ops/drivers", (req) => {
  const b = json<{ email?: string; password?: string; name?: string; phone?: string | null; licence_number?: string | null }>(req);
  const email = (b.email ?? "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw validationError("value is not a valid email address", ["body", "email"]);
  if ((b.password ?? "").length < 8) throw validationError("String should have at least 8 characters", ["body", "password"]);
  if (!b.name?.trim()) throw validationError("String should have at least 1 character", ["body", "name"]);
  if (db.drivers.some((d) => d.email === email)) throw httpError(409, "A user with this e-mail already exists.");
  const d = {
    id: nextId(), user_id: crypto.randomUUID(), email, name: b.name.trim(), phone: b.phone || null,
    licence_number: b.licence_number || null, active: true, created_at: nowIso(), password: b.password,
  };
  db.drivers.push(d);
  return ok(driverRead(d), 201);
});

ops("patch", "/api/ops/drivers/{driver_id}", (req) => {
  const d = db.drivers.find((x) => x.id === intParam(req.params.driver_id));
  if (!d) throw httpError(404, "Driver not found.");
  const b = json<{ name?: string; phone?: string | null; licence_number?: string | null; active?: boolean }>(req);
  if (b.name !== undefined && !b.name?.trim()) throw validationError("String should have at least 1 character", ["body", "name"]);
  if (b.name !== undefined) d.name = b.name.trim();
  if (b.phone !== undefined) d.phone = b.phone || null;
  if (b.licence_number !== undefined) d.licence_number = b.licence_number || null;
  if (b.active !== undefined) d.active = !!b.active;
  return ok(driverRead(d));
});

// ---- Plans and loads ---------------------------------------------------------------------

ops("post", "/api/ops/plans", (req) => {
  const p = createPlan(json(req));
  return ok(planRead(p), 202);
});

ops("get", "/api/ops/plans", ({ query }) => {
  const date = query.get("delivery_date");
  const zone = query.get("zone");
  const status = query.get("status");
  return ok(
    db.plans
      .filter((p) => (!date || p.delivery_date === date) && (!zone || p.zone === zone) && (!status || p.status === status))
      .sort((a, b) => b.delivery_date.localeCompare(a.delivery_date) || b.id - a.id)
      .map(planSummary),
  );
});

ops("get", "/api/ops/plans/{plan_id}", ({ params }) => ok(planRead(plan(intParam(params.plan_id)))));

ops("delete", "/api/ops/plans/{plan_id}", ({ params }) => {
  discardPlan(plan(intParam(params.plan_id)));
  return { status: 204 };
});

ops("post", "/api/ops/plans/{plan_id}/draft", (req) => {
  const p = plan(intParam(req.params.plan_id));
  const method = json<{ method?: string }>(req).method ?? "ortools";
  if (method !== "ffd" && method !== "ortools") throw validationError("Input should be 'ortools' or 'ffd'", ["body", "method"]);
  saveDraft(p, method);
  return ok(planRead(p));
});

ops("post", "/api/ops/plans/{plan_id}/moves", (req) => {
  const p = plan(intParam(req.params.plan_id));
  moveLine(p, json(req));
  return ok(planRead(p));
});

ops("post", "/api/ops/plans/{plan_id}/lock", ({ params }) => {
  const p = plan(intParam(params.plan_id));
  lockPlan(p);
  return ok(planRead(p));
});

ops("patch", "/api/ops/order-lines/{line_id}", (req) =>
  ok(setLineApproval(intParam(req.params.line_id), json<{ dg_approval_ref?: unknown }>(req))));

ops("patch", "/api/ops/loads/{load_id}", (req) => ok(updateLoad(intParam(req.params.load_id), json(req))));

// ---- Invoices ---------------------------------------------------------------------------------

ops("get", "/api/ops/invoices", (req) => {
  const month = monthParam(req);
  return ok(
    db.companies
      .map((c) => invoice(c.id, month))
      .filter((inv) => inv.order_count > 0)
      .map(({ company_id, company_name, month: m, order_count, total_amount }) => ({ company_id, company_name, month: m, order_count, total_amount })),
  );
});

ops("get", "/api/ops/invoices/{company_id}", (req) => ok(invoice(intParam(req.params.company_id), monthParam(req))));

ops("get", "/api/ops/invoices/{company_id}/csv", (req) => {
  const inv = invoice(intParam(req.params.company_id), monthParam(req));
  const slug = inv.company_name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return {
    status: 200,
    body: invoiceCsv(inv),
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="invoice-${slug}-${inv.month}.csv"`,
    },
  };
});

// ---- Jobs -----------------------------------------------------------------------------------------

ops("get", "/api/jobs/{job_id}", ({ params }) => ok(jobRead(job(params.job_id))));

ops("get", "/api/jobs/{job_id}/result", ({ params }) => {
  const j = job(params.job_id);
  const status = jobStatus(j);
  if (status === "queued" || status === "running") throw httpError(409, `The job is still ${status}.`);
  if (status === "failed") throw httpError(409, j.error ?? "The job failed.");
  return ok(j.result);
});
