// The planner's answer in the shape the 3D view reads (TruckScene3D.jsx, copied from the bin packing
// demo): trucks of numbered units, each
// with its placement, and per truck the load, kg free, fill %, floor used and the tallest column,
// worked out here from the placements.
//
// What one truck holds is what the split solver packs against (backend/app/planner/fleet.py
// `_solver_truck`): the vehicle's payload, its cargo decks up to the stack height cap, and a floor
// capped at the vehicle's pallet spaces. Nothing here moves a unit: placements are drawn as returned.
//
// Units also need a link to the freight table: a unit's numeric id here, its `unit_id`
// ("<item_id>#<n>") and its freight line (`item_id`) map onto each other (`Lit`).

import type { FleetResult, FreightItem, PlanRequest, PlanResult, ReferenceData } from "../api/types.ts";
import type { DeckBox } from "./deck.ts";

/** One AU pallet space (1165 mm square): the floor cap per pallet space (backend heuristic.py AU_AREA_MM2). */
export const AU_AREA_MM2 = 1165 * 1165;

export interface SceneCapacity {
  weight_kg: number;
  /** The cargo decks, each with the inside height a stack may use. */
  decks: DeckBox[];
  floor_m2: number;
  volume_m3: number;
}

export interface ScenePlacement {
  deck_id: string;
  x_mm: number;
  y_mm: number;
  z_mm: number;
  length_mm: number;
  width_mm: number;
  height_mm: number;
  rotated: boolean;
  /** Id of the floor unit of its column (its own id on the floor). */
  stack_base: number;
  level: number;
}

export interface SceneShipment {
  /** Position in `drop_order`, unique across the trucks. */
  id: number;
  /** "Paint 3": the line's label and the unit's number. */
  name: string;
  weight: number;
  /** Containers (one-truck plans only) are drawn like loose items. */
  kind: "pallet" | "loose";
  pallet_type: string | null;
  /** As given, before any turn (the placement has the turned sizes). */
  length_mm: number;
  width_mm: number;
  height_mm: number;
  stackable: boolean;
  /** "3", "5.1", "food", "fire_risk" or null (lib/capacity.ts). */
  dg_class: string | null;
  subsidiary: string[];
  /** Index of its freight line in the request: the colour (lib/capacity.ts colorOf). */
  line: number;
  lineName: string;
  unitId: string;
  itemId: string;
  placement: ScenePlacement;
}

export interface SceneTruck {
  /** 1-based. */
  truck: number;
  /** Floor units first, then upper levels. */
  shipments: SceneShipment[];
  load: number;
  empty: number;
  fill_percent: number;
  floor_used_m2: number;
  floor_percent: number;
  max_height_mm: number;
}

export interface Scene {
  vehicle_name: string;
  capacity: SceneCapacity;
  trucks: SceneTruck[];
  num_trucks: number;
  /** Unit ids truck by truck, floor units before what stands on them: the order they drop in. */
  drop_order: number[];
  /** `unit_id` of each unit, by its numeric id. */
  unitIds: string[];
  /** Freight line (`item_id`) of each unit, by its numeric id. */
  itemIds: string[];
  /** The numeric ids of each freight line's units. */
  idsByItem: Map<string, number[]>;
}

const round = (x: number, places: number) => Math.round(x * 10 ** places) / 10 ** places;

/** What one truck of this vehicle and body holds (see the top of this file), or null for an unknown vehicle. */
export function truckCapacity(reference: ReferenceData, vehicleId: string, bodyId: string | null): SceneCapacity | null {
  const vehicle = reference.vehicles[vehicleId];
  if (!vehicle) return null;
  const body = bodyId ? reference.bodies[bodyId] : undefined;
  const cargo = vehicle.decks.filter((d) => d.cargo);
  // backend heuristic.py stack_height_cap: the max stack height, the room under the height limit
  // above the highest deck, and the body's inside height.
  const caps = [reference.pallet_defaults.max_stack_height_mm,
    vehicle.overall_height_limit_mm - Math.max(0, ...cargo.map((d) => d.deck_height_mm))];
  if (body?.internal_height_mm != null) caps.push(body.internal_height_mm);
  const height = Math.min(...caps);
  const area = cargo.reduce((s, d) => s + d.length_mm * d.width_mm, 0);
  return {
    weight_kg: vehicle.max_payload_kg,
    decks: cargo.map((d) => ({ id: d.id, name: d.name, length_mm: d.length_mm, width_mm: d.width_mm, height_mm: height })),
    floor_m2: round(floorMm2(area, vehicle.pallet_spaces) / 1e6, 2),
    volume_m3: round((area * height) / 1e9, 2),
  };
}

