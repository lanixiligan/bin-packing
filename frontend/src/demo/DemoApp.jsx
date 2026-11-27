import { useEffect, useMemo, useRef, useState } from "react";
import ShipmentTable from "./components/ShipmentTable.jsx";
import ResultPanel from "./components/ResultPanel.jsx";
import Summary from "./components/Summary.jsx";
import VehiclePicker from "../planner/components/VehiclePicker.tsx";
import { fetchReference } from "../planner/api/client.ts";
import { checkAll } from "../dg/rules.ts";
import { demoDg, MAX_SHIPMENTS, RANDOM_COUNT, randomShipments, toRequest } from "./shipments.js";
import { fitProblems, inputProblem, KNOWN_PALLETS, volumeOf } from "./components/sizes.ts";
import { DEFAULT_VEHICLE, demoReference, vehicleFit, vehicleLine } from "./components/vehicle.ts";
import { NARROW_SCREEN, REDUCED_MOTION, useMediaQuery } from "./useMediaQuery.js";
import DemoHeader from "./DemoHeader.jsx";
import { useTheme } from "./useTheme.js";
import "./demo.css";

const DROP_INTERVAL_MS = 150; // time between each shipment dropping in
const SOLVER_TIME_LIMIT_S = 10; // matches TIME_LIMIT_SECONDS in backend/app/routers/demo.py

/** "'Pipes 04' (too long or wide), 'Tiles 07' (too heavy)" for the Solve error. */
function listProblems(rows) {
  const shown = rows.slice(0, 5).map(({ s, why }) => `'${s.name}' (${why})`).join(", ");
  return rows.length > 5 ? `${shown} and ${rows.length - 5} more` : shown;
}

