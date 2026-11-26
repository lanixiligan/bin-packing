// FFD vs OR-Tools for a solved plan, in the demo's summary and 2D/3D truck
// views, then "Save as draft" with the chosen method.
import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, unwrap, type Schemas } from "../../api/client";
import { errorMessage } from "../../api/errors";
import ResultPanel from "../../components/ResultPanel.jsx";
import Summary from "../../components/Summary.jsx";
import { describeSize } from "../../components/capacity";
import { NARROW_SCREEN, useMediaQuery } from "../../useMediaQuery.js";
import { methodName, methodPanelData, placements, summaryData } from "./solveView";
import { useDropAnimation } from "./useDropAnimation";
import ViewToggle, { type TruckView } from "./ViewToggle";

type Method = "ffd" | "ortools";

export default function SolveComparison({ plan, result, replacing = false, onSaved }: {
  plan: Schemas["PlanRead"];
  result: Schemas["SolveResult"];
  /** The plan already has loads: saving replaces them (and any moves made since). */
  replacing?: boolean;
  onSaved?: () => void;
}) {
  const qc = useQueryClient();
  const narrow = useMediaQuery(NARROW_SCREEN);
  const [view, setView] = useState<TruckView>("2d");
  const [hoverId, setHoverId] = useState<number | null>(null);
  const [focusId, setFocusId] = useState<number | null>(null);
  const [method, setMethod] = useState<Method>(result.ortools ? result.recommended : "ffd");
  const { step, replay } = useDropAnimation(result.units.length);

  const ffdData = useMemo(() => methodPanelData(result, result.ffd), [result]);
  const ortoolsData = useMemo(() => (result.ortools ? methodPanelData(result, result.ortools) : null), [result]);
  const where = useMemo(() => placements(result), [result]);
  const activeId = hoverId ?? focusId;
  const active = activeId != null ? where.get(activeId) : undefined;
  const linkProps = { activeId, onHover: setHoverId, onFocusBlock: setFocusId };

  const save = useMutation({
    mutationFn: () => unwrap(api.POST("/api/ops/plans/{plan_id}/draft", { params: { path: { plan_id: plan.id } }, body: { method } })),
    onSuccess: (p) => {
      qc.setQueryData(["ops", "plan", plan.id], p);
      void qc.invalidateQueries({ queryKey: ["ops"] });
      onSaved?.();
    },
  });

  const optimum = result.ortools?.num_loads ?? null;
  const height = narrow ? 200 : 280;

  return (
    <div className="results">
      <Summary result={summaryData(result)} noun="load" />

      <section className="card save-draft" aria-labelledby="save-h">
        <h2 id="save-h">Save a draft</h2>
        {replacing ? (
          <p className="warn-text small">Saving replaces the draft's current loads, including any lines you moved and the vehicles and drivers you assigned.</p>
        ) : (
          <p className="muted small">The draft's loads can still be edited: move lines between loads, assign vehicles and drivers, then lock the plan.</p>
        )}
        <fieldset className="method-choice">
          <legend>Which plan?</legend>
          {(["ortools", "ffd"] as const).map((m) => {
            const r = result[m];
            return (
              <label key={m} className={`method-option${method === m ? " on" : ""}`}>
                <input type="radio" name="method" value={m} checked={method === m} disabled={!r} onChange={() => setMethod(m)} />
                <span>
                  <b>{methodName(m)}</b>: {r ? `${r.num_loads} load${r.num_loads === 1 ? "" : "s"}` : "no solution"}
                  {result.recommended === m && r ? <span className="chip good-chip">Recommended</span> : null}
                </span>
              </label>
            );
          })}
        </fieldset>
        <div className="form-actions">
          <button type="button" className="primary" disabled={save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? "Saving…" : `Save ${methodName(method)} plan as draft`}
          </button>
          <button type="button" className="secondary" onClick={replay}>↻ Replay animation</button>
        </div>
        {save.error ? <div className="error" role="alert">⚠️ {errorMessage(save.error)}</div> : null}
      </section>

      <div className={`inspector${active ? " on" : ""}`} aria-hidden="true">
        {active ? (
          <>
            <span className="inspector-name">{active.unit.item_name}</span>
            <span>{active.unit.order_reference}</span>
            <span>{describeSize({ weight_kg: active.unit.weight_kg, volume_m3: active.unit.volume_m3, pallets: active.unit.pallets })}</span>
            <span>FFD: <b>load {active.ffd}</b></span>
            {active.ortools != null && <span>OR-Tools: <b>load {active.ortools}</b></span>}
          </>
        ) : (
          <span className="muted">Hover over an item, or Tab to it, to see where each method put it. Items of one order share a color.</span>
        )}
      </div>
      <ViewToggle view={view} onChange={setView} />
      <div className="panels">
        <ResultPanel
          title="FFD (quick rule)"
          explanation="Sort items by their largest share of the capacity. Put each one in the first load where every dimension still fits; open a new load if none does."
          data={ffdData}
          capacity={result.capacity}
          step={step}
          truckHeight={height}
          optimumTrucks={optimum}
          badge={result.ffd.optimal
            ? { text: "Optimal (hits lower bound)", kind: "good" }
            : { text: "Heuristic – not guaranteed best", kind: "neutral" }}
          view={view}
          noun="load"
          {...linkProps}
        />
        {ortoolsData && result.ortools ? (
          <ResultPanel
            title="OR-Tools (optimal)"
            explanation="CP-SAT searches all loadings for the fewest loads, starting from FFD's answer, and proves when no better one exists."
            data={ortoolsData}
            capacity={result.capacity}
            step={step}
            truckHeight={height}
            badge={result.ortools.optimal
              ? { text: "Proven optimal", kind: "good" }
              : { text: `Best found in ${result.time_limit_s} s (not proven)`, kind: "warn" }}
            view={view}
            noun="load"
            {...linkProps}
          />
        ) : (
          <section className="card panel" aria-label="OR-Tools">
            <h2>OR-Tools</h2>
            <p className="muted">OR-Tools found no solution within {result.time_limit_s} s. Save the FFD plan instead.</p>
          </section>
        )}
      </div>
    </div>
  );
}