/** The floor a truck may use: its decks, or its pallet spaces when that is less. */
const floorMm2 = (deckArea: number, palletSpaces: number) => Math.min(deckArea, palletSpaces * AU_AREA_MM2);

const unitNumber = (unitId: string) => (unitId.includes("#") ? unitId.slice(unitId.lastIndexOf("#") + 1) : "");

function dgOf(item: FreightItem | undefined): { dg_class: string | null; subsidiary: string[] } {
  const dg = item?.dg;
  if (!dg) return { dg_class: null, subsidiary: [] };
  const cls = dg.dg_class ?? (dg.food ? "food" : dg.fire_risk ? "fire_risk" : null);
  return { dg_class: cls, subsidiary: dg.dg_class ? [...(dg.subsidiary ?? [])] : [] };
}

/**
 * A split (or a one-truck plan, as a fleet of one) as the truck views read it. Null when the
 * vehicle isn't in the reference data.
 */
export function fleetScene(fleet: FleetResult | PlanResult, reference: ReferenceData, request: PlanRequest): Scene | null {
  const plans = "trucks" in fleet ? fleet.trucks : [fleet];
  const capacity = truckCapacity(reference, fleet.vehicle_id, fleet.body_type);
  if (!capacity) return null;
  const items = new Map(request.items.map((it, k) => [it.id, { it, k }]));
  const vehicle = reference.vehicles[fleet.vehicle_id];
  const floor = floorMm2(capacity.decks.reduce((s, d) => s + d.length_mm * d.width_mm, 0), vehicle.pallet_spaces);
  const unitIds: string[] = [];
  const itemIds: string[] = [];
  const idsByItem = new Map<string, number[]>();

  const trucks = plans.map((plan, t): SceneTruck => {
    // Floor units first (a stable sort keeps the planner's order within a level).
    const ordered = [...plan.placements].sort((a, b) => a.stack_level - b.stack_level);
    const idOf = new Map<string, number>();
    for (const p of ordered) {
      const id = unitIds.length;
      idOf.set(p.unit_id, id);
      unitIds.push(p.unit_id);
      itemIds.push(p.item_id);
      idsByItem.set(p.item_id, [...(idsByItem.get(p.item_id) ?? []), id]);
    }
    // The floor unit of each column: deck and stack_id name a floor position.
    const baseOf = new Map<string, number>();
    for (const p of ordered) {
      const key = `${p.deck_id}:${p.stack_id}`;
      if (!baseOf.has(key)) baseOf.set(key, idOf.get(p.unit_id)!);
    }
    const shipments = ordered.map((p): SceneShipment => {
      const found = items.get(p.item_id);
      const label = found?.it.label?.trim() || p.label || p.item_id;
      const num = unitNumber(p.unit_id);
      const [length, width] = p.rotated ? [p.width_mm, p.length_mm] : [p.length_mm, p.width_mm];
      return {
        id: idOf.get(p.unit_id)!,
        name: num ? `${label} ${num}` : label,
        weight: p.weight_kg,
        kind: p.kind === "pallet" ? "pallet" : "loose",
        pallet_type: p.kind === "pallet" ? p.type_id : null,
        length_mm: length,
        width_mm: width,
        height_mm: p.height_mm,
        stackable: p.stackable,
        ...dgOf(found?.it),
        line: found?.k ?? request.items.length,
        lineName: label,
        unitId: p.unit_id,
        itemId: p.item_id,
        placement: {
          deck_id: p.deck_id, x_mm: p.x_mm, y_mm: p.y_mm, z_mm: p.z_mm,
          length_mm: p.length_mm, width_mm: p.width_mm, height_mm: p.height_mm, rotated: p.rotated,
          stack_base: baseOf.get(`${p.deck_id}:${p.stack_id}`)!, level: p.stack_level,
        },
      };
    });
    // Stacked units take floor once, percentages to 0.1.
    const load = shipments.reduce((s, x) => s + x.weight, 0);
    const used = ordered.filter((p) => p.stack_level === 0).reduce((s, p) => s + p.length_mm * p.width_mm, 0);
    return {
      truck: t + 1,
      shipments,
      load,
      empty: capacity.weight_kg - load,
      fill_percent: round((100 * load) / capacity.weight_kg, 1),
      floor_used_m2: round(used / 1e6, 2),
      floor_percent: floor > 0 ? round((100 * used) / floor, 1) : 0,
      max_height_mm: Math.max(0, ...ordered.map((p) => p.z_mm + p.height_mm)),
    };
  });

  return {
    vehicle_name: fleet.vehicle_name,
    capacity,
    trucks,
    num_trucks: trucks.length,
    drop_order: trucks.flatMap((t) => t.shipments.map((s) => s.id)),
    unitIds,
    itemIds,
    idsByItem,
  };
}

