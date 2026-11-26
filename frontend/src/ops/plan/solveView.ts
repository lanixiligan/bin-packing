// Adapters from the API's plan/solver models to the props of the shared truck
// views (components/ResultPanel.jsx, Summary.jsx), which speak the demo's
// shape: { num_trucks, drop_order, trucks: [{ truck, shipments }] }.
import type { Schemas } from "../../api/client";
import { limitedDims, limitOf, type CapacityLimits } from "../../components/capacity.ts";

type SolveResult = Schemas["SolveResult"];
type MethodResult = Schemas["MethodResult"];
type PackUnit = Schemas["PackUnit"];

export interface ViewShipment {
  id: number;
  name: string;
  weight: number;
  volume: number;
  pallets: number;
  /** Color by order, so all units of one order look alike. */
  colorKey: number;
  /** Shown in labels: the order reference. */
  detail: string;
}

export interface ViewTruck {
  truck: number;
  label: string;
  capacity?: CapacityLimits;
  shipments: ViewShipment[];
}

export interface PanelData {
  num_trucks: number;
  drop_order: number[];
  trucks: ViewTruck[];
}

export const methodName = (m: "ffd" | "ortools") => (m === "ortools" ? "OR-Tools" : "FFD");

const unitShipment = (u: PackUnit): ViewShipment => ({
  id: u.id,
  name: u.item_name,
  weight: u.weight_kg,
  volume: u.volume_m3,
  pallets: u.pallets,
  colorKey: u.order_id,
  detail: u.order_reference,
});

/** One solver method's loads, as trucks of units. */
export function methodPanelData(result: SolveResult, method: MethodResult): PanelData {
  return {
    num_trucks: method.num_loads,
    drop_order: method.drop_order,
    trucks: method.loads.map((l) => ({
      truck: l.number,
      label: `Load ${l.number}`,
      shipments: l.unit_ids.map((id) => unitShipment(result.units[id])),
    })),
  };
}

/** A plan's saved loads: one block per line on the load (quantity × unit size). */
export function loadsPanelData(loads: Schemas["LoadRead"][]): PanelData {
  const trucks = loads.map((l) => ({
    truck: l.number,
    label: `Load ${l.number}`,
    capacity: l.capacity,
    shipments: l.lines.map((line) => ({
      id: line.assignment_id,
      name: `${line.item_name} ×${line.quantity}`,
      weight: line.unit_weight_kg * line.quantity,
      volume: line.unit_volume_m3 * line.quantity,
      pallets: line.unit_pallet_spaces * line.quantity,
      colorKey: line.order_id,
      detail: line.order_reference,
    })),
  }));
  return { num_trucks: loads.length, drop_order: trucks.flatMap((t) => t.shipments.map((s) => s.id)), trucks };
}

const num = (n: number, max = 2) => n.toLocaleString(undefined, { maximumFractionDigits: max });

/** Summary.jsx props for a SolveResult (loads, per-dimension lower bounds). */
export function summaryData(result: SolveResult) {
  const cap = result.capacity;
  const details = limitedDims(cap).map((d) => {
    const lb = result.lower_bounds[d.dim] ?? 0;
    return {
      label: d.label,
      text: `⌈${num(result.totals[d.field])} ÷ ${num(limitOf(cap, d.dim)!)}⌉ = ${lb}`,
      binding: lb === result.lower_bound,
    };
  });
  const binding = details.filter((d) => d.binding).map((d) => d.label.toLowerCase());
  return {
    ffd: { num_trucks: result.ffd.num_loads, solve_time_ms: Math.round(result.ffd.solve_time_ms * 100) / 100 },
    ortools: result.ortools
      ? {
        num_trucks: result.ortools.num_loads,
        solve_time_ms: result.ortools.solve_time_ms,
        optimal: result.ortools.optimal,
        time_limit_s: result.time_limit_s,
      }
      : null,
    lower_bound: result.lower_bound,
    total_weight: result.totals.weight_kg,
    capacity: cap.weight_kg ?? 0,
    bound_note: `by ${binding.join(" and ") || "capacity"}: no plan can use fewer`,
    bound_details: details,
  };
}

/** Where each unit ended up, per method: unit id → load numbers. */
export function placements(result: SolveResult): Map<number, { unit: PackUnit; ffd?: number; ortools?: number }> {
  const map = new Map<number, { unit: PackUnit; ffd?: number; ortools?: number }>();
  for (const u of result.units) map.set(u.id, { unit: u });
  for (const key of ["ffd", "ortools"] as const) {
    for (const l of result[key]?.loads ?? []) {
      for (const id of l.unit_ids) map.get(id)![key] = l.number;
    }
  }
  return map;
}
