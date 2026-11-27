// The API client: GET /api/reference (Vite forwards /api to the backend).

import type { ReferenceData } from "./types.ts";

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
  if (res.status >= 500) return "The demo hit a problem on the server. Try again in a moment.";
  return `The demo couldn't handle that request (${res.status}).`;
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, init);
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    throw new ApiError("Can't reach the demo. Check that the API is running.", 0);
  }
  if (!res.ok) throw new ApiError(await errorMessage(res), res.status);
  return res.json() as Promise<T>;
}

export function fetchReference(signal?: AbortSignal): Promise<ReferenceData> {
  return call<ReferenceData>("/api/reference", { signal });
}
