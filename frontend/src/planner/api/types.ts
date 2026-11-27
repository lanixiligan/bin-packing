// Types for the load planner API. They mirror the backend models, which are the source of truth:
// backend/app/reference/schemas.py (GET /api/reference) and backend/app/planner/models.py
// (POST /api/plan). Units are mm, kg and m³ everywhere; convert only for display (lib/units.tsx).
// The UI draws placements exactly as returned and never recalculates them.

import type { DgInfo, RuleSet } from "../../dg/rules.ts";

export type { DgInfo, RuleSet };
export type SizeClass = "20" | "40" | "45" | "48";
export type MassScheme = "GML" | "HML";

// ---- Reference data ---------------------------------------------------------

export interface PalletType {
  id: string;
  name: string;
  length_mm: number;
  width_mm: number;
  max_gross_kg: number | null;
  notes: string;
}

export interface PalletDefaults {
  default_pallet: string;
  tare_kg: number;
  max_stack_height_mm: number;
  max_gross_kg: number;
}

export interface ContainerType {
  id: string;
  name: string;
  size_class: SizeClass;
  ext_length_mm: number | null;
  ext_width_mm: number | null;
  ext_height_mm: number | null;
  int_length_mm: number | null;
  int_width_mm: number | null;
  int_height_mm: number | null;
  volume_m3: number | null;
  tare_kg: number | null;
  max_gross_kg: number | null;
  au_pallets: number | null;
  teu: number;
  temp_controlled: boolean;
  specialist: boolean;
  notes: string;
}

export interface BodyType {
  id: string;
  name: string;
  carries_pallets: boolean;
  carries_containers: boolean;
  container_optional: boolean;
  access: ("side" | "rear" | "top")[];
  temp_controlled: boolean;
  internal_height_mm: number | null;
  in_scope: boolean;
  notes: string;
}

export interface AxleGroup {
  id: string;
  name: string;
  kind: "steer" | "single" | "tandem" | "tri" | "quad";
  /** Vehicle x of the group's centre, from the front of the cab. */
  position_mm: number;
  gml_kg: number;
  hml_kg: number | null;
  tare_kg: number;
}

export interface Support {
  position_mm: number;
  axle_group: string | null;
  on_deck: string | null;
}

export interface Deck {
  id: string;
  name: string;
  /** Vehicle x of the deck's front edge. */
  x_mm: number;
  length_mm: number;
  width_mm: number;
  deck_height_mm: number;
  front_support: Support;
  rear_support: Support;
  pallet_spaces: number;
  /** False for a chassis that carries no freight (the prime mover). */
  cargo: boolean;
}

export interface ContainerSlot {
  deck_id: string;
  size_class: SizeClass;
  x_mm: number;
}

export interface ContainerCombo {
  name: string;
  slots: ContainerSlot[];
}

export interface VehicleConfig {
  id: string;
  name: string;
  category: "rigid" | "articulated" | "combination";
  description: string;
  pallet_spaces: number;
  decks: Deck[];
  axle_groups: AxleGroup[];
  tare_kg: number;
  max_payload_kg: number;
  gcm_kg: number | null;
  allowed_bodies: string[];
  default_body: string;
  container_combos: ContainerCombo[];
  overall_height_limit_mm: number;
  overall_length_mm: number | null;
  configurable: boolean;
  route_restricted: boolean;
  permit_note: string;
}

export interface ReferenceData {
  pallets: Record<string, PalletType>;
  pallet_defaults: PalletDefaults;
  containers: Record<string, ContainerType>;
  bodies: Record<string, BodyType>;
  vehicles: Record<string, VehicleConfig>;
}

// ---- Plan request -----------------------------------------------------------

export const SUGGEST = "suggest";
export const MAX_UNITS = 500; // backend/app/planner/models.py MAX_UNITS

