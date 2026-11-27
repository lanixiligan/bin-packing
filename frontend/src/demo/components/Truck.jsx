import { colorFor, dgCodeOf, dgTextOf } from "./capacity.ts";
import { usesDeck } from "./deck.ts";
import DeckTruck from "./DeckTruck.jsx";
import { DgDiamond } from "../../dg/DgBadge.tsx";
import "./truck.css";

// One truck in the 2D view.
//
// Weight only (`capacity` is kg, no shipment on pallets): a column of stacked
// blocks, block height = weight / capacity, labelled "NN%" and "X kg free".
// Dangerous goods show their class diamond at the block's left edge and the
// class as text on tall blocks.
//
// When the trucks have a pallet limit or any shipment is on pallets, the
// truck is drawn as a top-down pallet deck instead (DeckTruck.jsx).

/** The block's label lines: name, weight, then the DG class when there is room. */
function BlockLabel({ s, h, dg }) {
  if (h < 14) return null;
  return (
    <span className="block-label" aria-hidden="true">
      {s.name}
      {h >= 28 ? <br /> : " · "}
      {s.weight} kg
      {dg && h >= 40 ? <><br /><span className="block-dg">{dg}</span></> : null}
    </span>
  );
}

export default function Truck({
  truck, numTrucks, capacity, height, step, dropIndex, activeId, onHover, onFocusBlock,
}) {
  if (usesDeck(truck.shipments, capacity)) {
    return (
      <DeckTruck
        truck={truck}
        numTrucks={numTrucks}
        cap={capacity}
        height={height}
        step={step}
        dropIndex={dropIndex}
        activeId={activeId}
        onHover={onHover}
        onFocusBlock={onFocusBlock}
      />
    );
  }

  // Only show shipments that have already "dropped" in the animation.
  const visible = truck.shipments.filter((s) => dropIndex[s.id] < step);
  const load = visible.reduce((sum, s) => sum + s.weight, 0);
  // floor, so "100%" only shows when the truck is completely full
  const fill = Math.floor((100 * load) / capacity);
  const done = visible.length === truck.shipments.length;
  const holdsActive = activeId != null && truck.shipments.some((s) => s.id === activeId);

  return (
    <div className={`truck${holdsActive ? " holds-active" : ""}`}>
      <div className="truck-fill" aria-hidden="true">{fill}%</div>
      <div
        className="truck-body"
        style={{ height }}
        role="list"
        aria-label={`Truck ${truck.truck}: ${truck.load} of ${capacity} kg loaded`}
      >
        {visible.map((s) => {
          const h = (s.weight / capacity) * height;
          const dg = dgTextOf(s);
          const code = dgCodeOf(s);
          return (
            <div
              key={s.id}
              role="listitem"
              tabIndex={0}
              aria-label={`${s.name}${dg ? `, ${dg}` : ""}, ${s.weight} kg, truck ${truck.truck} of ${numTrucks}`}
              className={`block${code && h >= 18 ? " dg" : ""}${s.id === activeId ? " active" : ""}`}
              style={{ height: h, background: colorFor(s.id) }}
              onPointerEnter={() => onHover(s.id)}
              onPointerLeave={() => onHover(null)}
              onFocus={() => onFocusBlock(s.id)}
              onBlur={() => onFocusBlock(null)}
            >
              {code && h >= 18 && <span className="block-dia" aria-hidden="true"><DgDiamond code={code} size="sm" /></span>}
              <BlockLabel s={s} h={h} dg={dg} />
            </div>
          );
        })}
      </div>
      <div className="truck-name">Truck {truck.truck}</div>
      <div className="truck-empty">{done ? `${truck.empty} kg free` : "loading…"}</div>
    </div>
  );
}
