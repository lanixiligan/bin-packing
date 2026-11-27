// Step 1: pick a vehicle as visual cards (native radios, so arrow keys and labels just work), or
// "Suggest one"; then the body type for that vehicle.
import { useId } from "react";
import type { BodyType, ReferenceData, VehicleConfig } from "../api/types.ts";
import { SUGGEST } from "../api/types.ts";
import { useUnits } from "../lib/units.ts";
import "./VehiclePicker.css";

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
  /** Offer the "Suggest one" card (default true; the bin packing demo always needs a vehicle). */
  allowSuggest?: boolean;
}

// ---- Helpers -------------------------------------------------------------------

/** Smallest first: pallet spaces, then payload. */
function sortVehicles(vehicles: Record<string, VehicleConfig>): VehicleConfig[] {
  return Object.values(vehicles).sort((a, b) =>
    a.pallet_spaces - b.pallet_spaces || a.max_payload_kg - b.max_payload_kg || a.name.localeCompare(b.name));
}

/** "1 × 40' or 2 × 20'" from the vehicle's container combos. */
function containerSummary(v: VehicleConfig): string {
  return v.container_combos.map((c) => c.name.replace(/\s+x\s+/gi, " × ")).join(" or ");
}

/** "Side + rear loading" */
function accessLabel(body: BodyType): string {
  if (body.access.length === 0) return "";
  const parts = body.access.map((a, i) => (i === 0 ? a[0].toUpperCase() + a.slice(1) : a));
  return `${parts.join(" + ")} loading`;
}

/** The vehicle's in-scope bodies, default first. */
function bodiesFor(v: VehicleConfig, ref: ReferenceData): BodyType[] {
  const ids = [v.default_body, ...v.allowed_bodies.filter((id) => id !== v.default_body)];
  return ids.map((id) => ref.bodies[id]).filter((b): b is BodyType => Boolean(b?.in_scope));
}

// ---- Icons -----------------------------------------------------------------------

function VehicleIcon({ category }: { category: VehicleConfig["category"] }) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinejoin: "round" as const };
  return (
    <svg className="vp-icon" viewBox="0 0 64 22" aria-hidden="true" focusable="false">
      {category === "rigid" && (
        <>
          <path d="M4 5h32v11H4z" {...common} />
          <path d="M36 9h9l5 5v2H36z" {...common} />
          <circle cx="12" cy="17.5" r="2.4" fill="currentColor" />
          <circle cx="43" cy="17.5" r="2.4" fill="currentColor" />
        </>
      )}
      {category === "articulated" && (
        <>
          <path d="M2 4h44v11H2z" {...common} />
          <path d="M48 8h8l5 5v3H48z" {...common} />
          <circle cx="8" cy="17.5" r="2.2" fill="currentColor" />
          <circle cx="14" cy="17.5" r="2.2" fill="currentColor" />
          <circle cx="50" cy="17.5" r="2.2" fill="currentColor" />
          <circle cx="58" cy="17.5" r="2.2" fill="currentColor" />
        </>
      )}
      {category === "combination" && (
        <>
          <path d="M1 5h22v10H1z" {...common} />
          <path d="M25 5h24v10H25z" {...common} />
          <path d="M51 8h6l5 5v3H51z" {...common} />
          <circle cx="6" cy="17.5" r="2" fill="currentColor" />
          <circle cx="18" cy="17.5" r="2" fill="currentColor" />
          <circle cx="32" cy="17.5" r="2" fill="currentColor" />
          <circle cx="45" cy="17.5" r="2" fill="currentColor" />
          <circle cx="58" cy="17.5" r="2" fill="currentColor" />
        </>
      )}
    </svg>
  );
}

