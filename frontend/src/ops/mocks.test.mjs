// Contract tests for the ops/jobs/driver mock API: the UI is built against
// it, so it has to behave like docs/api.md says the real API does.
// Run: node --test src/components/capacity.test.mjs src/ops/mocks.test.mjs
import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { mockFetch } from "../api/mock.ts";
import "./mocks.ts";
import "../driver/mocks.ts";
import { db, isoDay, job, resetDb } from "./mockDb.ts";

const call = async (method, path, { role = "dispatcher", body, form } = {}) => {
  const headers = role ? { authorization: `Bearer mock:${role}` } : {};
  let payload;
  if (form) payload = form;
  else if (body !== undefined) {
    payload = JSON.stringify(body);
    headers["content-type"] = "application/json";
  }
  const res = await mockFetch(new Request(`http://mock${path}`, { method, headers, body: payload }));
  const type = res.headers.get("content-type") ?? "";
  const data = res.status === 204 ? null : type.includes("json") ? await res.json() : await res.text();
  return { status: res.status, data, headers: res.headers };
};

/** Make the plan's job finish now instead of in ~3 s. */
const finishJob = (jobId) => {
  job(jobId).created_ms -= 60_000;
};

beforeEach(() => resetDb());

test("roles: 401 without a token, 403 for the wrong role", async () => {
  assert.equal((await call("GET", "/api/ops/orders", { role: null })).status, 401);
  assert.equal((await call("GET", "/api/ops/orders", { role: "customer" })).status, 403);
  assert.equal((await call("GET", "/api/driver/run", { role: "dispatcher" })).status, 403);
});

test("order queue filters, accept, reject (reason required) and 409 on a bad transition", async () => {
  const { data: submitted } = await call("GET", "/api/ops/orders?status=submitted");
  assert.ok(submitted.length >= 3);
  assert.ok(submitted.every((o) => o.status === "submitted"));
  const { data: unzoned } = await call("GET", "/api/ops/orders?zone=none");
  assert.ok(unzoned.length > 0 && unzoned.every((o) => o.zone === null));
  assert.ok((await call("GET", "/api/ops/orders")).data.every((o) => o.status !== "draft"));

  const [first, second] = submitted;
  const accepted = await call("POST", `/api/ops/orders/${first.id}/accept`, { body: {} });
  assert.equal(accepted.data.status, "accepted");
  assert.equal(accepted.data.events.at(-1).to_status, "accepted");
  assert.equal((await call("POST", `/api/ops/orders/${first.id}/accept`, { body: {} })).status, 409);

  assert.equal((await call("POST", `/api/ops/orders/${second.id}/reject`, { body: { note: "" } })).status, 422);
  const rejected = await call("POST", `/api/ops/orders/${second.id}/reject`, { body: { note: "No access" } });
  assert.equal(rejected.data.status, "rejected");
  assert.equal(rejected.data.events.at(-1).note, "No access");
});

test("vehicles need at least one capacity", async () => {
  const bad = await call("POST", "/api/ops/vehicles", { body: { name: "X", registration: "X1" } });
  assert.equal(bad.status, 422);
  assert.ok(Array.isArray(bad.data.detail));
  const good = await call("POST", "/api/ops/vehicles", { body: { name: "Small van", registration: "sv-1", max_volume_m3: 6 } });
  assert.equal(good.status, 201);
  assert.equal(good.data.registration, "SV-1");
  const cleared = await call("PATCH", `/api/ops/vehicles/${good.data.id}`, { body: { max_volume_m3: null } });
  assert.equal(cleared.status, 422);
});

