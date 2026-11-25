import { lazy, Suspense } from "react";
import Truck from "./Truck.jsx";

// three.js is large, so the 3D view is only downloaded when it's first shown.
const TruckScene3D = lazy(() => import("./TruckScene3D.jsx"));

export default function ResultPanel({
  title, explanation, data, capacity, step, badge, truckHeight,
  activeId, onHover, onFocusBlock, optimumTrucks, view = "2d",
}) {
  // position of each shipment id in the drop sequence -> used for animation
  const dropIndex = {};
  data.drop_order.forEach((id, k) => (dropIndex[id] = k));

  const totalEmpty = data.trucks.reduce((s, t) => s + t.empty, 0);
  // Trucks numbered above the other method's count are the ones it didn't need.
  const extraCount = optimumTrucks != null ? Math.max(0, data.num_trucks - optimumTrucks) : 0;

  return (
    <section className={`card panel${activeId != null ? " linking" : ""}`} aria-label={title}>
      <div className="panel-head">
        <h2>{title}</h2>
        <span className={`badge ${badge.kind}`}>{badge.text}</span>
      </div>
      <p className="muted small">{explanation}</p>
      <p className="panel-stats">
        <b>{data.num_trucks}</b> trucks · {totalEmpty.toLocaleString()} kg empty space in total
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
