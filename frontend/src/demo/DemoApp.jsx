import { useEffect, useMemo, useRef, useState } from "react";
import ShipmentForm from "../components/ShipmentForm.jsx";
import ResultPanel from "../components/ResultPanel.jsx";
import Summary from "../components/Summary.jsx";
import { dgClassText } from "../components/capacity.ts";
import { palletFootprint } from "../components/deck.ts";
import { checkAll } from "../dg/rules.ts";
import { demoDg, FFD_LOSES_EXAMPLE, randomShipments, shipmentsFromWeights } from "../shipments.js";
import { NARROW_SCREEN, REDUCED_MOTION, SMALL_SCREEN, useMediaQuery } from "../useMediaQuery.js";

const DROP_INTERVAL_MS = 150; // time between each shipment dropping in
const SOLVER_TIME_LIMIT_S = 10; // matches TIME_LIMIT_SECONDS in backend/app/routers/demo.py

// The capacity field is kept as text so it can be empty while typing.
function capacityProblem(text) {
  if (text.trim() === "") return "Enter the truck capacity in kg.";
  const n = Number(text);
  if (!(n > 0)) return "Truck capacity must be a positive number.";
  if (!Number.isInteger(n)) return "Truck capacity must be a whole number of kg.";
  return "";
}

// Pallet spaces per truck: blank means not limited.
function palletsProblem(text) {
  if (text.trim() === "") return "";
  const n = Number(text);
  if (!Number.isInteger(n) || n < 1 || n > 100) return "Pallet spaces must be a whole number from 1 to 100, or blank.";
  return "";
}

const palletsOf = (s) => Math.max(0, Number(s.pallets) || 0);

/**
 * Summary.jsx's result with a per-dimension lower bound when the trucks have a
 * pallet limit (the bound is then the larger of the weight and pallet bounds).
 */
function summaryResult(result) {
  if (!result.max_pallets) return result;
  const shipments = result.ffd.trucks.flatMap((t) => t.shipments);
  const pallets = shipments.reduce((sum, s) => sum + palletsOf(s), 0);
  const byWeight = Math.ceil(result.total_weight / result.capacity);
  const byPallets = Math.ceil(pallets / result.max_pallets);
  const details = [
    { label: "Weight", text: `⌈${result.total_weight.toLocaleString()} ÷ ${result.capacity.toLocaleString()}⌉ = ${byWeight}`, binding: byWeight === result.lower_bound },
    { label: "Pallets", text: `⌈${pallets} ÷ ${result.max_pallets}⌉ = ${byPallets}`, binding: byPallets === result.lower_bound },
  ];
  const binding = details.filter((d) => d.binding).map((d) => d.label.toLowerCase()).join(" and ");
  return { ...result, bound_note: `by ${binding}: no plan can use fewer`, bound_details: details };
}

