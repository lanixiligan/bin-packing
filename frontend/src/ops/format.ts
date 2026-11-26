// Formatting helpers for the ops and driver pages.

/** "560 kg · 1.2 m³ · 1 pallet": order or line totals, skipping zero volume/pallets. */
export function sizeText(kg: number, m3: number, pallets: number): string {
  const parts = [`${kg.toLocaleString(undefined, { maximumFractionDigits: 1 })} kg`];
  if (m3 > 0) parts.push(`${m3.toLocaleString(undefined, { maximumFractionDigits: 2 })} m³`);
  if (pallets > 0) parts.push(`${pallets.toLocaleString(undefined, { maximumFractionDigits: 1 })} pallet${pallets === 1 ? "" : "s"}`);
  return parts.join(" · ");
}

/** "2026-11" for a Date (local time). */
export function monthIso(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Shift a "YYYY-MM-DD" date by `days` (calendar arithmetic, no timezone shift). */
export function shiftDate(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d + days);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}
