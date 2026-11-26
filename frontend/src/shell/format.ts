// Formatting helpers shared by every area. Orchestrator-owned.
import type { Schemas } from "../api/client";

export type OrderStatus = Schemas["OrderStatus"];

export const STATUS_LABEL: Record<OrderStatus, string> = {
  draft: "Draft",
  submitted: "Submitted",
  accepted: "Accepted",
  rejected: "Rejected",
  cancelled: "Cancelled",
  planned: "Planned",
  picked_up: "Picked up",
  in_transit: "In transit",
  delivered: "Delivered",
  exception: "Exception",
};

/** Lifecycle order, for filters and progress displays. */
export const STATUS_ORDER: OrderStatus[] = [
  "draft", "submitted", "accepted", "planned", "picked_up", "in_transit", "delivered",
  "rejected", "cancelled", "exception",
];

const num = (n: number, max = 1) => n.toLocaleString(undefined, { maximumFractionDigits: max });

export const formatKg = (kg: number) => `${num(kg, 1)} kg`;
export const formatM3 = (m3: number) => `${num(m3, 2)} m³`;
export const formatPallets = (p: number) => `${num(p, 1)} pallet${p === 1 ? "" : "s"}`;
export const formatPercent = (p: number) => `${num(p, 0)}%`;

/** Money arrives as a decimal string ("123.45"). */
export function formatMoney(amount: string | null | undefined): string {
  if (amount == null) return "—";
  const n = Number(amount);
  return Number.isFinite(n)
    ? n.toLocaleString("en-AU", { style: "currency", currency: "AUD" })
    : amount;
}

/** "2026-11-27" → "Fri 27 Nov 2026" (no timezone shift: it's a calendar date). */
export function formatDate(isoDate: string | null | undefined): string {
  if (!isoDate) return "—";
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: "short", day: "numeric", month: "short", year: "numeric",
  });
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

/** "09:00:00" → "09:00". */
export const formatTime = (t: string | null | undefined) => (t ? t.slice(0, 5) : "");

export function formatWindow(start: string | null | undefined, end: string | null | undefined): string {
  if (!start && !end) return "Any time";
  return `${formatTime(start) || "…"}–${formatTime(end) || "…"}`;
}

/** Today's date as "YYYY-MM-DD" in the browser's timezone. */
export function todayIso(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function formatAddress(a: Pick<Schemas["AddressRead"], "line1" | "line2" | "suburb" | "state" | "postcode">): string {
  return [a.line1, a.line2, `${a.suburb} ${a.state} ${a.postcode}`].filter(Boolean).join(", ");
}
