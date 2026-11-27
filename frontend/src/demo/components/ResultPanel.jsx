import { lazy, Suspense, useMemo } from "react";
import TruckCard from "./TruckCard.jsx";
import { deckPlan } from "./deck.ts";

// three.js is large, so the 3D view is only downloaded when it's first shown.
const TruckScene3D = lazy(() => import("./TruckScene3D.jsx"));

// The trucks of a packing, as a grid of cards (2D) or one 3D scene, drawn from the solve
// response exactly as returned. Every truck is the same vehicle, so one deck scale serves all
// the cards.

/** Largest deck drawing in a card, px: the widest deck across, all decks end to end. */
const DRAWING = { wide: { maxWidthPx: 80, maxLengthPx: 340 }, narrow: { maxWidthPx: 64, maxLengthPx: 240 } };

/**
 * @param {{
 *   data: any, step: number, view?: string, narrow?: boolean,
 *   activeIds?: number[] | null, activeTruck?: number | null,
 *   onHover?: (ids: number[] | null) => void, onFocusBlock?: (ids: number[] | null) => void,
 *   onHoverTruck?: (truck: number | null) => void,
 * }} props
 */
export default function ResultPanel({
  data, step, view = "2d", narrow = false, activeIds, activeTruck, onHover, onFocusBlock, onHoverTruck,
}) {
  // position of each shipment id in the drop sequence -> used for animation
  const dropIndex = useMemo(() => {
    const index = {};
    data.drop_order.forEach((id, k) => (index[id] = k));
    return index;
  }, [data]);
  const plan = useMemo(() => deckPlan(data.capacity.decks, narrow ? DRAWING.narrow : DRAWING.wide), [data, narrow]);
  const linkProps = { activeIds, onHover, onFocusBlock };

  if (view === "3d") {
    const height = narrow ? 320 : 420;
    return (
      <Suspense fallback={<div className="scene3d scene3d-loading muted" style={{ height }}>Loading 3D view…</div>}>
        <TruckScene3D data={data} step={step} dropIndex={dropIndex} height={height} {...linkProps} />
      </Suspense>
    );
  }

  return (
    <div className={`truck-grid${activeIds != null ? " linking" : ""}`}>
      {data.trucks.map((t) => (
        <TruckCard
          key={t.truck}
          truck={t}
          numTrucks={data.num_trucks}
          capacity={data.capacity}
          plan={plan}
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
