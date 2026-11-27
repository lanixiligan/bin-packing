// The demo's trucks are a vehicle from the planner's reference data (GET /api/reference).
// These helpers pick the vehicles the demo offers, describe the chosen one in a line, and give
// its cargo decks with the inside height, as the solver sees them.
//
// Pure functions only (no React, no DOM), so they can be unit-tested with node.
import type { ReferenceData, VehicleConfig } from "../../shared/api/types.ts";
import { metres } from "./sizes.ts";

export const DEFAULT_VEHICLE = "RIGID_MEDIUM"; // backend/app/demo_models.py DEFAULT_VEHICLE

/** One cargo deck as the demo uses it (same shape as the solve response's capacity.decks). */
export interface DemoDeck {
  id: string;
  name: string;
  length_mm: number;
  width_mm: number;
  /** Inside height available for the load. */
  height_mm: number;
}

/** What one truck of a vehicle holds: its cargo decks and payload. */
export interface VehicleFit {
  decks: DemoDeck[];
  payloadKg: number;
}

/**
 * The reference data the demo's vehicle picker shows: no configurable or route-restricted
 * vehicles, and each vehicle's bodies limited to in-scope bodies that carry pallets (a vehicle
 * left with none, or whose default body isn't one, is dropped).
 */
export function demoReference(ref: ReferenceData): ReferenceData {
  const okBody = (id: string) => Boolean(ref.bodies[id]?.carries_pallets && ref.bodies[id]?.in_scope);
  const vehicles: Record<string, VehicleConfig> = {};
  for (const v of Object.values(ref.vehicles)) {
    if (v.configurable || v.route_restricted || !okBody(v.default_body)) continue;
    vehicles[v.id] = { ...v, allowed_bodies: v.allowed_bodies.filter(okBody) };
  }
  return { ...ref, vehicles };
}

/**
 * The vehicle's cargo decks with the inside height on `bodyType` (null = its default body):
 * the body's internal height, or the overall height limit above the deck for an open body.
 * Empty when the vehicle is unknown.
 */
export function vehicleDecks(ref: ReferenceData, vehicleId: string, bodyType: string | null = null): DemoDeck[] {
  const v = ref.vehicles[vehicleId];
  if (!v) return [];
  const body = ref.bodies[bodyType ?? v.default_body];
  return v.decks
    .filter((d) => d.cargo)
    .map((d) => ({
      id: d.id,
      name: d.name,
      length_mm: d.length_mm,
      width_mm: d.width_mm,
      height_mm: body?.internal_height_mm ?? v.overall_height_limit_mm - d.deck_height_mm,
    }));
}

/** Decks and payload of one truck of the vehicle, or null when it isn't in the reference. */
export function vehicleFit(ref: ReferenceData, vehicleId: string, bodyType: string | null = null): VehicleFit | null {
  const v = ref.vehicles[vehicleId];
  return v ? { decks: vehicleDecks(ref, vehicleId, bodyType), payloadKg: v.max_payload_kg } : null;
}

const tonnes = (kg: number) => `${(kg / 1000).toLocaleString("en-AU", { maximumFractionDigits: 1 })} t`;

/**
 * "4.8 × 2.4 m deck", or "7.4 + 13.6 × 2.48 m decks" for a B-double (decks of one width),
 * "7.4 × 2.4 + 13.6 × 2.48 m decks" when the widths differ.
 */
export function describeDecks(decks: DemoDeck[]): string {
  if (decks.length === 0) return "";
  if (decks.length === 1) return `${metres(decks[0].length_mm)} × ${metres(decks[0].width_mm)} m deck`;
  const sameWidth = decks.every((d) => d.width_mm === decks[0].width_mm);
  return sameWidth
    ? `${decks.map((d) => metres(d.length_mm)).join(" + ")} × ${metres(decks[0].width_mm)} m decks`
    : `${decks.map((d) => `${metres(d.length_mm)} × ${metres(d.width_mm)}`).join(" + ")} m decks`;
}

/** "Medium rigid (8 t) · 4.8 × 2.4 m deck · 2.7 m inside · 8 t" for the toolbar. */
export function vehicleLine(ref: ReferenceData, vehicleId: string, bodyType: string | null = null): string {
  const v = ref.vehicles[vehicleId];
  if (!v) return vehicleId;
  const decks = vehicleDecks(ref, vehicleId, bodyType);
  const inside = Math.max(0, ...decks.map((d) => d.height_mm));
  const body = bodyType && bodyType !== v.default_body ? ref.bodies[bodyType]?.name : null;
  return [v.name, body, describeDecks(decks), inside ? `${metres(inside)} m inside` : null, tonnes(v.max_payload_kg)]
    .filter(Boolean)
    .join(" · ");
}
