// Adapters from the API's plan/solver models to the props of the shared truck
// views (components/ResultPanel.jsx, Summary.jsx), which speak the demo's
// shape: { num_trucks, drop_order, trucks: [{ truck, shipments }] }.
import type { Schemas } from "../../api/client";
import { limitedDims, limitOf, type CapacityLimits } from "../../components/capacity.ts";
import { checkAll, dgKey, dgLabel, isGeneral, type DgLike } from "../../dg/rules.ts";

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
  /** Shown in labels: the order reference (and the DG class, e.g. "ORD-1 · Class 3"). */
  detail: string;
  /** Dangerous goods only: "Class 3" (Truck.jsx shows it on the block). */
  dgLabel?: string;
  /** Dangerous goods only: the placard Truck.jsx draws ("3", "6.1", or "food" / "fire_risk"). */
  dgCode?: string;
}

/** `detail`, `dgLabel` and `dgCode` of a shipment: the DG class is added for dangerous goods only. */
function dgFields(reference: string, dg: DgLike): Pick<ViewShipment, "detail" | "dgLabel" | "dgCode"> {
  if (isGeneral(dg)) return { detail: reference };
  const label = dgLabel(dg);
  return {
    detail: `${reference} · ${label}${dg?.un_number ? ` · UN ${dg.un_number}` : ""}`,
    dgLabel: label,
    dgCode: dg?.dg_class ?? (dg?.food ? "food" : "fire_risk"),
  };
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
  ...dgFields(u.order_reference, u.dg),
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
      ...dgFields(line.order_reference, line.dg),
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
    // SolveComparison shows its own segregation note; this only fixes the "above the bound" wording.
    dg_floor: segregationNote(result) !== null,
  };
}

/**
 * A note for the comparison when the units carry dangerous goods that can't share a load:
 * the lower bound only counts capacity, so the best plan may need more loads. Null otherwise.
 */
export function segregationNote(result: SolveResult): string | null {
  const distinct = new Map<string, DgLike>();
  for (const u of result.units) {
    const k = dgKey(u.dg);
    if (k && !distinct.has(k)) distinct.set(k, u.dg);
  }
  const clashes = checkAll([...distinct.values()], (d) => d).filter((c) => c.status === "incompatible");
  if (!clashes.length) return null;
  const pairs = clashes.slice(0, 3).map((c) => `${dgLabel(c.a)} with ${dgLabel(c.b)}`);
  const more = clashes.length > 3 ? ` and ${clashes.length - 3} more` : "";
  return `The lower bound ignores dangerous goods segregation: ${pairs.join(", ")}${more} can't share a load, `
    + "so the best plan may need more loads than the bound. Both methods keep them apart.";
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
