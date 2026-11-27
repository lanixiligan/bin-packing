// The load planner page: 1) choose a vehicle (or "suggest one"), 2) add freight, 3) review the plan.
// Steps 1 and 2 stay compact (one line for the vehicle, one row per freight line) and open in place
// to edit, so the page needs little scrolling.
//
// Owns the state and the API calls; every panel is driven purely by the planner's response and
// never recalculates placement. A plan is requested automatically (debounced) whenever the inputs
// are valid, so a first result appears in seconds from the defaults (AU pallets on a semi-trailer).
//
// Split mode: when one truck isn't enough, "Split across trucks" switches the auto-planning to
// POST /api/plan/fleet, so every edit re-splits. Each truck of the answer is a full single-truck
// plan, shown one at a time behind tabs with the same panels; "Back to one truck" switches back.

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ApiError, fetchReference, postFleet, postPlan } from "./api/client.ts";
import type { FleetResult, MassScheme, PlanRequest, PlanResult, ReferenceData, RuleSet } from "./api/types.ts";
import { SUGGEST } from "./api/types.ts";
import { dgForcesSplit, splitBlocker, truckPanelId, truckTabId } from "./lib/fleet.ts";
import { sampleRows, validateRows, type FreightRow } from "./lib/freight.ts";
import { useUnits, type UnitSystem } from "./lib/units.ts";
import { UnitsProvider } from "./lib/UnitsProvider.tsx";
import AxleLoadPanel from "./components/AxleLoadPanel.tsx";
import Disclaimer from "./components/Disclaimer.tsx";
import EmptyState from "./components/EmptyState.tsx";
import ExportMenu from "./components/ExportMenu.tsx";
import FleetSummary from "./components/FleetSummary.tsx";
import FreightTable from "./components/FreightTable.tsx";
import LoadPlanView from "./components/LoadPlanView.tsx";
import PlanStatus from "./components/PlanStatus.tsx";
import TruckTabs from "./components/TruckTabs.tsx";
import UtilisationSummary from "./components/UtilisationSummary.tsx";
import VehicleStep from "./components/VehicleStep.tsx";
import WarningsList from "./components/WarningsList.tsx";
import "./styles/tokens.css";
import "./styles/base.css";
import "./PlannerApp.css";

export const DEFAULT_VEHICLE = "SEMI_TRAILER";
/** Dangerous goods are always checked against the ADG Code plus Northline's acceptance rules. */
const RULE_SET: RuleSet = "northline";
const PLAN_DEBOUNCE_MS = 350;

// ---- Theme -------------------------------------------------------------------

type Theme = "system" | "light" | "dark";
const THEME_KEY = "load-planner.theme";

function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      const t = localStorage.getItem(THEME_KEY);
      return t === "light" || t === "dark" ? t : "system";
    } catch {
      return "system";
    }
  });
  useEffect(() => {
    const root = document.documentElement;
    if (theme === "system") delete root.dataset.theme;
    else root.dataset.theme = theme;
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      // storage blocked: the choice lasts for this page only
    }
  }, [theme]);
  return [theme, setTheme];
}

// ---- Header ------------------------------------------------------------------

function Header({ theme, onTheme }: { theme: Theme; onTheme(t: Theme): void }) {
  const units = useUnits();
  return (
    <header className="app-header">
      <div className="app-header-inner">
        <div className="brand">
          <svg className="brand-mark" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M2 6h12v9H2zM14 9h4l3 3v3h-7z" fill="none" stroke="currentColor" strokeWidth="1.8"
                  strokeLinejoin="round" />
            <circle cx="6" cy="17" r="1.8" fill="currentColor" />
            <circle cx="17" cy="17" r="1.8" fill="currentColor" />
          </svg>
          <div>
            <h1>Load planner</h1>
            <p className="subtle">Fit freight onto Australian trucks and trailers</p>
          </div>
        </div>
        <div className="header-controls">
          <a className="btn btn-ghost btn-sm" href="/demo.html">Bin packing demo</a>
          <fieldset className="segmented" aria-label="Display units">
            {([["mm-kg", "mm · kg"], ["m-t", "m · t"]] as [UnitSystem, string][]).map(([value, label]) => (
              <label key={value}>
                <input type="radio" name="units" value={value} checked={units.system === value}
                       onChange={() => units.setSystem(value)} />
                <span>{label}</span>
              </label>
            ))}
          </fieldset>
          <fieldset className="segmented" aria-label="Colour theme">
            {([["system", "Auto"], ["light", "Light"], ["dark", "Dark"]] as [Theme, string][]).map(([value, label]) => (
              <label key={value}>
                <input type="radio" name="theme" value={value} checked={theme === value}
                       onChange={() => onTheme(value)} />
                <span>{label}</span>
              </label>
            ))}
          </fieldset>
        </div>
      </div>
    </header>
  );
}

// ---- Page ----------------------------------------------------------------------