/** Position of each unit id in the drop sequence (the truck views' `dropIndex`). */
export function dropIndexOf(scene: Scene): Record<number, number> {
  const index: Record<number, number> = {};
  scene.drop_order.forEach((id, k) => (index[id] = k));
  return index;
}

// ---- Hover link between the freight table and the trucks --------------------------------------

/**
 * What is lit up across the page: whole freight lines (hovering a line in the freight table) or
 * single units (hovering a unit in a truck, which also lights its line in the table).
 */
export interface Lit {
  /** Freight line ids (`item_id`): their rows in the freight table. */
  items: string[];
  /** The units lit in the trucks; null = every unit of `items`. */
  units: string[] | null;
}

/** Every unit of one freight line. */
export const lineLit = (itemId: string): Lit => ({ items: [itemId], units: null });

/** True when a unit is lit. */
export function isLit(lit: Lit | null | undefined, p: { unit_id: string; item_id: string }): boolean {
  if (!lit) return false;
  return lit.units ? lit.units.includes(p.unit_id) : lit.items.includes(p.item_id);
}

/**
 * The numeric ids of the lit units in a scene (the truck views' `activeIds`), or null when none of
 * them is in this scene (so nothing fades for a line that isn't on these trucks).
 */
export function litIds(scene: Scene, lit: Lit | null | undefined): number[] | null {
  if (!lit) return null;
  const ids = scene.unitIds.flatMap((unitId, id) => (isLit(lit, { unit_id: unitId, item_id: scene.itemIds[id] }) ? [id] : []));
  return ids.length ? ids : null;
}

/** The units with these numeric ids, and their freight lines; null for none. */
export function litFromIds(scene: Scene, ids: readonly number[] | null): Lit | null {
  if (!ids?.length) return null;
  return { items: [...new Set(ids.map((id) => scene.itemIds[id]))], units: ids.map((id) => scene.unitIds[id]) };
}

// ---- Lower bounds as ⌈total ÷ what one truck holds⌉ --------------------------------------------

export interface BoundTotal {
  /** The freight's total: kg, m² of floor that nothing can stand on, or m³. */
  total: number;
  /** What one truck holds, in the same unit. */
  capacity: number;
}

/**
 * The totals behind a split's lower bounds (backend/app/solver.py lower_bounds), from the units the
 * trucks carry: weight ÷ payload, the floor of units that can't stack ÷ the floor, volume ÷ the
 * load space. Null for an unknown vehicle.
 */
export function boundTotals(fleet: FleetResult, reference: ReferenceData): Record<"weight" | "floor" | "volume", BoundTotal> | null {
  const cap = truckCapacity(reference, fleet.vehicle_id, fleet.body_type);
  if (!cap) return null;
  const units = fleet.trucks.flatMap((t) => t.placements);
  return {
    // Whole kg per unit, rounded up, as the backend's weight bound counts them (fleet.py _solver_item).
    weight: { total: units.reduce((s, p) => s + Math.ceil(p.weight_kg), 0), capacity: cap.weight_kg },
    floor: {
      total: units.filter((p) => !p.stackable).reduce((s, p) => s + p.length_mm * p.width_mm, 0) / 1e6,
      capacity: cap.floor_m2,
    },
    volume: { total: units.reduce((s, p) => s + p.length_mm * p.width_mm * p.height_mm, 0) / 1e9, capacity: cap.volume_m3 },
  };
}
