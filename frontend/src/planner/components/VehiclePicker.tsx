// STUB (B-input replaces the body, keeps the props). Step 1: pick a vehicle as visual cards, or
// "Suggest one"; then the body type for that vehicle.
import type { ReferenceData } from "../api/types.ts";

export interface VehiclePickerProps {
  reference: ReferenceData;
  /** A VehicleConfig id, or SUGGEST ("suggest"). */
  vehicleId: string;
  /** null = the vehicle's default body. */
  bodyType: string | null;
  onVehicleChange(vehicleId: string): void;
  onBodyChange(bodyType: string | null): void;
  /** In suggest mode, the vehicle the last plan picked (to highlight it). */
  suggestedVehicleId?: string | null;
}

export default function VehiclePicker({ reference, vehicleId }: VehiclePickerProps) {
  return <div data-testid="vehicle-picker">{Object.keys(reference.vehicles).length} vehicles · {vehicleId}</div>;
}