function Step({ n, title, hint, children, id }: {
  n: number; title: string; hint?: string; children: React.ReactNode; id: string;
}) {
  return (
    <section className="step card" aria-labelledby={`${id}-title`}>
      <div className="step-header">
        <span className="step-number" aria-hidden="true">{n}</span>
        <div>
          <h2 id={`${id}-title`} className="step-title"><span className="visually-hidden">Step {n}: </span>{title}</h2>
          {hint && <p className="subtle">{hint}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

export function Planner({ initialReference = null }: { initialReference?: ReferenceData | null }) {
  const [theme, setTheme] = useTheme();
  const [reference, setReference] = useState<ReferenceData | null>(initialReference);
  const [refError, setRefError] = useState<string>("");
  const [vehicleId, setVehicleId] = useState<string>(DEFAULT_VEHICLE);
  const [bodyType, setBodyType] = useState<string | null>(null);
  const [massScheme, setMassScheme] = useState<MassScheme>("GML");
  const [rows, setRows] = useState<FreightRow[]>(() => sampleRows(initialReference));
  const [result, setResult] = useState<PlanResult | null>(null);
  const [resultRequest, setResultRequest] = useState<PlanRequest | null>(null);
  // Split mode: the freight across several trucks of the chosen vehicle. `result` (the single-truck
  // answer) is kept while it is on, so there is something to show until the first split arrives.
  const [split, setSplit] = useState(false);
  const [fleet, setFleet] = useState<FleetResult | null>(null);
  const [fleetRequest, setFleetRequest] = useState<PlanRequest | null>(null);
  const [truckIndex, setTruckIndex] = useState(0);
  const [planError, setPlanError] = useState<string>("");
  const [planning, setPlanning] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const tabsId = useId();

  // Reference data, loaded once (again on "Try again").
  const [refAttempt, setRefAttempt] = useState(0);
  useEffect(() => {
    if (initialReference) return;
    const ctrl = new AbortController();
    fetchReference(ctrl.signal)
      .then(setReference)
      .catch((err) => {
        if (err.name !== "AbortError") setRefError(err instanceof ApiError ? err.message : String(err));
      });
    return () => ctrl.abort();
  }, [initialReference, refAttempt]);
  const retryReference = () => {
    setRefError("");
    setRefAttempt((n) => n + 1);
  };

  const validation = useMemo(() => validateRows(rows, reference), [rows, reference]);
  const request = useMemo<PlanRequest | null>(() => (validation.items
    ? { items: validation.items, vehicle_id: vehicleId, body_type: bodyType, mass_scheme: massScheme, rule_set: RULE_SET }
    : null), [validation.items, vehicleId, bodyType, massScheme]);
  const requestKey = request ? JSON.stringify(request) : "";

  // Plan (or, in split mode, split) whenever the request changes (debounced); the latest request wins.
  useEffect(() => {
    if (!reference || !request) return;
    const timer = setTimeout(() => {
      abort.current?.abort();
      const ctrl = new AbortController();
      abort.current = ctrl;
      setPlanning(true);
      setPlanError("");
      const call = split
        ? postFleet(request, ctrl.signal).then((res) => {
          setFleet(res);
          setFleetRequest(request);
          setTruckIndex((i) => Math.min(i, Math.max(0, res.trucks.length - 1)));
        })
        : postPlan(request, ctrl.signal).then((res) => {
          setResult(res);
          setResultRequest(request);
        });
      call
        .catch((err) => {
          if (err.name === "AbortError") return;
          setPlanError(err instanceof ApiError ? err.message : String(err));
        })
        .finally(() => {
          if (abort.current === ctrl) setPlanning(false);
        });
    }, PLAN_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // requestKey stands for `request`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reference, requestKey, split]);

  useEffect(() => () => abort.current?.abort(), []);

  /** Turn split mode on or off: drop any answer on its way and start from a clean slate. */
  const switchSplit = (on: boolean) => {
    abort.current?.abort();
    setFleet(null);
    setFleetRequest(null);
    setTruckIndex(0);
    setPlanError("");
    if (request) setPlanning(true); // the new answer is on its way (after the debounce)
    setSplit(on);
    document.getElementById("load-plan")?.focus({ preventScroll: true }); // the clicked button is about to go
  };

  // What step 3 shows: the split once it has arrived, else the single-truck plan.
  const showFleet = split && fleet !== null && fleetRequest !== null;
  const shownRequest = showFleet ? fleetRequest : resultRequest;
  const hasAnswer = showFleet || Boolean(result && resultRequest);
  const stale = Boolean(hasAnswer && shownRequest && JSON.stringify(shownRequest) !== requestKey);
  const truck = showFleet ? Math.min(truckIndex, fleet.trucks.length - 1) : 0;
  const statusText = planning ? (split ? "Splitting across trucks…" : "Planning…")
    : planError ? ""
    : stale ? "Fix the freight lines to update the plan."
    : showFleet ? `Split across ${fleet.num_trucks} × ${fleet.vehicle_name}.`
    : result ? `Planned on the ${result.vehicle_name}.` : "";

  return (
    <div className="app">
      <a className="skip-link" href="#load-plan">Skip to the load plan</a>
      <Header theme={theme} onTheme={setTheme} />
      <div className="app-disclaimer"><Disclaimer variant="banner" /></div>

      {!reference ? (
        <main className="app-main app-main-single">
          <h2 className="visually-hidden">Getting started</h2>
          {refError ? (
            <EmptyState title="Can't load the vehicle and pallet data" tone="error"
                        action={<button type="button" className="btn btn-primary" onClick={retryReference}>Try again</button>}>
              <p>{refError}</p>
            </EmptyState>
          ) : (
            <div className="loading" role="status">Loading vehicles and pallet types…</div>
          )}
        </main>
      ) : (
        <main className="app-main">
          <div className="rail">
            <Step n={1} id="step-vehicle" title="Choose a vehicle">
              <VehicleStep reference={reference} vehicleId={vehicleId} bodyType={bodyType} massScheme={massScheme}
                           onVehicleChange={(id) => { setVehicleId(id); setBodyType(null); }}
                           onBodyChange={setBodyType} onMassSchemeChange={setMassScheme}
                           suggestedVehicleId={vehicleId === SUGGEST ? result?.vehicle_id ?? null : null} />
            </Step>
            <Step n={2} id="step-freight" title="Add freight" hint="Weights are per unit, including the pallet.">
              <FreightTable reference={reference} rows={rows} onRowsChange={setRows}
                            errors={validation.errors} listErrors={validation.listErrors} />
              <p className="rule-set">Dangerous goods are checked against the ADG Code and Northline&rsquo;s rules.</p>
            </Step>
          </div>

          <div className="workspace" id="load-plan" tabIndex={-1}>
            <section className="step card" aria-labelledby="step-plan-title" aria-busy={planning}>
              <div className="step-header">
                <span className="step-number" aria-hidden="true">3</span>
                <div className="step-header-text">
                  <h2 id="step-plan-title" className="step-title"><span className="visually-hidden">Step 3: </span>Review the load plan</h2>
                  <p className="subtle" role="status" aria-live="polite">{statusText}</p>
                </div>
                {showFleet
                  ? <ExportMenu fleet={fleet} request={fleetRequest} reference={reference} />
                  : result && resultRequest && <ExportMenu result={result} request={resultRequest} reference={reference} />}
              </div>

              {planError && (
                <EmptyState title={split ? "The planner couldn't split the load" : "The planner couldn't make a plan"} tone="error"
                            action={split && !showFleet
                              ? <button type="button" className="btn" onClick={() => switchSplit(false)}>Back to one truck</button>
                              : undefined}>
                  <p>{planError}</p>
                </EmptyState>
              )}
              {!hasAnswer && !planError && (
                validation.items ? (
                  <div className="loading" role="status">Working out the load…</div>
                ) : (
                  <EmptyState title="Add some freight to see a load plan"
                              action={<button type="button" className="btn" onClick={() => setRows(sampleRows(reference))}>Load sample freight</button>}>
                    <p>Fix or add lines in step 2. A plan appears here as soon as every line is complete.</p>
                  </EmptyState>
                )
              )}
              {showFleet ? (
                <div className={`plan fleet ${stale || planning ? "plan-stale" : ""}`}>
                  <FleetSummary fleet={fleet} request={fleetRequest} onBack={() => switchSplit(false)}
                                dgSeparated={dgForcesSplit(fleetRequest, result, resultRequest)} />
                  {fleet.trucks.length > 0 && (
                    <TruckTabs trucks={fleet.trucks} selected={truck} onSelect={setTruckIndex} idBase={tabsId} />
                  )}
                  {/* Every truck is rendered so print shows them all; on screen only the selected one. */}
                  {fleet.trucks.map((t, i) => (
                    <div key={i} className="plan fleet-panel" role="tabpanel" id={truckPanelId(tabsId, i)}
                         aria-labelledby={truckTabId(tabsId, i)} hidden={i !== truck}>
                      <h3 className="print-only fleet-panel-title">Truck {i + 1} of {fleet.trucks.length}</h3>
                      <PlanStatus result={t} reference={reference} />
                      <LoadPlanView result={t} reference={reference} request={fleetRequest} />
                      <div className="plan-panels">
                        <UtilisationSummary utilisation={t.utilisation} />
                        <AxleLoadPanel axleLoads={t.axle_loads} massScheme={t.mass_scheme} />
                      </div>
                      <WarningsList warnings={t.warnings} request={fleetRequest} />
                    </div>
                  ))}
                </div>
              ) : result && resultRequest && (
                <div className={`plan ${stale || planning ? "plan-stale" : ""}`}>
                  <PlanStatus result={result} reference={reference}
                              onSplit={split ? undefined : () => switchSplit(true)}
                              splitNote={split ? null : splitBlocker(resultRequest)} />
                  <LoadPlanView result={result} reference={reference} request={resultRequest} />
                  <div className="plan-panels">
                    <UtilisationSummary utilisation={result.utilisation} />
                    <AxleLoadPanel axleLoads={result.axle_loads} massScheme={result.mass_scheme} />
                  </div>
                  <WarningsList warnings={result.warnings} request={resultRequest} />
                </div>
              )}
            </section>
          </div>
        </main>
      )}
    </div>
  );
}

export default function PlannerApp() {
  return (
    <UnitsProvider>
      <Planner />
    </UnitsProvider>
  );
}