export default function App() {
  const [theme, setTheme] = useTheme();
  const [reference, setReference] = useState({ status: "loading", data: null, error: "" });
  const [vehicleId, setVehicleId] = useState(DEFAULT_VEHICLE);
  const [bodyType, setBodyType] = useState(null); // null = the vehicle's default body
  const [pickerOpen, setPickerOpen] = useState(false);
  const [shipments, setShipments] = useState(() => randomShipments());
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [elapsed, setElapsed] = useState(0); // seconds since Solve was pressed
  const [step, setStep] = useState(0); // how many shipments have "dropped" so far
  const [undoList, setUndoList] = useState(null); // shipments removed by "Clear all"
  const [hoverIds, setHoverIds] = useState(null); // shipment ids under the pointer (a stack is several)
  const [focusIds, setFocusIds] = useState(null);
  const [hoverTruck, setHoverTruck] = useState(null); // truck card under the pointer
  const [view, setView] = useState("2d"); // "2d" deck plans or "3d" trucks
  const [ruleSet, setRuleSet] = useState("adg"); // "adg" or "northline" (dangerous goods rules)
  const timer = useRef(null);
  const errorRef = useRef(null);
  const changeRef = useRef(null);
  const panelRef = useRef(null);
  const referenceRequest = useRef(null);

  const reducedMotion = useMediaQuery(REDUCED_MOTION);
  const narrowScreen = useMediaQuery(NARROW_SCREEN);

  // The vehicles the demo offers, and what the chosen one holds (null until the reference is in).
  const demoRef = useMemo(() => (reference.data ? demoReference(reference.data) : null), [reference.data]);
  const fit = useMemo(() => (demoRef ? vehicleFit(demoRef, vehicleId, bodyType) : null), [demoRef, vehicleId, bodyType]);
  const pallets = reference.data?.pallets ?? KNOWN_PALLETS;
  const vehicleName = demoRef?.vehicles[vehicleId]?.name ?? "truck";

  const totalWeight = shipments.reduce((s, x) => s + (Number(x.weight) || 0), 0);
  const totalVolume = shipments.reduce((s, x) => s + volumeOf(x, pallets), 0);
  const weightBound = fit ? Math.ceil(totalWeight / fit.payloadKg) : null;
  const activeIds = hoverIds ?? focusIds; // shipments highlighted in the table and the trucks
  const dgCount = shipments.filter((s) => s.dgClass).length;
  // Pairs of shipments that must travel apart (the server decides on Solve).
  const dgConflicts = useMemo(
    () => (dgCount ? checkAll(shipments, (s) => demoDg(s.dgClass, s.subsidiary)).filter((p) => p.status === "incompatible").length : 0),
    [shipments, dgCount]
  );

  // ---- Reference data: the vehicles and pallet types -----------------------
  function loadReference() {
    referenceRequest.current?.abort();
    const ctrl = new AbortController();
    referenceRequest.current = ctrl;
    setReference({ status: "loading", data: null, error: "" });
    fetchReference(ctrl.signal)
      .then((data) => setReference({ status: "ready", data, error: "" }))
      .catch((e) => {
        if (e.name !== "AbortError") setReference({ status: "error", data: null, error: e.message });
      });
  }
  useEffect(() => {
    loadReference();
    return () => referenceRequest.current?.abort();
  }, []);

  // ---- Animation: bump `step` until every shipment has dropped ----------
  function startAnimation(n) {
    clearInterval(timer.current);
    setHoverIds(null);
    setFocusIds(null);
    if (reducedMotion) {
      setStep(n); // show the final loading at once
      return;
    }
    setStep(0);
    timer.current = setInterval(() => {
      setStep((s) => {
        if (s >= n) {
          clearInterval(timer.current);
          return s;
        }
        return s + 1;
      });
    }, DROP_INTERVAL_MS);
  }
  useEffect(() => () => clearInterval(timer.current), []);

  // If the user turns on reduced motion mid-animation, finish it right away.
  useEffect(() => {
    if (reducedMotion && result) {
      clearInterval(timer.current);
      setStep(result.drop_order.length);
    }
  }, [reducedMotion, result]);

  // ---- Progress while the request is running ----------------------------
  useEffect(() => {
    if (!loading) return;
    const started = performance.now();
    setElapsed(0);
    const id = setInterval(() => setElapsed((performance.now() - started) / 1000), 200);
    return () => clearInterval(id);
  }, [loading]);

  // Solve the random shipments straight away, so the page opens on an answer. The random
  // shipments already fit the default vehicle, so this doesn't wait for the reference data.
  useEffect(() => {
    solve();
  }, []);

  // Keep a new error message visible (it lives next to the Solve button).
  useEffect(() => {
    if (error) errorRef.current?.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "nearest" });
  }, [error, reducedMotion]);

  // Opening the vehicle cards puts focus on the chosen one (arrow keys then move between them).
  useEffect(() => {
    if (pickerOpen) panelRef.current?.querySelector("input[type=radio]:checked")?.focus();
  }, [pickerOpen, demoRef]);

  // ---- Validation done in the browser (the backend checks again) --------
  function validate() {
    if (shipments.length === 0) return "Add at least one shipment.";
    if (shipments.length > MAX_SHIPMENTS) return `One solve takes at most ${MAX_SHIPMENTS} shipments; remove ${shipments.length - MAX_SHIPMENTS}.`;
    const incomplete = shipments.map((s) => ({ s, why: inputProblem(s) })).filter((x) => x.why);
    if (incomplete.length) return `Some shipments aren't complete yet: ${listProblems(incomplete)}.`;
    const never = shipments
      .map((s) => {
        const p = fitProblems(s, fit, pallets);
        const why = [p.tooLong && "too long or wide", p.tooTall && "too tall", p.tooHeavy && "too heavy"].filter(Boolean);
        return { s, why: why.join(", ") };
      })
      .filter((x) => x.why);
    if (never.length) return `These shipments can never go on a ${vehicleName}: ${listProblems(never)}. Choose a bigger vehicle or change them.`;
    return "";
  }

  function clearResult() {
    clearInterval(timer.current);
    setResult(null);
    setHoverIds(null);
    setFocusIds(null);
    setHoverTruck(null);
  }

  async function solve() {
    const msg = validate();
    setError(msg);
    clearResult();
    if (msg) return;
    setLoading(true);
    try {
      const res = await fetch("/api/solve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(toRequest({ vehicleId, bodyType, ruleSet, shipments })),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // FastAPI puts messages in `detail` (a string, or a list for type errors)
        const detail = Array.isArray(data.detail)
          ? data.detail.map((d) => String(d.msg).replace(/^Value error, /, "")).join("; ")
          : data.detail;
        throw new Error(detail || `Server error (${res.status})`);
      }
      setResult(data);
      startAnimation(data.drop_order.length);
    } catch (e) {
      setError(
        e instanceof TypeError
          ? "Cannot reach the backend. Is it running on port 8000?"
          : e.message
      );
    } finally {
      setLoading(false);
    }
  }

  function changeShipments(next) {
    setShipments(next);
    setUndoList(null); // undo only covers the most recent "Clear all"
    clearResult(); // old result no longer matches the inputs
  }

  function clearAll() {
    if (!shipments.length) return;
    const previous = shipments;
    changeShipments([]);
    setUndoList(previous);
  }

  function undoClear() {
    setShipments(undoList);
    setUndoList(null);
  }

  function randomise() {
    const longest = fit ? Math.max(...fit.decks.map((d) => d.length_mm)) : undefined;
    const inside = fit ? Math.max(...fit.decks.map((d) => d.height_mm)) : undefined;
    changeShipments(randomShipments(RANDOM_COUNT, Math.random, { maxLengthMm: longest, maxHeightMm: inside }));
  }

  function chooseVehicle(id) {
    setVehicleId(id);
    setBodyType(null);
    clearResult();
  }

  function closePicker() {
    setPickerOpen(false);
    requestAnimationFrame(() => changeRef.current?.focus());
  }

  // Where each shipment ended up: id -> { shipment, truck }
  const placement = useMemo(() => {
    const map = {};
    for (const t of result?.trucks ?? []) {
      for (const s of t.shipments) map[s.id] = { shipment: s, truck: t.truck };
    }
    return map;
  }, [result]);

  const linkProps = { activeIds, onHover: setHoverIds, onFocusBlock: setFocusIds };

  return (
    <div className="app demo">
      <DemoHeader theme={theme} onTheme={setTheme} />

      <main className="demo-main">
        <section className="card toolbar" aria-label="Trucks">
          <div className="toolbar-fields">
            <div className="field vehicle-field">
              <span className="field-label">Truck</span>
              <div className="vehicle-line">
                <span className="vehicle-text">
                  {demoRef
                    ? vehicleLine(demoRef, vehicleId, bodyType)
                    : reference.status === "loading" ? "Loading vehicles…" : vehicleId}
                </span>
                <button
                  ref={changeRef}
                  type="button"
                  className="btn btn-sm"
                  aria-expanded={pickerOpen}
                  aria-controls="vehicle-panel"
                  onClick={() => (pickerOpen ? closePicker() : setPickerOpen(true))}
                >
                  Change<span className="sr-only"> truck</span>
                </button>
              </div>
            </div>
            <div className="field">
              <span className="field-label" id="rule-set-label">Dangerous goods rules</span>
              <fieldset className="segmented" aria-labelledby="rule-set-label">
                {[["adg", "ADG Code"], ["northline", "ADG + Northline"]].map(([v, label]) => (
                  <label key={v}>
                    <input
                      type="radio"
                      name="rule-set"
                      value={v}
                      checked={ruleSet === v}
                      onChange={() => {
                        setRuleSet(v);
                        clearResult();
                      }}
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </fieldset>
            </div>
          </div>
          <div className="toolbar-actions">
            <button type="button" className="btn" onClick={randomise}>
              Random shipments
            </button>
            <button type="button" className="btn btn-ghost" onClick={clearAll} disabled={!shipments.length}>
              Clear
            </button>
            <button type="button" className="btn btn-primary" onClick={solve} disabled={loading}>
              {loading ? "Solving…" : "Solve"}
            </button>
          </div>
          {reference.status === "error" && (
            <p className="toolbar-errors field-error" role="alert">
              Couldn’t load the vehicles ({reference.error}). Solving uses the {vehicleId === DEFAULT_VEHICLE ? "default 8 t rigid" : vehicleId}.{" "}
              <button type="button" className="link-button" onClick={loadReference}>Try again</button>
            </p>
          )}
          {pickerOpen && (
            <div
              id="vehicle-panel"
              ref={panelRef}
              className="vehicle-panel"
              role="region"
              aria-label="Choose the truck"
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  closePicker();
                }
              }}
            >
              {demoRef ? (
                <VehiclePicker
                  reference={demoRef}
                  vehicleId={vehicleId}
                  bodyType={bodyType}
                  onVehicleChange={chooseVehicle}
                  onBodyChange={(b) => {
                    setBodyType(b);
                    clearResult();
                  }}
                  allowSuggest={false}
                />
              ) : (
                <p className="muted small">
                  {reference.status === "loading" ? "Loading vehicles…" : "The vehicle list isn’t available right now."}
                </p>
              )}
              <div className="vehicle-panel-actions">
                <button type="button" className="btn btn-sm btn-primary" onClick={closePicker}>Done</button>
              </div>
            </div>
          )}
        </section>

        <div role="status" className="notice-slot">
          {undoList && (
            <div className="notice">
              Cleared {undoList.length} shipment{undoList.length === 1 ? "" : "s"} ·{" "}
              <button type="button" className="link-button" onClick={undoClear}>Undo</button>
            </div>
          )}
        </div>
        <div ref={errorRef} role="alert" className="alert-slot">
          {error && <div className="error">{error}</div>}
        </div>

        <div className="workspace">
          <section className="card results" aria-labelledby="results-title">
            {loading ? (
              <SolvingProgress elapsed={elapsed} count={shipments.length} />
            ) : result ? (
              <>
                <Summary result={result}>
                  <div className="answer-tools">
                    <fieldset className="segmented view-toggle" aria-label="Truck view">
                      {[["2d", "2D"], ["3d", "3D"]].map(([v, label]) => (
                        <label key={v}>
                          <input type="radio" name="truck-view" value={v} checked={view === v} onChange={() => setView(v)} />
                          <span>{label}</span>
                        </label>
                      ))}
                    </fieldset>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => startAnimation(result.drop_order.length)}
                    >
                      <span aria-hidden="true">↻</span> Replay
                    </button>
                  </div>
                </Summary>
                <ResultPanel
                  data={result}
                  step={step}
                  view={view}
                  narrow={narrowScreen}
                  activeTruck={hoverTruck}
                  onHoverTruck={setHoverTruck}
                  {...linkProps}
                />
              </>
            ) : (
              <div className="results-empty">
                <h2 id="results-title">Ready to solve</h2>
                <p className="muted">
                  {shipments.length
                    ? <>Press <b>Solve</b> to load {shipments.length} shipment{shipments.length === 1 ? "" : "s"} into
                      the fewest trucks{weightBound ? <> (at least {weightBound} by weight)</> : null}.</>
                    : <>Add shipments, or press <b>Random shipments</b>.</>}
                </p>
                <p className="muted small">
                  Google OR-Tools (CP-SAT) places every shipment on the decks of the fewest identical trucks,
                  stacking where it can, and proves when no better loading exists. Incompatible dangerous goods
                  (ADG Code Table 9.1) never share a truck.
                </p>
              </div>
            )}
          </section>

          <section className="card shipments" aria-labelledby="shipments-title">
            <div className="shipments-head">
              <h2 id="shipments-title">Shipments</h2>
              <p className="shipments-stats">
                <span className="num">{shipments.length}</span> · <span className="num">{totalWeight.toLocaleString()}</span> kg
                · <span className="num">{totalVolume.toLocaleString(undefined, { maximumFractionDigits: 1 })}</span> m³
              </p>
            </div>
            {dgCount > 0 && (
              <p className="dg-quick">
                <b className="num">{dgCount}</b> dangerous goods · <b className="num">{dgConflicts}</b> incompatible
                pair{dgConflicts === 1 ? "" : "s"}
              </p>
            )}
            <ShipmentTable
              shipments={shipments}
              fit={fit}
              pallets={pallets}
              onChange={changeShipments}
              ruleSet={ruleSet}
              placement={result ? placement : null}
              activeIds={activeIds}
              activeTruck={hoverTruck}
              onHover={setHoverIds}
            />
          </section>
        </div>
      </main>
    </div>
  );
}

function SolvingProgress({ elapsed, count }) {
  const shown = Math.min(elapsed, SOLVER_TIME_LIMIT_S);
  return (
    <div className="progress">
      <h2 id="results-title" className="progress-title" role="status">
        Solving {count} shipment{count === 1 ? "" : "s"}…
      </h2>
      <p className="muted small">
        OR-Tools keeps searching until it proves the best loading, or stops at
        the {SOLVER_TIME_LIMIT_S} s limit with the best one found.
      </p>
      <progress max={SOLVER_TIME_LIMIT_S} value={shown} aria-label="Time used of the solver limit" />
      <p className="small progress-time" aria-hidden="true">
        {shown.toFixed(1)} s of up to {SOLVER_TIME_LIMIT_S} s
      </p>
    </div>
  );
}
