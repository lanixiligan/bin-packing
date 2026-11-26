import { lazy, Suspense } from "react";
import Truck from "./Truck.jsx";
import { addUsage, emptyUsage, limitedDims, sizeOf } from "./capacity.ts";

// three.js is large, so the 3D view is only downloaded when it's first shown.
const TruckScene3D = lazy(() => import("./TruckScene3D.jsx"));

// One method's result: title, badge, stats and its trucks in 2D or 3D.
// `capacity` is a number for the 1D demo, or { weight_kg, volume_m3, pallets }
// for multi-dimension loads (see Truck.jsx); `noun` names the trucks in the
// stats line ("truck" in the demo, "load" for plans). `badge` and
// `explanation` are optional; `headingLevel` defaults to h2.

/** "2 loads · average fill: weight 81%, volume 64%" for multi-dimension panels. */
function multiStats(data, capacity, noun) {
  const n = data.trucks.length;
  const parts = limitedDims(capacity).map((d) => {
    let used = 0;
    let limit = 0;
    for (const t of data.trucks) {
      const cap = t.capacity ?? capacity;
      const u = t.shipments.reduce((acc, s) => addUsage(acc, sizeOf(s)), emptyUsage());
      used += u[d.field];
      limit += cap[d.field] ?? 0;
    }
    return limit > 0 ? `${d.label.toLowerCase()} ${Math.round((100 * used) / limit)}%` : null;
  }).filter(Boolean);
  return (
    <>
      <b>{n}</b> {n === 1 ? noun : `${noun}s`}
      {parts.length > 0 && <> · average fill: {parts.join(", ")}</>}
    </>
  );
}

export default function ResultPanel({
  title, explanation, data, capacity, step, badge, truckHeight,
  activeId, onHover, onFocusBlock, optimumTrucks, view = "2d", noun = "truck", headingLevel = 2,
}) {
  const multi = typeof capacity === "object" && capacity !== null;
  const Heading = `h${headingLevel}`;
  // position of each shipment id in the drop sequence -> used for animation
  const dropIndex = {};
  data.drop_order.forEach((id, k) => (dropIndex[id] = k));

  const totalEmpty = multi ? 0 : data.trucks.reduce((s, t) => s + t.empty, 0);
  // Trucks numbered above the other method's count are the ones it didn't need.
  const extraCount = optimumTrucks != null ? Math.max(0, data.num_trucks - optimumTrucks) : 0;

  return (
    <section className={`card panel${activeId != null ? " linking" : ""}`} aria-label={title}>
      <div className="panel-head">
        <Heading>{title}</Heading>
        {badge && <span className={`badge ${badge.kind}`}>{badge.text}</span>}
      </div>
      {explanation && <p className="muted small">{explanation}</p>}
      <p className="panel-stats">
        {multi
          ? multiStats(data, capacity, noun)
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
