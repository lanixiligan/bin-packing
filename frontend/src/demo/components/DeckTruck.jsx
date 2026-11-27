import { colorFor, describeSize, describeUsage, dgCodeOf, dgTextOf, sizeOf, truckFill } from "./capacity.ts";
import { describeDeck, layoutPallets, PALLET_MM, ROW_GAP_MM, truckDeck } from "./deck.ts";
import { DgDiamond } from "../../dg/DgBadge.tsx";
import "./truck.css";

// One truck's pallet deck, drawn top-down at real proportions (deck.ts): cab at
// the top, pallets loaded from the cab end towards the rear doors, two across.
// TruckCard.jsx puts the truck's name, fill and contents around it. Empty slots
// show as dashed outlines, a load over the pallet limit hangs past the rear in
// red, and shipments without pallets are listed as "loose" chips under the deck.
// `deckAtLeast` sizes an unlimited deck for that many pallets, so every truck in
// the grid gets the same deck length.

/** Width of the drawn deck in px, before it is narrowed to fit `maxHeight`. */
const DECK_PX = 72;

const pct = (n) => `${n * 100}%`;

/** Left edge (mm) of column `col` when `across` pallets share the deck width. */
function colX(col, across, widthMm) {
  const margin = (widthMm - across * PALLET_MM) / (across + 1);
  return margin + col * (PALLET_MM + margin);
}

const rowY = (row) => ROW_GAP_MM + row * (PALLET_MM + ROW_GAP_MM);

export default function DeckTruck({
  truck, numTrucks, cap, deckAtLeast = 0, maxHeight = 320, step, dropIndex, activeId, onHover, onFocusBlock,
}) {
  const name = `Truck ${truck.truck}`;
  // A number is kg only: weight is then the only limited dimension.
  const limits = typeof cap === "number" ? { weight_kg: cap } : cap;
  const { full, over: overLimits } = truckFill(truck, limits, step, dropIndex);
  const deck = truckDeck(truck.shipments, cap, deckAtLeast);
  const layout = layoutPallets(truck.shipments, deck); // all shipments: stable slots while dropping
  const over = overLimits || layout.pieces.some((p) => p.over);
  const shown = (id) => dropIndex[id] < step;
  const byId = new Map(truck.shipments.map((s) => [s.id, s]));

  // Drawn length: the deck plus any over-capacity rows past the rear.
  const totalMm = layout.rows * (PALLET_MM + ROW_GAP_MM) + ROW_GAP_MM;
  const ratio = totalMm / deck.widthMm;
  const h = Math.min(maxHeight, DECK_PX * ratio);
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
    <div className={`deck${over ? " over" : ""}`}>
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
              title={label(s)}
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
    </div>
  );
}