export interface FreightItem {
  id: string;
  label?: string;
  kind: "pallet" | "container";
  type_id: string;
  quantity: number;
  /** Per unit, including pallet tare. */
  gross_weight_kg: number;
  /** Pallets: total height incl. the pallet. Ignored for containers. */
  height_mm?: number | null;
  stackable?: boolean;
  temp_controlled?: boolean;
  /** Dangerous goods data (ADG class, subsidiary hazards, food / fire-risk); null = general freight. */
  dg?: DgInfo | null;
}

export interface PlanRequest {
  items: FreightItem[];
  vehicle_id: string; // a VehicleConfig id or SUGGEST
  body_type?: string | null;
  mass_scheme?: MassScheme;
  /** Dangerous goods rules: ADG Code, or ADG plus Northline's acceptance rules. */
  rule_set?: RuleSet;
}

// ---- Plan result ------------------------------------------------------------

export type WarningCode =
  | "UNKNOWN_TYPE" | "MIXED_FREIGHT" | "BODY_INCOMPATIBLE" | "BODY_NOT_ALLOWED" | "OUT_OF_SCOPE_BODY"
  | "REEFER_ON_NON_REEFER" | "STACK_TOO_HIGH" | "OVER_INTERNAL_HEIGHT" | "OVER_HEIGHT_LIMIT"
  | "UNSTACKABLE_FLOOR_SPACE" | "OVER_CAPACITY" | "CONTAINER_COMBO" | "CONTAINER_OVER_MAX_GROSS"
  | "PALLET_OVER_MAX_GROSS" | "OVERSIZE_FOOTPRINT" | "OVER_PAYLOAD"
  | "AXLE_NEAR_LIMIT" | "AXLE_OVER_LIMIT" | "ROUTE_RESTRICTED"
  | "DG_INCOMPATIBLE" | "DG_CHECK" | "DG_ON_BOARD" | "DG_CARRIER_REFUSED" | "DG_CARRIER_NOTE";

export type Severity = "info" | "warning" | "error";

export interface PlanWarning {
  code: WarningCode;
  severity: Severity;
  /** Plain language: what is wrong. */
  message: string;
  /** What to try next. */
  suggestion: string;
  item_ids: string[];
}

export interface Placement {
  /** "<item_id>#<n>", n from 1. */
  unit_id: string;
  item_id: string;
  label: string;
  kind: "pallet" | "container";
  type_id: string;
  deck_id: string;
  /** From the front of the deck to the unit's front edge. */
  x_mm: number;
  /** From the driver's (left) side of the deck. */
  y_mm: number;
  /** Bottom of the unit above the deck floor. */
  z_mm: number;
  length_mm: number;
  width_mm: number;
  height_mm: number;
  rotated: boolean;
  /** Units sharing a floor position share a stack_id. */
  stack_id: number;
  /** 0 = on the floor. */
  stack_level: number;
  weight_kg: number;
  stackable: boolean;
  temp_controlled: boolean;
}

export interface Usage {
  used: number;
  available: number;
  pct: number;
}

export interface Utilisation {
  pallet_spaces: Usage;
  teu: Usage;
  payload_kg: Usage;
  volume_m3: Usage;
}

export interface AxleLoad {
  group_id: string;
  name: string;
  load_kg: number;
  limit_kg: number;
  ratio: number;
  status: "ok" | "near" | "over";
}

export interface VehicleTried {
  vehicle_id: string;
  fits: boolean;
  reason: string;
}

export interface PlanResult {
  fits: boolean;
  reasons: string[];
  warnings: PlanWarning[];
  vehicle_id: string;
  vehicle_name: string;
  body_type: string;
  mass_scheme: MassScheme;
  placements: Placement[];
  unplaced: string[];
  utilisation: Utilisation;
  axle_loads: AxleLoad[];
  total_weight_kg: number;
  /** Tallest point above the ground (deck height + load). */
  max_load_height_mm: number;
  planner: string;
  /** Set when the request asked for vehicle_id="suggest": every vehicle tried, smallest first. */
  tried: VehicleTried[] | null;
}