test("planning: infeasible units give an InfeasibleDetail, an empty batch a string", async () => {
  const tomorrow = isoDay(1);
  const infeasible = await call("POST", "/api/ops/plans", { body: { delivery_date: tomorrow, zone: "SOUTH", vehicle_id: 1 } });
  assert.equal(infeasible.status, 422);
  assert.equal(typeof infeasible.data.detail.message, "string");
  assert.equal(infeasible.data.detail.misfits[0].item_sku, "STL-R");
  assert.deepEqual(infeasible.data.detail.misfits[0].dimensions, ["weight"]);

  const empty = await call("POST", "/api/ops/plans", { body: { delivery_date: isoDay(30), zone: "NORTH", vehicle_id: 1 } });
  assert.equal(empty.status, 422);
  assert.equal(typeof empty.data.detail, "string");
});

test("planning flow: job → result → draft → moves (capacity checked) → lock → driver run", async () => {
  const created = await call("POST", "/api/ops/plans", { body: { delivery_date: isoDay(1), zone: "NORTH", vehicle_id: 1 } });
  assert.equal(created.status, 202);
  const plan = created.data;
  assert.equal(plan.status, "draft");
  assert.equal(plan.loads.length, 0);

  const queued = await call("GET", `/api/jobs/${plan.job_id}`);
  assert.equal(queued.data.status, "queued");
  assert.equal(queued.data.time_limit_s, 10);
  assert.equal((await call("GET", `/api/jobs/${plan.job_id}/result`)).status, 409);

  finishJob(plan.job_id);
  const done = await call("GET", `/api/jobs/${plan.job_id}`);
  assert.equal(done.data.status, "succeeded");
  assert.ok(done.data.started_at && done.data.finished_at);

  const { data: result } = await call("GET", `/api/jobs/${plan.job_id}/result`);
  assert.equal(result.ffd.num_loads, 4); // the demo's "FFD loses" weights on a 1000 kg van
  assert.equal(result.ortools.num_loads, 3);
  assert.equal(result.lower_bound, 3);
  assert.equal(result.lower_bounds.weight, 3);
  assert.equal(result.lower_bounds.volume, null);
  assert.equal(result.recommended, "ortools");
  assert.equal(result.units.length, 8);

  const draft = await call("POST", `/api/ops/plans/${plan.id}/draft`, { body: { method: "ortools" } });
  assert.equal(draft.data.loads.length, 3);
  assert.ok(draft.data.loads.every((l) => !l.over_capacity && l.capacity.weight_kg === 1000));

  // Moving the heaviest line onto another full load must fail with a readable 422.
  const [a, b] = draft.data.loads;
  const heavy = a.lines.reduce((x, y) => (y.unit_weight_kg > x.unit_weight_kg ? y : x));
  const over = await call("POST", `/api/ops/plans/${plan.id}/moves`, { body: { order_line_id: heavy.order_line_id, from_load_id: a.id, to_load_id: b.id } });
  assert.equal(over.status, 422);
  assert.match(over.data.detail, /over capacity/);

  // Into a new load is fine; a load left empty disappears and the rest are renumbered.
  let current = draft.data;
  for (const line of a.lines) {
    const r = await call("POST", `/api/ops/plans/${plan.id}/moves`, { body: { order_line_id: line.order_line_id, from_load_id: a.id, to_load_id: null } });
    assert.equal(r.status, 200);
    current = r.data;
  }
  assert.ok(!current.loads.some((l) => l.id === a.id));
  assert.deepEqual(current.loads.map((l) => l.number), current.loads.map((_, i) => i + 1));

  const load = current.loads[0];
  const assigned = await call("PATCH", `/api/ops/loads/${load.id}`, { body: { vehicle_id: 2, driver_id: 1 } });
  assert.equal(assigned.data.vehicle.id, 2);
  assert.equal(assigned.data.capacity.volume_m3, 12);

  const locked = await call("POST", `/api/ops/plans/${plan.id}/lock`);
  assert.equal(locked.data.status, "locked");
  assert.equal((await call("POST", `/api/ops/plans/${plan.id}/moves`, { body: { order_line_id: 1, from_load_id: load.id } })).status, 409);
  assert.equal((await call("DELETE", `/api/ops/plans/${plan.id}`)).status, 409);
  const { data: o } = await call("GET", `/api/ops/orders/${plan.order_ids[0]}`);
  assert.equal(o.status, "planned");

  const run = await call("GET", `/api/driver/run?date=${isoDay(1)}`, { role: "driver" });
  assert.equal(run.data.loads.length, 1);
  assert.ok(run.data.loads[0].orders.every((x) => x.next_statuses.includes("picked_up")));
});

