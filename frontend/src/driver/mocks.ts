// Mock handlers for the driver API and POD photos (used only with VITE_MOCK_API=1).
// The data is shared with the ops mocks (../ops/mockDb.ts): loads the
// dispatcher locks and assigns to driver 1 appear here.
import { fail, mock, ok } from "../api/mock.ts";
import { guarded } from "../ops/mocks.ts";
import {
  MAX_UPLOAD_BYTES, MOCK_DRIVER_ID, actors, addPod, db, driverLoads, driverOrder, driverOrderFor, driverRead,
  httpError, isoDay, order, transition, validationError,
} from "../ops/mockDb.ts";

const driverId = () => MOCK_DRIVER_ID;
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];

mock("get", "/api/driver/run", guarded("driver", ({ query }) => {
  const date = query.get("date") || isoDay(0);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw validationError("Input should be a valid date", ["query", "date"]);
  const me = db.drivers.find((d) => d.id === driverId())!;
  const loads = driverLoads(driverId(), date).map(({ plan, load }) => {
    const orderIds: number[] = [];
    for (const a of load.assignments) {
      const o = db.orders.find((x) => x.lines.some((l) => l.id === a.order_line_id))!;
      if (!orderIds.includes(o.id)) orderIds.push(o.id);
    }
    return {
      load_id: load.id,
      number: load.number,
      plan_id: plan.id,
      zone: plan.zone,
      delivery_date: plan.delivery_date,
      vehicle: load.vehicle_id != null ? db.vehicles.find((v) => v.id === load.vehicle_id) ?? null : null,
      orders: orderIds.map((id) => driverOrder(load, order(id))),
    };
  });
  return ok({ date, driver: driverRead(me), loads });
}));

mock("get", "/api/driver/orders/{order_id}", guarded("driver", ({ params }) =>
  ok(driverOrderFor(driverId(), Number(params.order_id)))));

mock("post", "/api/driver/orders/{order_id}/status", guarded("driver", ({ params, body }) => {
  const id = Number(params.order_id);
  driverOrderFor(driverId(), id); // 404 unless it's on one of my loads
  const b = (body ?? {}) as { status?: string; note?: string | null };
  if (b.status !== "picked_up" && b.status !== "in_transit" && b.status !== "exception") {
    throw validationError("Input should be 'picked_up', 'in_transit' or 'exception'", ["body", "status"]);
  }
  const note = b.note?.trim() || null;
  if (b.status === "exception" && !note) {
    throw validationError("Value error, Describe the problem in the note when reporting an exception.");
  }
  const o = order(id);
  // A split order already moved by another driver: 200 without a second event.
  if (o.status !== b.status) transition(o, b.status, actors.driver(driverId()), note);
  return ok(driverOrderFor(driverId(), id));
}));

/** Sniff the first bytes like the real API does (it ignores the declared type). */
async function imageType(file: Blob): Promise<string | null> {
  const b = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (String.fromCharCode(...b.slice(0, 4)) === "RIFF" && String.fromCharCode(...b.slice(8, 12)) === "WEBP") return "image/webp";
  return null;
}

mock("post", "/api/driver/orders/{order_id}/pod", guarded("driver", async ({ params, body }) => {
  const id = Number(params.order_id);
  driverOrderFor(driverId(), id);
  if (!(body instanceof FormData)) throw validationError("Field required", ["body", "photo"]);
  const signedBy = String(body.get("signed_by") ?? "").trim();
  const photo = body.get("photo");
  const note = String(body.get("note") ?? "").trim() || null;
  if (!signedBy) throw validationError("Field required", ["body", "signed_by"]);
  if (!(photo instanceof Blob) || photo.size === 0) throw validationError("Field required", ["body", "photo"]);
  if (photo.size > MAX_UPLOAD_BYTES) throw httpError(413, "The photo is larger than 5 MB. Take a smaller photo and try again.");
  const type = await imageType(photo);
  if (!type || !ALLOWED_TYPES.includes(type)) throw httpError(415, "The photo must be a JPEG, PNG or WebP image.");
  const o = order(id);
  if (o.status !== "in_transit") {
    throw httpError(409, `Can't record a delivery for ${o.reference}: it is ${o.status.replace("_", " ")}, not in transit.`);
  }
  addPod(id, driverId(), signedBy, note, new Blob([photo], { type }));
  transition(o, "delivered", actors.driver(driverId()), note);
  return ok(driverOrderFor(driverId(), id));
}));

mock("get", "/api/pods/{pod_id}/photo", guarded("any", ({ params }) => {
  const pod = db.pods.find((p) => p.id === Number(params.pod_id));
  if (!pod) return fail(404, "Not found.");
  return { status: 200, body: pod.photo, headers: { "content-type": pod.photo.type || "image/jpeg" } };
}));
