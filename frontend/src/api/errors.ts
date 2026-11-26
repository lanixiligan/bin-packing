// Turning API error bodies into messages people can read. Orchestrator-owned.

/** FastAPI error body: detail is a string, a validation-error list, or an object. */
type Detail = string | { msg: string; loc?: (string | number)[] }[] | { message?: string; reason?: string; code?: string };

const CODES: Record<string, string> = {
  LOGIN_BAD_CREDENTIALS: "Wrong e-mail or password, or the account is inactive.",
  REGISTER_USER_ALREADY_EXISTS: "An account with this e-mail already exists.",
  REGISTER_INVALID_PASSWORD: "That password isn't allowed.",
};

export class ApiError extends Error {
  status: number;
  detail: unknown;
  constructor(status: number, message: string, detail: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
  }
}

export function messageFromDetail(detail: unknown, status: number): string {
  const d = detail as Detail | undefined;
  if (typeof d === "string") return CODES[d] ?? d;
  if (Array.isArray(d)) {
    return d
      .map((e) => {
        const field = e.loc?.filter((p) => p !== "body" && p !== "query").join(".");
        const msg = e.msg.replace(/^Value error, /, "");
        return field ? `${field}: ${msg}` : msg;
      })
      .join("; ");
  }
  if (d && typeof d === "object") {
    if ("reason" in d && d.reason) return d.reason;
    if ("message" in d && d.message) return d.message;
    if ("code" in d && d.code) return CODES[d.code] ?? d.code;
  }
  if (status === 401) return "Please log in again.";
  if (status === 403) return "You don't have access to this.";
  if (status === 404) return "Not found.";
  if (status >= 500) return `Server error (${status}). Please try again.`;
  return `Request failed (${status}).`;
}

/** A readable message for anything thrown by a query or mutation. */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof TypeError) return "Cannot reach the server. Check your connection.";
  if (err instanceof Error) return err.message;
  return String(err);
}
