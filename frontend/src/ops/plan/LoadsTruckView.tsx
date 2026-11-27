// A plan's current loads in the shared 2D/3D truck views (read-only picture;
// editing happens on the load cards).
import { useMemo, useState } from "react";
import type { Schemas } from "../../api/client";
import ResultPanel from "../../components/ResultPanel.jsx";
import { describeSize } from "../../components/capacity";
import { palletFootprint } from "../../components/deck";
import { NARROW_SCREEN, useMediaQuery } from "../../useMediaQuery.js";
import { loadsPanelData } from "./solveView";
import ViewToggle, { type TruckView } from "./ViewToggle";

export default function LoadsTruckView({ plan }: { plan: Schemas["PlanRead"] }) {
  const narrow = useMediaQuery(NARROW_SCREEN);
  const [view, setView] = useState<TruckView>("2d");
  const [hoverId, setHoverId] = useState<number | null>(null);
  const [focusId, setFocusId] = useState<number | null>(null);
  const data = useMemo(() => loadsPanelData(plan.loads), [plan.loads]);
  const activeId = hoverId ?? focusId;
  const active = findShipment(data.trucks, activeId);
  const capacity = {
    weight_kg: plan.vehicle.max_weight_kg, volume_m3: plan.vehicle.max_volume_m3, pallets: plan.vehicle.max_pallets,
  };

  return (
    <section className="loads-truck-view" aria-labelledby="truck-view-h">
      <h2 id="truck-view-h" className="section-title">Loads in the truck view</h2>
      <div className={`inspector${active ? " on" : ""}`} aria-hidden="true">
        {active ? (
          <>
            <span className="inspector-name">{active.s.name}</span>
            <span>{active.s.detail}</span>
            <span>{describeSize({ weight_kg: active.s.weight, volume_m3: active.s.volume, pallets: active.s.pallets })}</span>
            {active.s.pallets > 0 && <span>{palletFootprint(active.s.pallets)}</span>}
            <span>Load <b>{active.load}</b></span>
          </>
        ) : (
          <span className="muted">Hover over a line, or Tab to it, to see what it is (and its dangerous goods class). Lines of one order share a color.</span>
        )}
      </div>
      <ViewToggle view={view} onChange={setView} />
      <ResultPanel
        title={`Plan #${plan.id}`}
        data={data}
        capacity={capacity}
        step={data.drop_order.length}
        truckHeight={narrow ? 200 : 260}
        view={view}
        noun="load"
        headingLevel={3}
        activeId={activeId}
        onHover={setHoverId}
        onFocusBlock={setFocusId}
      />
    </section>
  );
}

function findShipment(trucks: ReturnType<typeof loadsPanelData>["trucks"], id: number | null) {
  if (id == null) return null;
  for (const t of trucks) {
    const s = t.shipments.find((x) => x.id === id);
    if (s) return { s, load: t.truck };
  }
  return null;
}