function SparkIcon() {
  return (
    <svg className="vp-icon vp-icon-suggest" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" fill="none" stroke="currentColor"
            strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M18.5 15.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z" fill="currentColor" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg className="vp-check" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <circle cx="10" cy="10" r="9" fill="currentColor" />
      <path d="M6 10.2l2.6 2.6L14 7.4" fill="none" stroke="var(--color-on-accent)" strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ---- Component ---------------------------------------------------------------------

export default function VehiclePicker({
  reference, vehicleId, bodyType, onVehicleChange, onBodyChange, suggestedVehicleId = null, allowSuggest = true,
}: VehiclePickerProps) {
  const units = useUnits();
  const uid = useId();
  const name = `vehicle-${uid}`;
  const vehicles = sortVehicles(reference.vehicles);
  const suggestMode = vehicleId === SUGGEST;
  const selected = suggestMode ? null : reference.vehicles[vehicleId] ?? null;
  const suggested = suggestMode && suggestedVehicleId ? reference.vehicles[suggestedVehicleId] ?? null : null;
  const bodies = selected ? bodiesFor(selected, reference) : [];
  const bodyId = selected ? (bodyType ?? selected.default_body) : "";
  const body = bodyId ? reference.bodies[bodyId] : undefined;
  const bodySelectId = `${uid}-body`;
  const bodyInfoId = `${uid}-body-info`;

  return (
    <div className="vp">
      <fieldset className="vp-fieldset">
        <legend className="visually-hidden">Vehicle</legend>
        <div className="vp-grid">
          {allowSuggest && (
            <label className="vp-option vp-option-suggest">
              <input type="radio" className="vp-radio" name={name} value={SUGGEST} checked={suggestMode}
                     onChange={() => onVehicleChange(SUGGEST)} />
              <span className="vp-card">
                <span className="vp-suggest-row">
                  <SparkIcon />
                  <span className="vp-suggest-text">
                    <span className="vp-name">Suggest one:</span>{" "}
                    <span className="vp-meta">the smallest vehicle that fits</span>
                  </span>
                  <CheckIcon />
                </span>
                {suggested && (
                  <span className="vp-badges">
                    <span className="badge badge-success">Picked: {suggested.name}</span>
                  </span>
                )}
              </span>
            </label>
          )}

          {vehicles.map((v) => {
            const combos = containerSummary(v);
            const isSuggested = suggestMode && v.id === suggestedVehicleId;
            return (
              <label key={v.id} className={`vp-option${isSuggested ? " vp-option-suggested" : ""}`}>
                <input type="radio" className="vp-radio" name={name} value={v.id} checked={vehicleId === v.id}
                       onChange={() => onVehicleChange(v.id)} />
                <span className="vp-card">
                  <span className="vp-card-top">
                    <VehicleIcon category={v.category} />
                    <CheckIcon />
                  </span>
                  <span className="vp-name">{v.name}</span>
                  <span className="vp-meta num">
                    {v.pallet_spaces} pallet spaces
                    <span className="visually-hidden">,</span>
                    <br />
                    {units.weight(v.max_payload_kg)} payload
                  </span>
                  {(isSuggested || combos || v.route_restricted || v.configurable) && (
                    <span className="vp-badges">
                      {isSuggested && <span className="badge badge-success">Suggested</span>}
                      {combos && (
                        <span className="badge vp-badge-container" title="Containers it can carry">
                          <span className="visually-hidden">Containers: </span>{combos}
                        </span>
                      )}
                      {v.route_restricted && (
                        <span className="badge badge-warning" title={v.permit_note}>Route approval</span>
                      )}
                      {v.configurable && <span className="badge badge-info">Configurable</span>}
                    </span>
                  )}
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      {suggestMode ? (
        <p className="vp-details subtle">
          {suggested
            ? <>The planner picked the <strong>{suggested.name}</strong>, on its default body. Choose a vehicle to change the body type.</>
            : "Each vehicle is tried on its default body, smallest first."}
        </p>
      ) : selected ? (
        <div className="vp-details">
          {bodies.length > 0 && (
            <div className="field">
              <label className="field-label" htmlFor={bodySelectId}>Body type</label>
              <select id={bodySelectId} className="select" value={bodyId} aria-describedby={bodyInfoId}
                      onChange={(e) => onBodyChange(e.target.value === selected.default_body ? null : e.target.value)}>
                {bodies.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}{b.id === selected.default_body ? " (default)" : ""}</option>
                ))}
              </select>
              <div id={bodyInfoId} className="vp-body-info">
                {body && accessLabel(body) && <span className="badge">{accessLabel(body)}</span>}
                {body?.temp_controlled && <span className="badge badge-info">Refrigerated</span>}
                {body?.carries_containers && <span className="badge">Carries containers</span>}
              </div>
            </div>
          )}
          {selected.permit_note && (
            <p className={`vp-permit small ${selected.route_restricted ? "vp-permit-restricted" : ""}`}>
              {selected.route_restricted && <strong>Route approval: </strong>}
              {selected.permit_note}
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}
