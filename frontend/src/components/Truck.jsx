import { colorFor, describeSize, describeUsage, dgTextOf, shipmentFractions, sizeOf, truckFill } from "./capacity.ts";
import DimBars from "./DimBars.jsx";
import { DgDiamond } from "../dg/DgBadge.tsx";
import "./truck.css";

// One truck as a column of stacked blocks.
//
// The 1D demo passes `capacity` as a number and shipments as { id, name, weight }:
// block height = weight / capacity, the label shows "NN%" and "X kg free".
//
// The ops pages pass `capacity` as an object { weight_kg, volume_m3, pallets }
// (each optional) and shipments with `volume` / `pallets` too. Then the truck
// shows one fill bar per limited dimension, the stack is as tall as the fullest
// dimension (the binding one), and each block is sized by its own largest
// fraction of the capacity. Optional extras: `truck.capacity` (per-truck limits),
// `truck.label` (e.g. "Load 2"), `shipment.colorKey` (color by order instead
// of by unit) and `shipment.detail` (extra text for the label and inspector).
// Both branches show dangerous goods: the demo's `shipment.dg_class` or a
// ready-made `shipment.dgLabel` ("Class 3") is written on tall blocks and in
// the screen-reader label, with the class diamond at the block's left edge.
// Blocks without DG look exactly as before.

/** Diamond code for a block (the demo's dg_class, or `dgCode` if given), or null. */
function diamondOf(s) {
  const c = s.dgCode ?? s.dg_class;
  if (!c) return null;
  return c === "food" ? "F" : c === "fire_risk" ? "R" : c;
}

/** The block's label lines: name, weight, then the DG class when there is room. */
function BlockLabel({ s, h, weight, dg }) {
  if (h < 14) return null;
  return (
    <span className="block-label" aria-hidden="true">
      {s.name}
      {h >= 28 ? <br /> : " · "}
      {weight}
      {dg && h >= 40 ? <><br /><span className="block-dg">{dg}</span></> : null}
    </span>
  );
}

function BlockDiamond({ s, h }) {
  const code = diamondOf(s);
  if (!code || h < 18) return null;
  return <span className="block-dia" aria-hidden="true"><DgDiamond code={code} size="sm" /></span>;
}

export default function Truck({
  truck, numTrucks, capacity, height, step, dropIndex, activeId, onHover, onFocusBlock, extra,
}) {
  const cap = truck.capacity ?? capacity;
  if (typeof cap === "object" && cap !== null) {
    return (
      <MultiTruck
        truck={truck}
        numTrucks={numTrucks}
        cap={cap}
        height={height}
        step={step}
        dropIndex={dropIndex}
        activeId={activeId}
        onHover={onHover}
        onFocusBlock={onFocusBlock}
        extra={extra}
      />
    );
  }

  // ---- 1D (weight only): the original demo truck -------------------------
  // Only show shipments that have already "dropped" in the animation.
  const visible = truck.shipments.filter((s) => dropIndex[s.id] < step);
  const load = visible.reduce((sum, s) => sum + s.weight, 0);
  // floor, so "100%" only shows when the truck is completely full
  const fill = Math.floor((100 * load) / capacity);
  const done = visible.length === truck.shipments.length;
  const holdsActive = activeId != null && truck.shipments.some((s) => s.id === activeId);

  return (
    <div className={`truck${extra ? " extra" : ""}${holdsActive ? " holds-active" : ""}`}>
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
          const label = `${s.name}${dg ? `, ${dg}` : ""}${s.detail ? `, ${s.detail}` : ""}, ${s.weight} kg, truck ${truck.truck} of ${numTrucks}`;
          return (
            <div
              key={s.id}
              role="listitem"
              tabIndex={0}
              aria-label={label}
              className={`block${diamondOf(s) && h >= 18 ? " dg" : ""}${s.id === activeId ? " active" : ""}`}
              style={{ height: h, background: colorFor(s.colorKey ?? s.id) }}
              onPointerEnter={() => onHover(s.id)}
              onPointerLeave={() => onHover(null)}
              onFocus={() => onFocusBlock(s.id)}
              onBlur={() => onFocusBlock(null)}
            >
              <BlockDiamond s={s} h={h} />
              <BlockLabel s={s} h={h} weight={`${s.weight} kg`} dg={dg} />
            </div>
          );
        })}
      </div>
      <div className="truck-name">Truck {truck.truck}</div>
      <div className="truck-empty">{done ? `${truck.empty} kg free` : "loading…"}</div>
      {extra && <div className="truck-extra-tag">beyond optimum</div>}
    </div>
  );
}

function MultiTruck({ truck, numTrucks, cap, height, step, dropIndex, activeId, onHover, onFocusBlock, extra }) {
  const name = truck.label ?? `Truck ${truck.truck}`;
  const { visible, usage, full, fill, done, over } = truckFill(truck, cap, step, dropIndex);
  const sizes = shipmentFractions(truck.shipments, cap); // from all shipments: stable heights while dropping
  const holdsActive = activeId != null && truck.shipments.some((s) => s.id === activeId);

  return (
    <div className={`truck multi${extra ? " extra" : ""}${over ? " over" : ""}${holdsActive ? " holds-active" : ""}`}>
      <DimBars usage={usage} cap={cap} compact />
      <div className="truck-fill" aria-hidden="true">{fill}%</div>
      <div
        className="truck-body"
        style={{ height }}
        role="list"
        aria-label={`${name}: ${describeUsage(full, cap)}${over ? ". Over capacity" : ""}`}
      >
        {visible.map((s) => {
          const h = Math.max(2, (sizes.get(s.id) ?? 0) * height);
          const size = describeSize(sizeOf(s));
          const dg = dgTextOf(s);
          const label = `${s.name}${dg ? `, ${dg}` : ""}${s.detail ? `, ${s.detail}` : ""}, ${size}, ${name.toLowerCase()} of ${numTrucks}`;
          return (
            <div
              key={s.id}
              role="listitem"
              tabIndex={0}
              aria-label={label}
              className={`block${diamondOf(s) && h >= 18 ? " dg" : ""}${s.id === activeId ? " active" : ""}`}
              style={{ height: h, background: colorFor(s.colorKey ?? s.id) }}
              onPointerEnter={() => onHover(s.id)}
              onPointerLeave={() => onHover(null)}
              onFocus={() => onFocusBlock(s.id)}
              onBlur={() => onFocusBlock(null)}
            >
              <BlockDiamond s={s} h={h} />
              <BlockLabel s={s} h={h} weight={`${s.weight.toLocaleString(undefined, { maximumFractionDigits: 1 })} kg`} dg={dg} />
            </div>
          );
        })}
      </div>
      <div className="truck-name">{name}</div>
      <div className="truck-empty">
        {!done ? "loading…" : over ? <b className="truck-over">⚠ over capacity</b> : `${Math.max(0, 100 - fill)}% free`}
      </div>
      {extra && <div className="truck-extra-tag">beyond optimum</div>}
    </div>
  );
}
