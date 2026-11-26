// Queries shared by the ops pages. Every key starts with "ops" so a mutation
// can refresh everything that might have changed with one invalidate.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, unwrap, type Schemas } from "../api/client";

export type Vehicle = Schemas["VehicleRead"];
export type Driver = Schemas["DriverRead"];
export type Zone = Schemas["ZoneRead"];

export function useZones() {
  return useQuery({ queryKey: ["ops", "zones"], queryFn: () => unwrap(api.GET("/api/ops/zones")) });
}

export function useVehicles(includeInactive = false) {
  return useQuery({
    queryKey: ["ops", "vehicles", { includeInactive }],
    queryFn: () => unwrap(api.GET("/api/ops/vehicles", { params: { query: { include_inactive: includeInactive } } })),
  });
}

export function useDrivers(includeInactive = false) {
  return useQuery({
    queryKey: ["ops", "drivers", { includeInactive }],
    queryFn: () => unwrap(api.GET("/api/ops/drivers", { params: { query: { include_inactive: includeInactive } } })),
  });
}

/** Companies, derived from the addresses (there is no companies endpoint). */
export function useCompanies() {
  return useQuery({
    queryKey: ["ops", "addresses", {}],
    queryFn: () => unwrap(api.GET("/api/ops/addresses")),
    select: (rows) => {
      const map = new Map<number, string>();
      for (const a of rows) map.set(a.company_id, a.company_name);
      return [...map].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
    },
  });
}

/** Refresh every ops query (after any change). */
export function useInvalidateOps() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ["ops"] });
}

/** "1,000 kg · 12 m³ · 8 pallets" (only the limits that are set). */
export function vehicleLimits(v: Pick<Vehicle, "max_weight_kg" | "max_volume_m3" | "max_pallets">): string {
  const parts: string[] = [];
  if (v.max_weight_kg != null) parts.push(`${v.max_weight_kg.toLocaleString()} kg`);
  if (v.max_volume_m3 != null) parts.push(`${v.max_volume_m3.toLocaleString()} m³`);
  if (v.max_pallets != null) parts.push(`${v.max_pallets} pallet${v.max_pallets === 1 ? "" : "s"}`);
  return parts.join(" · ") || "no limits";
}

export const vehicleCapacity = (v: Vehicle): Schemas["Capacity"] => ({
  weight_kg: v.max_weight_kg, volume_m3: v.max_volume_m3, pallets: v.max_pallets,
});
