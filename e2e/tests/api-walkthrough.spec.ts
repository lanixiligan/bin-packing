// The full order loop over real HTTP, with the real arq worker running the solver:
// customer submits → dispatcher accepts → plans (background job) → locks → assigns
// a driver → driver picks up and delivers with POD → customer sees the timeline →
// the order is on this month's invoice CSV.
import { expect, test } from "@playwright/test";
import { API, PNG, USERS, businessDate, businessMonth, call, login } from "./helpers";

test("order loop: submit → accept → plan → lock → assign → deliver → invoice", async ({ request }) => {
  const customer = await login(request, USERS.customer);
  const dispatcher = await login(request, USERS.dispatcher);
  const driverAuth = await login(request, USERS.driver);

  // A date no seed order uses, so the plan contains only this order.
  const date = businessDate(30);

  // ---- Customer: build, quote and submit an order -------------------------
  const me = await call(request, "GET", "/api/users/me", customer);
  expect(me.role).toBe("customer");
  const addresses = await call<any[]>(request, "GET", "/api/portal/addresses", customer);
  const delivery = addresses.find((a) => a.zone);
  const pickup = addresses.find((a) => a.id !== delivery?.id);
  expect(delivery, "a zoned address").toBeTruthy();
  const items = await call<any[]>(request, "GET", "/api/portal/items", customer);
  const [itemA, itemB] = [...items].sort((a, b) => a.weight_kg - b.weight_kg);
  const lines = [{ item_id: itemA.id, quantity: 3 }, { item_id: itemB.id, quantity: 2 }];

  const preview = await call(request, "POST", "/api/portal/quote-preview", customer,
    { delivery_address_id: delivery.id, lines });
  expect(preview.id).toBeNull();
  expect(preview.provisional).toBe(false);
  expect(Number(preview.amount)).toBeGreaterThan(0);

  const draft = await call(request, "POST", "/api/portal/orders", customer, {
    pickup_address_id: pickup.id, delivery_address_id: delivery.id, delivery_date: date,
    window_start: "09:00", window_end: "12:00", customer_reference: "E2E-PO-1", lines,
  }, 201);
  expect(draft.status).toBe("draft");
  const orderId = draft.id;
  const reference = draft.reference;

  const submitted = await call(request, "POST", `/api/portal/orders/${orderId}/submit`, customer, { note: "e2e" });
  expect(submitted.status).toBe("submitted");
  expect(submitted.quote.amount).toBe(preview.amount);

  // ---- Dispatcher: accept, plan, lock, assign ----------------------------
  const accepted = await call(request, "POST", `/api/ops/orders/${orderId}/accept`, dispatcher, {});
  expect(accepted.status).toBe("accepted");

  const vehicles = await call<any[]>(request, "GET", "/api/ops/vehicles", dispatcher);
  const vehicle = [...vehicles].sort((a, b) => (b.max_weight_kg ?? 1e9) - (a.max_weight_kg ?? 1e9))[0];
  const plan = await call(request, "POST", "/api/ops/plans", dispatcher,
    { delivery_date: date, zone: delivery.zone, vehicle_id: vehicle.id }, 202);
  expect(plan.order_ids).toEqual([orderId]);

  // The worker picks the job up from Redis.
  let job: any;
  await expect.poll(async () => {
    job = await call(request, "GET", `/api/jobs/${plan.job_id}`, dispatcher);
    return job.status;
  }, { timeout: 60_000, intervals: [500, 1000] }).toMatch(/succeeded|failed/);
  expect(job.status, job.error ?? "").toBe("succeeded");
  expect(job.plan_id).toBe(plan.id);

  const result = await call(request, "GET", `/api/jobs/${plan.job_id}/result`, dispatcher);
  expect(result.units).toHaveLength(5);
  expect(result.ffd.num_loads).toBeGreaterThanOrEqual(result.lower_bound);

  const drafted = await call(request, "POST", `/api/ops/plans/${plan.id}/draft`, dispatcher,
    { method: result.recommended });
  expect(drafted.loads.length).toBeGreaterThan(0);
  expect(drafted.loads.every((l: any) => !l.over_capacity)).toBe(true);

  const locked = await call(request, "POST", `/api/ops/plans/${plan.id}/lock`, dispatcher);
  expect(locked.status).toBe("locked");

  const drivers = await call<any[]>(request, "GET", "/api/ops/drivers", dispatcher);
  const driver = drivers.find((d) => d.email === USERS.driver);
  for (const load of locked.loads) {
    const updated = await call(request, "PATCH", `/api/ops/loads/${load.id}`, dispatcher,
      { vehicle_id: vehicle.id, driver_id: driver.id });
    expect(updated.driver.id).toBe(driver.id);
  }
  const planned = await call(request, "GET", `/api/ops/orders/${orderId}`, dispatcher);
  expect(planned.status).toBe("planned");

  // ---- Driver: run, pick up, deliver with POD ----------------------------
  const run = await call(request, "GET", `/api/driver/run?date=${date}`, driverAuth);
  const stop = run.loads.flatMap((l: any) => l.orders).find((o: any) => o.order_id === orderId);
  expect(stop, "order on the driver's run").toBeTruthy();
  expect(stop.next_statuses).toContain("picked_up");

  const picked = await call(request, "POST", `/api/driver/orders/${orderId}/status`, driverAuth, { status: "picked_up" });
  expect(picked.status).toBe("picked_up");
  const moving = await call(request, "POST", `/api/driver/orders/${orderId}/status`, driverAuth, { status: "in_transit" });
  expect(moving.next_statuses).toContain("delivered");

  const podRes = await request.post(`${API}/api/driver/orders/${orderId}/pod`, {
    headers: driverAuth,
    multipart: {
      signed_by: "Pat Receiver",
      note: "Left at the loading dock",
      photo: { name: "pod.png", mimeType: "image/png", buffer: PNG },
    },
  });
  expect(podRes.status(), await podRes.text()).toBe(200);
  expect((await podRes.json()).status).toBe("delivered");

  // ---- Customer: delivered, full timeline, POD photo ----------------------
  const final = await call(request, "GET", `/api/portal/orders/${orderId}`, customer);
  expect(final.status).toBe("delivered");
  expect(final.events.map((e: any) => `${e.from_status ?? "∅"}→${e.to_status}`)).toEqual([
    "∅→draft", "draft→submitted", "submitted→accepted", "accepted→planned",
    "planned→picked_up", "picked_up→in_transit", "in_transit→delivered",
  ]);
  expect(final.events.every((e: any) => e.actor_name)).toBe(true);
  expect(final.pods).toHaveLength(1);
  const photo = await request.get(`${API}${final.pods[0].photo_url}`, { headers: customer });
  expect(photo.status()).toBe(200);
  expect(photo.headers()["content-type"]).toContain("image/png");

  // Another role can't use the customer API, and the photo isn't public.
  expect((await request.get(`${API}/api/portal/orders/${orderId}`, { headers: driverAuth })).status()).toBe(403);
  expect((await request.get(`${API}${final.pods[0].photo_url}`)).status()).toBe(401);

  // ---- Dispatcher: the order is on this month's invoice CSV --------------
  const month = businessMonth();
  const invoices = await call<any[]>(request, "GET", `/api/ops/invoices?month=${month}`, dispatcher);
  const inv = invoices.find((i) => i.company_id === final.company_id);
  expect(inv, "invoice row for the customer").toBeTruthy();
  const csvRes = await request.get(`${API}/api/ops/invoices/${final.company_id}/csv?month=${month}`, { headers: dispatcher });
  expect(csvRes.status()).toBe(200);
  expect(csvRes.headers()["content-type"]).toContain("text/csv");
  expect(csvRes.headers()["content-disposition"]).toContain("attachment");
  const csv = await csvRes.text();
  const header = csv.split(/\r?\n/)[0];
  expect(header).toBe("reference,customer_reference,delivered_at,delivery_suburb,zone,weight_kg,volume_m3,cubic_weight_kg,rate_per_kg,amount");
  const row = csv.split(/\r?\n/).find((l) => l.startsWith(reference));
  expect(row, `${reference} in the CSV`).toBeTruthy();
  expect(row).toContain(final.quote.amount);
  expect(csv).toMatch(/^TOTAL,/m);
});
