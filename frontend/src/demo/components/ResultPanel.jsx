import { lazy, Suspense } from "react";
import TruckCard from "./TruckCard.jsx";
import { longestLoad } from "./deck.ts";

// three.js is large, so the 3D view is only downloaded when it's first shown.
const TruckScene3D = lazy(() => import("./TruckScene3D.jsx"));

// The trucks of a packing, as a grid of cards (2D) or one 3D scene.
// `capacity` is kg, or { weight_kg, pallets } when the trucks have a pallet limit
// (see capacity.ts).

/**
 * @param {{
 *   data: any, capacity: any, step: number, view?: string, narrow?: boolean,
 *   activeId?: number | null, activeTruck?: number | null,
 *   onHover?: (id: number | null) => void, onFocusBlock?: (id: number | null) => void,
 *   onHoverTruck?: (truck: number | null) => void,
 * }} props
 */
export default function ResultPanel({
  data, capacity, step, view = "2d", narrow = false, activeId, activeTruck, onHover, onFocusBlock, onHoverTruck,
}) {
  // position of each shipment id in the drop sequence -> used for animation
  const dropIndex = {};
  data.drop_order.forEach((id, k) => (dropIndex[id] = k));
  const linkProps = { activeId, onHover, onFocusBlock };

  if (view === "3d") {
    const height = narrow ? 320 : 420;
    return (
      <Suspense fallback={<div className="scene3d scene3d-loading muted" style={{ height }}>Loading 3D view…</div>}>
        <TruckScene3D data={data} capacity={capacity} step={step} dropIndex={dropIndex} height={height} {...linkProps} />
      </Suspense>
    );
  }

  return (
    <div className={`truck-grid${activeId != null ? " linking" : ""}`}>
      {data.trucks.map((t) => (
        <TruckCard
          key={t.truck}
          truck={t}
          numTrucks={data.num_trucks}
          capacity={capacity}
          deckAtLeast={longestLoad(data.trucks)}
          barHeight={narrow ? 150 : 180}
          deckMaxHeight={narrow ? 220 : 300}
          step={step}
          dropIndex={dropIndex}
          activeTruck={activeTruck}
          onHoverTruck={onHoverTruck}
          {...linkProps}
        />
      ))}
    </div>
  );
}