test("discarding a draft releases its orders", async () => {
  const { data: plan } = await call("POST", "/api/ops/plans", { body: { delivery_date: isoDay(1), zone: "NORTH", vehicle_id: 3 } });
  assert.equal((await call("DELETE", `/api/ops/plans/${plan.id}`)).status, 204);
  const { data: batches } = await call("GET", "/api/ops/batches");
  const north = batches.find((b) => b.delivery_date === isoDay(1) && b.zone === "NORTH");
  assert.equal(north.unplanned_orders, 5);
  assert.equal(north.planned_orders, 0);
});

test("driver: status changes, exception needs a note, POD checks size and type", async () => {
  const { data: run } = await call("GET", "/api/driver/run", { role: "driver" });
  assert.equal(run.date, isoDay(0));
  const orders = run.loads.flatMap((l) => l.orders);
  const planned = orders.find((o) => o.status === "planned");
  const inTransit = orders.find((o) => o.status === "in_transit");

  const picked = await call("POST", `/api/driver/orders/${planned.order_id}/status`, { role: "driver", body: { status: "picked_up" } });
  assert.equal(picked.data.status, "picked_up");
  assert.deepEqual(picked.data.next_statuses, ["in_transit", "exception"]);
  assert.equal((await call("POST", `/api/driver/orders/${planned.order_id}/status`, { role: "driver", body: { status: "exception" } })).status, 422);
  assert.equal((await call("POST", `/api/driver/orders/${planned.order_id}/pod`, { role: "driver", form: podForm(png()) })).status, 409);

  assert.equal((await call("POST", `/api/driver/orders/${inTransit.order_id}/pod`, { role: "driver", form: podForm(new Blob(["hello"], { type: "image/png" })) })).status, 415);
  assert.equal((await call("POST", `/api/driver/orders/${inTransit.order_id}/pod`, { role: "driver", form: podForm(new Blob([new Uint8Array(5 * 1024 * 1024 + 1)])) })).status, 413);
  const delivered = await call("POST", `/api/driver/orders/${inTransit.order_id}/pod`, { role: "driver", form: podForm(png()) });
  assert.equal(delivered.status, 200);
  assert.equal(delivered.data.status, "delivered");
  const photo = await mockFetch(new Request(`http://mock${delivered.data.pods[0].photo_url}`, { headers: { authorization: "Bearer mock:dispatcher" } }));
  assert.equal(photo.headers.get("content-type"), "image/png");
});

test("invoices list delivered orders of the month, with a CSV and a TOTAL row", async () => {
  const delivered = db.orders.find((o) => o.status === "delivered");
  const month = delivered.delivered_at.slice(0, 7);
  const localMonth = (() => {
    const d = new Date(delivered.delivered_at);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  })();
  const { data: list } = await call("GET", `/api/ops/invoices?month=${localMonth}`);
  const row = list.find((r) => r.company_id === delivered.company_id);
  assert.ok(row && row.order_count >= 1, `no invoice row for ${month}`);
  const { data: inv } = await call("GET", `/api/ops/invoices/${row.company_id}?month=${localMonth}`);
  assert.equal(inv.lines.length, row.order_count);
  assert.equal(inv.total_amount, row.total_amount);
  const csv = await call("GET", `/api/ops/invoices/${row.company_id}/csv?month=${localMonth}`);
  assert.match(csv.headers.get("content-type"), /text\/csv/);
  const lines = csv.data.trim().split(/\r\n/);
  assert.equal(lines[0], "reference,customer_reference,delivered_at,delivery_suburb,zone,weight_kg,volume_m3,cubic_weight_kg,rate_per_kg,amount");
  assert.ok(lines.at(-1).startsWith("TOTAL,") && lines.at(-1).endsWith(inv.total_amount));
  assert.equal((await call("GET", "/api/ops/invoices?month=2026-13")).status, 422);
});

