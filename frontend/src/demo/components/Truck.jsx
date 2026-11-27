import { colorFor, dgCodeOf, dgTextOf } from "./capacity.ts";
import { DgDiamond } from "../../dg/DgBadge.tsx";
import "./truck.css";

// One truck's load when weight is the only limit and nothing is on pallets: a
// column of stacked blocks, block height = weight / capacity. Dangerous goods
// show their class diamond at the block's left edge and the class as text on
// tall blocks. TruckCard.jsx puts the name, fill and contents around it; trucks
// with pallets are drawn as a deck plan instead (DeckTruck.jsx).

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
  // Only show shipments that have already "dropped" in the animation.
  const visible = truck.shipments.filter((s) => dropIndex[s.id] < step);

  return (
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
            title={`${s.name}${dg ? `, ${dg}` : ""}, ${s.weight} kg`}
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
  );
}
