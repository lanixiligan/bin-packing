// The load planner API: GET /api/reference, POST /api/plan and POST /api/plan/fleet (Vite forwards /api to the backend).

import type { FleetResult, PlanRequest, PlanResult, ReferenceData } from "./types.ts";

/** An API error with a message fit to show the user. */
export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "ApiError";
  }
}

/** FastAPI errors: {detail: "text"} or {detail: [{msg, loc}, ...]} for validation errors. */
async function errorMessage(res: Response): Promise<string> {
  try {
    const body = await res.json();
    const detail = body?.detail;
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail) && detail.length) {
      return detail.map((d) => String(d.msg ?? d).replace(/^Value error, /, "")).join(" ");
    }
  } catch {
    // not JSON
  }
  if (res.status >= 500) return "The planner hit a problem on the server. Try again in a moment.";
  return `The planner couldn't handle that request (${res.status}).`;
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, init);
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    throw new ApiError("Can't reach the planner. Check that the API is running.", 0);
  }
  if (!res.ok) throw new ApiError(await errorMessage(res), res.status);
  return res.json() as Promise<T>;
}

export function fetchReference(signal?: AbortSignal): Promise<ReferenceData> {
  return call<ReferenceData>("/api/reference", { signal });
}

function post<T>(path: string, req: PlanRequest, signal?: AbortSignal): Promise<T> {
  return call<T>(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
    signal,
  });
}

/** Plan the load on one vehicle (or vehicle_id "suggest" for the smallest that fits). */
export function postPlan(req: PlanRequest, signal?: AbortSignal): Promise<PlanResult> {
  return post<PlanResult>("/api/plan", req, signal);
}

/** Split the load across the fewest trucks of the request's vehicle (pallets and loose items; not "suggest"). */
export function postFleet(req: PlanRequest, signal?: AbortSignal): Promise<FleetResult> {
  return post<FleetResult>("/api/plan/fleet", req, signal);
}