export default function App() {
  const [capacityText, setCapacityText] = useState("1000");
  const [capacityChecked, setCapacityChecked] = useState(false); // show field error after blur/Solve
  const [palletsText, setPalletsText] = useState(""); // pallet spaces per truck, blank = not limited
  const [shipments, setShipments] = useState(() => randomShipments());
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [elapsed, setElapsed] = useState(0); // seconds since Solve was pressed
  const [step, setStep] = useState(0); // how many shipments have "dropped" so far
  const [undoList, setUndoList] = useState(null); // shipments removed by "Clear all"
  const [hoverId, setHoverId] = useState(null);
  const [focusId, setFocusId] = useState(null);
  const [view, setView] = useState("2d"); // "2d" bars or "3d" trucks
  const [ruleSet, setRuleSet] = useState("adg"); // "adg" or "northline" (dangerous goods rules)
  const timer = useRef(null);
  const resultsRef = useRef(null);
  const errorRef = useRef(null);

  const reducedMotion = useMediaQuery(REDUCED_MOTION);
  const smallScreen = useMediaQuery(SMALL_SCREEN);
  const narrowScreen = useMediaQuery(NARROW_SCREEN);

  const capError = capacityProblem(capacityText);
  const capacity = capError ? null : Number(capacityText); // null while invalid
  const palError = palletsProblem(palletsText);
  const maxPallets = palError || palletsText.trim() === "" ? null : Number(palletsText);
  const totalWeight = shipments.reduce((s, x) => s + (Number(x.weight) || 0), 0);
  const totalPallets = shipments.reduce((s, x) => s + palletsOf(x), 0);
  const lowerBound = capacity
    ? Math.max(Math.ceil(totalWeight / capacity), maxPallets ? Math.ceil(totalPallets / maxPallets) : 0)
    : null;
  const activeId = hoverId ?? focusId; // shipment highlighted in both panels
  const dgCount = shipments.filter((s) => s.dgClass).length;
  // Pairs of shipments that must travel apart (the server decides on Solve).
  const dgConflicts = useMemo(
    () => (dgCount ? checkAll(shipments, (s) => demoDg(s.dgClass, s.subsidiary)).filter((p) => p.status === "incompatible").length : 0),
    [shipments, dgCount]
  );

  // ---- Animation: bump `step` until every shipment has dropped ----------
  function startAnimation(n) {
    clearInterval(timer.current);
    setHoverId(null);
    setFocusId(null);
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
      setStep(result.ffd.drop_order.length);
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

  // On small screens the results are below the fold: bring the progress card,
  // and then the results that replace it, into view.
  useEffect(() => {
    if ((loading || result) && smallScreen) {
      resultsRef.current?.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "start" });
    }
    // only when a solve starts or a new result arrives, not on resize
  }, [loading, result]);

  // Keep a new error message visible (it lives next to the Solve button).
  useEffect(() => {
    if (error) errorRef.current?.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "nearest" });
  }, [error, reducedMotion]);

  // ---- Validation done in the browser (the backend checks again) --------
  function validate() {
    if (capError) return capError;
    if (palError) return palError;
    if (shipments.length === 0) return "Add at least one shipment.";
    const bad = shipments.find(
      (s) => !s.name.trim() || !(Number(s.weight) > 0) || !Number.isInteger(Number(s.weight))
    );
    if (bad) return "Every shipment needs a name and a whole-number weight above 0 kg.";
    const badPallets = shipments.find((s) => {
      const p = Number(s.pallets ?? 0);
      return !Number.isInteger(p) || p < 0 || p > 100;
    });
    if (badPallets) return `Pallet spaces must be a whole number from 0 to 100 ('${badPallets.name}').`;
    const tooBig = maxPallets ? shipments.filter((s) => palletsOf(s) > maxPallets) : [];
    if (tooBig.length) {
      return (
        `These shipments take more pallet spaces than a truck has (${maxPallets}) and can never fit: ` +
        tooBig.map((s) => `'${s.name}' (${palletsOf(s)} pallets)`).join(", ")
      );
    }
    const tooHeavy = shipments.filter((s) => Number(s.weight) > capacity);
    if (tooHeavy.length) {
      return (
        `These shipments are heavier than the truck capacity (${capacity} kg) ` +
        `and can never fit: ` +
        tooHeavy.map((s) => `'${s.name}' (${s.weight} kg)`).join(", ")
      );
    }
    return "";
  }

  function clearResult() {
    clearInterval(timer.current);
    setResult(null);
    setHoverId(null);
    setFocusId(null);
  }

  async function solve() {
    setCapacityChecked(true);
    const msg = validate();
    setError(msg);
    clearResult();
    if (msg) return;
    setLoading(true);
    try {
      const res = await fetch("/api/solve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          capacity,
          ...(maxPallets ? { max_pallets: maxPallets } : {}),
          // dg_class / subsidiary only for dangerous goods, so a plain request looks as before
          shipments: shipments.map((s) => ({
            name: s.name.trim(),
            weight: Number(s.weight),
            ...(s.dgClass ? { dg_class: s.dgClass } : {}),
            ...(s.subsidiary?.length ? { subsidiary: s.subsidiary } : {}),
            ...(palletsOf(s) ? { pallets: palletsOf(s) } : {}),
          })),
          rule_set: ruleSet,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // FastAPI puts messages in `detail` (a string, or a list for type errors)
        const detail = Array.isArray(data.detail)
          ? data.detail.map((d) => d.msg).join("; ")
          : data.detail;
        throw new Error(detail || `Server error (${res.status})`);
      }
      setResult(data);
      startAnimation(data.ffd.drop_order.length);
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

  function loadExample() {
    setCapacityText(String(FFD_LOSES_EXAMPLE.capacity));
    setCapacityChecked(false);
    setError("");
    changeShipments(shipmentsFromWeights(FFD_LOSES_EXAMPLE.weights));
  }

  // Where each shipment ended up, per method: id -> { ffd, ortools } truck numbers
  const placement = useMemo(() => {
    if (!result) return {};
    const map = {};
    for (const key of ["ffd", "ortools"]) {
      for (const t of result[key].trucks) {
        for (const s of t.shipments) {
          map[s.id] = { ...map[s.id], shipment: s, [key]: t.truck };
        }
      }
    }
    return map;
  }, [result]);

  const showCapError = capacityChecked && capError;
  // The capacity the truck views get: kg only, or kg and pallet spaces.
  const viewCapacity = result?.max_pallets ? { weight_kg: result.capacity, pallets: result.max_pallets } : result?.capacity;
  const usesPallets = Boolean(result?.max_pallets) || shipments.some((s) => palletsOf(s) > 0);
  const optimumTrucks = result ? result.ortools.num_trucks : null;
  const linkProps = { activeId, onHover: setHoverId, onFocusBlock: setFocusId };
  const active = activeId != null ? placement[activeId] : null;

  return (
    <div className="app">
      <header>
        <h1>🚚 Truck Loading Optimizer</h1>
        <p className="subtitle">
          The 1D bin packing problem: load every shipment using the fewest trucks.
          We compare a quick rule of thumb (First-Fit Decreasing) with Google OR-Tools.
        </p>
      </header>

      <section className="card controls" aria-label="Inputs">
        <div className="capacity-row">
          <div className="capacity-field">
            <label htmlFor="capacity">Truck capacity (kg)</label>
            <input
              id="capacity"
              type="number"
              min="1"
              inputMode="numeric"
              value={capacityText}
              aria-invalid={showCapError ? true : undefined}
              aria-describedby={showCapError ? "capacity-error" : undefined}
              onChange={(e) => {
                setCapacityText(e.target.value);
                setCapacityChecked(false); // no error while typing; checked again on blur or Solve
                clearResult();
              }}
              onBlur={() => setCapacityChecked(true)}
            />
            {showCapError && <span id="capacity-error" className="field-error">{capError}</span>}
          </div>
          <div className="capacity-field">
            <label htmlFor="max-pallets">Pallet spaces per truck</label>
            <input
              id="max-pallets"
              type="number"
              min="1"
              max="100"
              inputMode="numeric"
              placeholder="not limited"
              value={palletsText}
              aria-invalid={palError ? true : undefined}
              aria-describedby={palError ? "pallets-error" : "pallets-hint"}
              onChange={(e) => {
                setPalletsText(e.target.value);
                clearResult();
              }}
            />
            {palError
              ? <span id="pallets-error" className="field-error">{palError}</span>
              : <span id="pallets-hint" className="muted small">1165 × 1165 mm pallets, 2 across</span>}
          </div>
          <div className="quick-stats">
            <span><b>{shipments.length}</b> shipments</span>
            <span><b>{totalWeight.toLocaleString()}</b> kg total</span>
            <span><b>{totalPallets.toLocaleString()}</b> pallets</span>
            <span>Lower bound: <b>{lowerBound ?? "—"}</b> trucks</span>
            {dgCount > 0 && (
              <span className="dg-quick">
                <b>{dgCount}</b> dangerous goods · <b>{dgConflicts}</b> incompatible pair{dgConflicts === 1 ? "" : "s"}
              </span>
            )}
          </div>
          <fieldset className="rule-set">
            <legend>Dangerous goods rules</legend>
            <div className="rule-set-options">
              {[["adg", "ADG Code"], ["northline", "ADG + Northline"]].map(([v, label]) => (
                <label key={v} className={ruleSet === v ? "on" : ""}>
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
                  {label}
                </label>
              ))}
            </div>
          </fieldset>
        </div>

        <ShipmentForm shipments={shipments} capacity={capacity} maxPallets={maxPallets} onChange={changeShipments} ruleSet={ruleSet} />

        <div className="actions">
          <button type="button" onClick={() => changeShipments(randomShipments(capacity ?? undefined, 20))}>
            🎲 Load random shipments
          </button>
          <button type="button" onClick={loadExample}>
            🧪 Example where FFD loses
          </button>
          <button type="button" className="secondary" onClick={clearAll} disabled={!shipments.length}>
            Clear all
          </button>
          <button type="button" className="primary" onClick={solve} disabled={loading}>
            {loading ? "Solving…" : "▶ Solve"}
          </button>
          {result && (
            <button
              type="button"
              className="secondary"
              onClick={() => startAnimation(result.ffd.drop_order.length)}
            >
              ↻ Replay animation
            </button>
          )}
        </div>

        <div role="status" className="notice-slot">
          {undoList && (
            <div className="notice">
              Cleared {undoList.length} shipment{undoList.length === 1 ? "" : "s"} ·{" "}
              <button type="button" className="link-button" onClick={undoClear}>Undo</button>
            </div>
          )}
        </div>

        <div ref={errorRef} role="alert">
          {error && <div className="error">⚠️ {error}</div>}
        </div>
      </section>

      <div className="results" ref={resultsRef}>
        {loading && <SolvingProgress elapsed={elapsed} count={shipments.length} />}

        {result && <Summary result={summaryResult(result)} />}

        {result && (
          <>
            <div className={`inspector${active ? " on" : ""}`} aria-hidden="true">
              {active ? (
                <>
                  <span className="inspector-name">{active.shipment.name}</span>
                  <span>{active.shipment.weight} kg</span>
                  <span>{palletFootprint(active.shipment.pallets) || "loose freight"}</span>
                  {active.shipment.dg_class && <span>DG: <b>{dgClassText(active.shipment.dg_class, active.shipment.subsidiary)}</b></span>}
                  <span>FFD: <b>truck {active.ffd}</b></span>
                  <span>OR-Tools: <b>truck {active.ortools}</b></span>
                </>
              ) : (
                <span className="muted">
                  Hover over a shipment, or Tab to it, to see where each method put it.
                </span>
              )}
            </div>
            <div className="view-toggle" role="group" aria-label="Truck view">
              {[["2d", usesPallets ? "2D deck plan" : "2D bars"], ["3d", "3D trucks"]].map(([v, label]) => (
                <button
                  key={v}
                  type="button"
                  className={view === v ? "on" : ""}
                  aria-pressed={view === v}
                  onClick={() => setView(v)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="panels">
              <ResultPanel
                title="FFD (quick rule)"
                explanation="Sort shipments heaviest → lightest. Put each one in the first truck with room; open a new truck if none fits."
                data={result.ffd}
                capacity={viewCapacity}
                step={step}
                truckHeight={narrowScreen ? 200 : 280}
                optimumTrucks={optimumTrucks}
                badge={result.ffd.hits_lower_bound
                  ? { text: "Optimal (hits lower bound)", kind: "good" }
                  : { text: "Heuristic – not guaranteed best", kind: "neutral" }}
                view={view}
                {...linkProps}
              />
              <ResultPanel
                title="OR-Tools (optimal)"
                explanation="CP-SAT solver searches all possible loadings for the fewest trucks, and proves when no better answer exists."
                data={result.ortools}
                capacity={viewCapacity}
                step={step}
                truckHeight={narrowScreen ? 200 : 280}
                badge={result.ortools.optimal
                  ? { text: "Proven optimal", kind: "good" }
                  : { text: `Best found in ${result.ortools.time_limit_s} s (not proven)`, kind: "warn" }}
                view={view}
                {...linkProps}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function SolvingProgress({ elapsed, count }) {
  const shown = Math.min(elapsed, SOLVER_TIME_LIMIT_S);
  return (
    <section className="card progress-card" aria-label="Solving">
      <p className="progress-title" role="status">
        Solving {count} shipment{count === 1 ? "" : "s"}…
      </p>
      <p className="muted small">
        FFD finishes almost instantly. OR-Tools keeps searching until it proves the
        best answer, or stops at the {SOLVER_TIME_LIMIT_S} s limit.
      </p>
      <progress max={SOLVER_TIME_LIMIT_S} value={shown} aria-label="Time used of the solver limit" />
      <p className="small progress-time" aria-hidden="true">
        {shown.toFixed(1)} s of up to {SOLVER_TIME_LIMIT_S} s
      </p>
    </section>
  );
}
