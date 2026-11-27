import { lazy, Suspense } from "react";
import Truck from "./Truck.jsx";
import { addUsage, emptyUsage, limitedDims, sizeOf } from "./capacity.ts";

// three.js is large, so the 3D view is only downloaded when it's first shown.
const TruckScene3D = lazy(() => import("./TruckScene3D.jsx"));

// One method's result: title, badge, stats and its trucks in 2D or 3D.
// `capacity` is kg, or { weight_kg, pallets } when the trucks have a pallet
// limit (see capacity.ts). `badge` and `explanation` are optional.

/** "2 trucks · average fill: weight 81%, pallets 64%" with a pallet limit. */
function multiStats(data, capacity) {
  const n = data.trucks.length;
  const parts = limitedDims(capacity).map((d) => {
    let used = 0;
    let limit = 0;
    for (const t of data.trucks) {
      const u = t.shipments.reduce((acc, s) => addUsage(acc, sizeOf(s)), emptyUsage());
      used += u[d.field];
      limit += capacity[d.field] ?? 0;
    }
    return limit > 0 ? `${d.label.toLowerCase()} ${Math.round((100 * used) / limit)}%` : null;
  }).filter(Boolean);
  return (
    <>
      <b>{n}</b> {n === 1 ? "truck" : "trucks"}
      {parts.length > 0 && <> · average fill: {parts.join(", ")}</>}
    </>
  );
}

/**
 * @param {{
 *   title: string, explanation?: string | null, data: any, capacity: any, step: number,
 *   badge?: { text: string, kind: string } | null, truckHeight: number,
 *   activeId?: number | null, onHover?: (id: number | null) => void, onFocusBlock?: (id: number | null) => void,
 *   optimumTrucks?: number | null, view?: string,
 * }} props
 */
export default function ResultPanel({
  title, explanation = null, data, capacity, step, badge = null, truckHeight,
  activeId, onHover, onFocusBlock, optimumTrucks = null, view = "2d",
}) {
  const multi = typeof capacity === "object" && capacity !== null;
  // position of each shipment id in the drop sequence -> used for animation
  const dropIndex = {};
  data.drop_order.forEach((id, k) => (dropIndex[id] = k));

  const totalEmpty = multi ? 0 : data.trucks.reduce((s, t) => s + t.empty, 0);
  // Trucks numbered above the other method's count are the ones it didn't need.
  const extraCount = optimumTrucks != null ? Math.max(0, data.num_trucks - optimumTrucks) : 0;

  return (
    <section className={`card panel${activeId != null ? " linking" : ""}`} aria-label={title}>
      <div className="panel-head">
        <h2>{title}</h2>
        {badge && <span className={`badge ${badge.kind}`}>{badge.text}</span>}
      </div>
      {explanation && <p className="muted small">{explanation}</p>}
      <p className="panel-stats">
        {multi
          ? multiStats(data, capacity)
          : <><b>{data.num_trucks}</b> trucks · {totalEmpty.toLocaleString()} kg empty space in total</>}
        {extraCount > 0 && (
          <span className="panel-extra">
            {" "}· {extraCount} more than the optimum
          </span>
        )}
      </p>
      {view === "3d" ? (
        <Suspense fallback={<div className="scene3d scene3d-loading muted" style={{ height: truckHeight + 120 }}>Loading 3D view…</div>}>
          <TruckScene3D
            data={data}
            capacity={capacity}
            step={step}
            dropIndex={dropIndex}
            activeId={activeId}
            onHover={onHover}
            onFocusBlock={onFocusBlock}
            extraFrom={extraCount > 0 ? optimumTrucks : null}
            height={truckHeight + 120}
          />
        </Suspense>
      ) : (
        <div className="trucks">
          {data.trucks.map((t) => (
            <Truck
              key={t.truck}
              truck={t}
              numTrucks={data.num_trucks}
              capacity={capacity}
              height={truckHeight}
              step={step}
              dropIndex={dropIndex}
              activeId={activeId}
              onHover={onHover}
              onFocusBlock={onFocusBlock}
              extra={extraCount > 0 && t.truck > optimumTrucks}
            />
          ))}
        </div>
      )}
    </section>
  );
}