function png() {
  return new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])], { type: "image/png" });
}
function podForm(photo) {
  const f = new FormData();
  f.set("signed_by", "Jo");
  f.set("photo", photo, "pod.png");
  return f;
}

// ---- Dangerous goods ------------------------------------------------------------------------

/** Plan a batch, let the job finish and save the OR-Tools draft. */
const planned = async (day, zone, rule_set) => {
  const created = await call("POST", "/api/ops/plans", { body: { delivery_date: isoDay(day), zone, vehicle_id: 1, rule_set } });
  assert.equal(created.status, 202, JSON.stringify(created.data));
  finishJob(created.data.job_id);
  const { data: result } = await call("GET", `/api/jobs/${created.data.job_id}/result`);
  const draft = await call("POST", `/api/ops/plans/${created.data.id}/draft`, { body: { method: "ortools" } });
  return { plan: draft.data, result };
};
const lineOf = (p, sku) => {
  for (const load of p.loads) {
    const line = load.lines.find((l) => l.item_sku === sku);
    if (line) return { load, line };
  }
  throw new Error(`${sku} not on any load`);
};

test("DG: the solver keeps Class 3 and Class 5.1 apart; the order shows the conflict", async () => {
  const { data: o } = await call("GET", "/api/ops/orders/1022");
  assert.equal(o.lines[0].dg.dg_class, "3");
  assert.equal(o.dg_conflicts.length, 1);
  assert.equal(o.dg_conflicts[0].status, "incompatible");
  assert.match(o.dg_conflicts[0].message, /Paint thinners \(20 L\) \(Class 3\) and Pool chlorine tub \(Class 5\.1\) can't travel/);

  const { plan, result } = await planned(2, "WEST", undefined);
  assert.equal(plan.rule_set, "adg");
  assert.equal(result.lower_bound, 1); // by weight: one van would do without segregation
  assert.ok(result.units.some((u) => u.dg?.dg_class === "5.1"));
  for (const m of [result.ffd, result.ortools]) {
    assert.equal(m.num_loads, 2);
    for (const l of m.loads) {
      const classes = new Set(l.unit_ids.map((id) => result.units[id].dg?.dg_class));
      assert.ok(!(classes.has("3") && classes.has("5.1")), `load ${l.number} mixes Class 3 and 5.1`);
    }
  }
  assert.ok(plan.loads.every((l) => l.dg_conflicts.length === 0 && l.approvals_missing === 0));
  // ADG plans need no approvals
  assert.equal(lineOf(plan, "HRB-200").line.dg_approval_required, false);
});

test("DG: moving goods onto a load they clash with is a 422; a forced clash blocks locking", async () => {
  const { plan } = await planned(2, "WEST");
  const chlorine = lineOf(plan, "CHL-10");
  const thinners = lineOf(plan, "THN-20");
  assert.notEqual(chlorine.load.id, thinners.load.id);
  const r = await call("POST", `/api/ops/plans/${plan.id}/moves`, {
    body: { order_line_id: chlorine.line.order_line_id, from_load_id: chlorine.load.id, to_load_id: thinners.load.id },
  });
  assert.equal(r.status, 422);
  assert.match(r.data.detail, new RegExp(`^Load ${thinners.load.number} can't take these units: it carries .*Class 3.*Pool chlorine tub \\(Class 5\\.1\\) can't travel with it`));

  // Put them together behind the API's back (e.g. data saved before the item got its DG class).
  const rec = db.plans.find((p) => p.id === plan.id);
  const from = rec.loads.find((l) => l.id === chlorine.load.id);
  const to = rec.loads.find((l) => l.id === thinners.load.id);
  to.assignments.push(...from.assignments.splice(0));
  rec.loads = rec.loads.filter((l) => l.assignments.length);
  rec.loads.forEach((l, i) => (l.number = i + 1));
  const { data: p } = await call("GET", `/api/ops/plans/${plan.id}`);
  const clashes = p.loads.flatMap((l) => l.dg_conflicts);
  assert.ok(clashes.every((c) => c.status === "incompatible"));
  assert.ok(clashes.some((c) => [...c.items].sort().join(" + ") === "Paint thinners (20 L) (Class 3) + Pool chlorine tub (Class 5.1)"));
  const locked = await call("POST", `/api/ops/plans/${plan.id}/lock`);
  assert.equal(locked.status, 409);
  assert.match(locked.data.detail, /dangerous goods that can't travel together/);
});

test("DG: Northline plans refuse prohibited goods and need approval references before locking", async () => {
  const refused = await call("POST", "/api/ops/plans", { body: { delivery_date: isoDay(3), zone: "WEST", vehicle_id: 1, rule_set: "northline" } });
  assert.equal(refused.status, 422);
  assert.deepEqual(refused.data.detail.misfits, []);
  assert.equal(refused.data.detail.dg_issues.length, 1);
  assert.equal(refused.data.detail.dg_issues[0].kind, "prohibited");
  assert.equal(refused.data.detail.dg_issues[0].order_reference, "ORD-1024");
  assert.match(refused.data.detail.dg_issues[0].message, /fuels/);
  assert.match(refused.data.detail.message, /Northline won't accept 1 order line/);
  // The ADG rule set takes the same batch.
  assert.equal((await call("POST", "/api/ops/plans", { body: { delivery_date: isoDay(3), zone: "WEST", vehicle_id: 1, rule_set: "adg" } })).status, 202);

  const { plan } = await planned(2, "WEST", "northline");
  assert.equal(plan.rule_set, "northline");
  const weed = lineOf(plan, "HRB-200");
  assert.equal(weed.line.dg_approval_required, true);
  assert.equal(weed.line.dg_approval_ref, null);
  assert.equal(weed.load.approvals_missing, 1);
  assert.ok(lineOf(plan, "LPG-9").load.dg_warnings.some((w) => /steel cage/.test(w)));
  const blocked = await call("POST", `/api/ops/plans/${plan.id}/lock`);
  assert.equal(blocked.status, 409);
  assert.match(blocked.data.detail, /Northline HSEQ approval/);

  const saved = await call("PATCH", `/api/ops/order-lines/${weed.line.order_line_id}`, { body: { dg_approval_ref: "  HSEQ-2041 " } });
  assert.equal(saved.status, 200);
  assert.equal(saved.data.dg_approval_ref, "HSEQ-2041");
  const { data: after } = await call("GET", `/api/ops/plans/${plan.id}`);
  assert.equal(lineOf(after, "HRB-200").line.dg_approval_ref, "HSEQ-2041");
  assert.ok(after.loads.every((l) => l.approvals_missing === 0));
  assert.equal((await call("POST", `/api/ops/plans/${plan.id}/lock`)).status, 200);
  // the driver sees the class and UN number
  await call("PATCH", `/api/ops/loads/${weed.load.id}`, { body: { driver_id: 1 } });
  const { data: run } = await call("GET", `/api/driver/run?date=${isoDay(2)}`, { role: "driver" });
  const driverLine = run.loads.flatMap((l) => l.orders).flatMap((o) => o.lines).find((l) => l.item_sku === "HRB-200");
  assert.deepEqual([driverLine.dg_class, driverLine.un_number], ["6.1", "2902"]);
  // still editable on a locked plan (the order is planned now)
  assert.equal((await call("PATCH", `/api/ops/order-lines/${weed.line.order_line_id}`, { body: { dg_approval_ref: "HSEQ-2042" } })).status, 200);

  // only accepted or planned orders
  const { data: submitted } = await call("GET", "/api/ops/orders/1013");
  assert.equal((await call("PATCH", `/api/ops/order-lines/${submitted.lines[0].id}`, { body: { dg_approval_ref: "X" } })).status, 409);
});
