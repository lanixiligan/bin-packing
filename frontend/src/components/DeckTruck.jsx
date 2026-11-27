import { colorFor, describeSize, describeUsage, dgCodeOf, dgTextOf, sizeOf, truckFill } from "./capacity.ts";
import { describeDeck, layoutPallets, PALLET_MM, ROW_GAP_MM, truckDeck } from "./deck.ts";
import DimBars from "./DimBars.jsx";
import { DgDiamond } from "../dg/DgBadge.tsx";
import "./truck.css";

// One truck as a top-down pallet deck plan, at real proportions (deck.ts):
// cab at the top, pallets loaded from the cab end towards the rear doors,
// two across. Used by Truck.jsx whenever a truck has a pallet limit or carries
// shipments on pallets. Empty slots show as dashed outlines, a load over the
// pallet limit hangs past the rear in red, and shipments without pallets are
// listed as "loose" chips under the deck.

/** Width of the drawn deck in px, before it is narrowed to fit `maxHeight`. */
const DECK_PX = 76;

const pct = (n) => `${n * 100}%`;

/** "5 pallets" under a truck without a pallet limit. */
function palletCount(used) {
  return `${used.toLocaleString(undefined, { maximumFractionDigits: 1 })} pallet${used === 1 ? "" : "s"}`;
}

/** "3 of 8 spaces free" under a truck with a pallet limit. */
function spacesFree(slots, used) {
  const free = Math.max(0, slots - used);
  return `${free.toLocaleString(undefined, { maximumFractionDigits: 1 })} of ${slots} spaces free`;
}

/** Left edge (mm) of column `col` when `across` pallets share the deck width. */
function colX(col, across, widthMm) {
  const margin = (widthMm - across * PALLET_MM) / (across + 1);
  return margin + col * (PALLET_MM + margin);
}

const rowY = (row) => ROW_GAP_MM + row * (PALLET_MM + ROW_GAP_MM);

export default function DeckTruck({
  truck, numTrucks, cap, height, step, dropIndex, activeId, onHover, onFocusBlock, extra,
}) {
  const name = `Truck ${truck.truck}`;
  // A number is kg only: weight is then the only limited dimension.
  const limits = typeof cap === "number" ? { weight_kg: cap } : cap;
  const { usage, full, fill, done, over: overLimits } = truckFill(truck, limits, step, dropIndex);
  const deck = truckDeck(truck.shipments, cap);
  const layout = layoutPallets(truck.shipments, deck); // all shipments: stable slots while dropping
  const over = overLimits || layout.pieces.some((p) => p.over);
  const shown = (id) => dropIndex[id] < step;
  const holdsActive = activeId != null && truck.shipments.some((s) => s.id === activeId);
  const byId = new Map(truck.shipments.map((s) => [s.id, s]));

  // Drawn length: the deck plus any over-capacity rows past the rear.
  const totalMm = layout.rows * (PALLET_MM + ROW_GAP_MM) + ROW_GAP_MM;
  const ratio = totalMm / deck.widthMm;
  const maxH = 2 * height;
  const h = Math.min(maxH, DECK_PX * ratio);
  const w = h / ratio;

  const label = (s) => {
    const dg = dgTextOf(s);
    return `${s.name}${dg ? `, ${dg}` : ""}, ${describeSize(sizeOf(s))}, ${name.toLowerCase()} of ${numTrucks}`;
  };
  const handlers = (id) => ({
    onPointerEnter: () => onHover(id),
    onPointerLeave: () => onHover(null),
    onFocus: () => onFocusBlock(id),
    onBlur: () => onFocusBlock(null),
  });

  return (
    <div className={`truck multi deck${extra ? " extra" : ""}${over ? " over" : ""}${holdsActive ? " holds-active" : ""}`}>
      <DimBars usage={usage} cap={limits} compact />
      <div className="truck-fill" aria-hidden="true">{fill}%</div>
      <div className="deck-cab" style={{ width: w * 0.86 }} aria-hidden="true" />
      <div
        className="deck-floor"
        style={{ width: w, height: h }}
        role="list"
        aria-label={`${name}: ${describeDeck(deck)}. ${describeUsage(full, limits)}${over ? ". Over capacity" : ""}`}
      >
        <div className="deck-bed" style={{ height: pct(deck.lengthMm / totalMm) }} aria-hidden="true" />
        {Array.from({ length: deck.slots }, (_, i) => {
          const row = Math.floor(i / deck.across);
          const col = i % deck.across;
          return (
            <div
              key={`slot-${i}`}
              className="deck-slot"
              aria-hidden="true"
              style={{
                top: pct(rowY(row) / totalMm), height: pct(PALLET_MM / totalMm),
                left: pct(colX(col, deck.across, deck.widthMm) / deck.widthMm), width: pct(PALLET_MM / deck.widthMm),
              }}
            />
          );
        })}
        {layout.pieces.map((p) => {
          if (!shown(p.id)) return null;
          const s = byId.get(p.id);
          const code = dgCodeOf(s);
          const pieceH = (p.to - p.from) * PALLET_MM;
          return (
            <div
              key={`${p.id}-${p.slot}-${p.from}`}
              role={p.first ? "listitem" : undefined}
              tabIndex={p.first ? 0 : undefined}
              aria-label={p.first ? label(s) : undefined}
              aria-hidden={p.first ? undefined : "true"}
              className={`block deck-piece${p.over ? " over" : ""}${p.id === activeId ? " active" : ""}`}
              style={{
                top: pct((rowY(p.row) + p.from * PALLET_MM) / totalMm), height: pct(pieceH / totalMm),
                left: pct(colX(p.col, deck.across, deck.widthMm) / deck.widthMm), width: pct(PALLET_MM / deck.widthMm),
                background: colorFor(s.id),
              }}
              {...handlers(p.id)}
            >
              {p.first && code && pieceH >= PALLET_MM / 2 ? (
                <span className="deck-dia" aria-hidden="true"><DgDiamond code={code} size="sm" /></span>
              ) : null}
            </div>
          );
        })}
      </div>
      {layout.loose.some((s) => shown(s.id)) && (
        <div className="deck-loose" role="list" aria-label={`${name}: loose freight`}>
          {layout.loose.filter((s) => shown(s.id)).map((s) => (
            <span
              key={s.id}
              role="listitem"
              tabIndex={0}
              aria-label={`${label(s)}, loose`}
              className={`block deck-chip${s.id === activeId ? " active" : ""}`}
              style={{ background: colorFor(s.id) }}
              {...handlers(s.id)}
            >
              <span aria-hidden="true">{s.name}</span>
            </span>
          ))}
        </div>
      )}
      <div className="truck-name">{name}</div>
      <div className="truck-empty">
        {!done ? "loading…" : over ? <b className="truck-over">⚠ over capacity</b> : deck.limited ? spacesFree(deck.slots, full.pallets) : palletCount(full.pallets)}
      </div>
      {extra && <div className="truck-extra-tag">beyond optimum</div>}
    </div>
  );
}
