// Types for GET /api/reference. They mirror backend/app/reference/schemas.py, the source of truth. Units are mm, kg and m³ everywhere; convert only for display .

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
