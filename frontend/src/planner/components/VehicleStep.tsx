// Step 1, compact: the chosen vehicle on one line ("Semi-trailer · 22 pallet spaces · 24,000 kg
// payload · Tautliner · GML") with a Change button. Change opens the full picker in place: the
// vehicle cards (incl. "Suggest one"), the body type and the mass limits, closed with Done or Escape.
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { MassScheme, ReferenceData } from "../api/types.ts";
import { SUGGEST } from "../api/types.ts";
import { useUnits } from "../lib/units.ts";
import VehiclePicker from "./VehiclePicker.tsx";
import "./VehicleStep.css";

export interface VehicleStepProps {
  reference: ReferenceData;
  /** A VehicleConfig id, or SUGGEST ("suggest"). */
  vehicleId: string;
  /** null = the vehicle's default body. */
  bodyType: string | null;
  massScheme: MassScheme;
  onVehicleChange(vehicleId: string): void;
  onBodyChange(bodyType: string | null): void;
  onMassSchemeChange(scheme: MassScheme): void;
  /** In suggest mode, the vehicle the last plan picked. */
  suggestedVehicleId?: string | null;
}

const MASS_SCHEMES: [MassScheme, string][] = [["GML", "General Mass Limits"], ["HML", "Higher Mass Limits"]];

/** "Tautliner (curtainsider)" -> "Tautliner": the short name is enough on the summary line. */
/** Between facts: the dot stays with the fact before it when the line wraps. */
const SEPARATOR = "\u00a0· ";

const shortName = (name: string) => name.replace(/\s*\(.*\)\s*$/, "");

export default function VehicleStep({
  reference, vehicleId, bodyType, massScheme, onVehicleChange, onBodyChange, onMassSchemeChange, suggestedVehicleId = null,
}: VehicleStepProps) {
  const units = useUnits();
  const uid = useId();
  const panelId = `${uid}-panel`;
  const [open, setOpen] = useState(false);
  const changeRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const suggestMode = vehicleId === SUGGEST;
  const vehicle = suggestMode ? null : reference.vehicles[vehicleId] ?? null;
  const suggested = suggestMode && suggestedVehicleId ? reference.vehicles[suggestedVehicleId] ?? null : null;
  const body = vehicle ? reference.bodies[bodyType ?? vehicle.default_body] : undefined;
  const massName = MASS_SCHEMES.find(([id]) => id === massScheme)?.[1] ?? massScheme;

  // The line: the name, then facts separated by middle dots.
  const title = vehicle ? vehicle.name : suggestMode ? "Suggest the smallest vehicle" : "No vehicle chosen";
  const facts: ReactNode[] = [];
  if (vehicle) {
    facts.push(`${vehicle.pallet_spaces} pallet spaces`, `${units.weight(vehicle.max_payload_kg)} payload`);
    if (body) facts.push(shortName(body.name));
  } else if (suggested) {
    facts.push(`Picked: ${suggested.name}`);
  }
  facts.push(<abbr title={massName}>{massScheme}</abbr>);
  if (vehicle?.route_restricted) {
    facts.push(<span className="badge badge-warning" title={vehicle.permit_note}>Route approval</span>);
  }

  // On opening, focus goes to the selected card so arrow keys change the vehicle straight away.
  useEffect(() => {
    if (open) panelRef.current?.querySelector<HTMLInputElement>(".vp-radio:checked")?.focus();
  }, [open]);

  const close = () => {
    setOpen(false);
    changeRef.current?.focus();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Escape") return;
    e.stopPropagation();
    close();
  };

  return (
    <div className="vs">
      <div className="vs-line">
        <p className="vs-summary" data-testid="vehicle-summary">
          <strong className="vs-name">{title}</strong>
          {facts.map((fact, i) => <span key={i}>{SEPARATOR}<span className="vs-fact">{fact}</span></span>)}
        </p>
        <button type="button" className="btn btn-sm vs-change" ref={changeRef} aria-expanded={open} aria-controls={panelId}
                onClick={() => (open ? close() : setOpen(true))}>
          Change<span className="visually-hidden"> vehicle</span>
        </button>
      </div>

      {/* Escape from any control inside closes the panel. */}
      <div id={panelId} className="vs-panel" ref={panelRef} hidden={!open} onKeyDown={onKeyDown}>
        {open && (
          <>
            <VehiclePicker reference={reference} vehicleId={vehicleId} bodyType={bodyType}
                           onVehicleChange={onVehicleChange} onBodyChange={onBodyChange}
                           suggestedVehicleId={suggestedVehicleId} />
            <div className="vs-panel-footer">
              <fieldset className="segmented mass-scheme" aria-label="Mass limits">
                {MASS_SCHEMES.map(([value, label]) => (
                  <label key={value}>
                    <input type="radio" name={`${uid}-mass-scheme`} value={value} checked={massScheme === value}
                           onChange={() => onMassSchemeChange(value)} />
                    <span>{label}</span>
                  </label>
                ))}
              </fieldset>
              <button type="button" className="btn btn-primary btn-sm vs-done" onClick={close}>Done</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
