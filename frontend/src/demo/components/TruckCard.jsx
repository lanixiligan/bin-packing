import { colorFor, dgCodeOf, limitOf, truckFill } from "./capacity.ts";
import { usesDeck } from "./deck.ts";
import DeckTruck from "./DeckTruck.jsx";
import DimBars from "./DimBars.jsx";
import Truck from "./Truck.jsx";
import { DgDiamond } from "../../dg/DgBadge.tsx";
import "./truck.css";

// One truck in the 2D grid: its name and what's left, one fill bar per limited
// dimension, the drawing (a pallet deck, or a weight column when nothing is on
// pallets) and the names of what it carries. Hovering a name or a block lights up
// that shipment everywhere; hovering the card lights up its rows in the table.

const num = (n) => n.toLocaleString(undefined, { maximumFractionDigits: 1 });

/** "466 kg free", plus "2 spaces free" with a pallet limit. */
function freeText(full, limits) {
  const parts = [`${num(Math.max(0, limits.weight_kg - full.weight_kg))} kg free`];
  const pallets = limitOf(limits, "pallets");
  if (pallets != null) {
    const free = Math.max(0, pallets - full.pallets);
    parts.push(`${num(free)} space${free === 1 ? "" : "s"} free`);
  }
  return parts.join(" · ");
}

export default function TruckCard({
  truck, numTrucks, capacity, deckAtLeast, barHeight, deckMaxHeight, step, dropIndex,
  activeId, activeTruck, onHover, onFocusBlock, onHoverTruck,
}) {
  const limits = typeof capacity === "number" ? { weight_kg: capacity } : capacity;
  const { usage, full, done, over } = truckFill(truck, limits, step, dropIndex);
  const deck = usesDeck(truck.shipments, capacity);
  const holdsActive = activeId != null && truck.shipments.some((s) => s.id === activeId);
  const shown = truck.shipments.filter((s) => dropIndex[s.id] < step);
  // Loose freight already has its own chips under the deck.
  const named = deck ? shown.filter((s) => (s.pallets ?? 0) > 0) : shown;
  const drawingProps = { truck, numTrucks, step, dropIndex, activeId, onHover, onFocusBlock };

  return (
    <article
      className={`truck-card${holdsActive ? " holds-active" : ""}${activeTruck === truck.truck ? " is-hovered" : ""}${over ? " over" : ""}`}
      aria-labelledby={`truck-${truck.truck}-title`}
      onPointerEnter={() => onHoverTruck(truck.truck)}
      onPointerLeave={() => onHoverTruck(null)}
    >
      <header className="truck-card-head">
        <h3 id={`truck-${truck.truck}-title`}>Truck {truck.truck}</h3>
        <span className={`truck-card-free${over ? " is-over" : ""}`}>
          {!done ? "Loading…" : over ? "⚠ Over capacity" : freeText(full, limits)}
        </span>
      </header>
      <DimBars usage={usage} cap={limits} compact />
      <div className="truck-card-drawing" style={{ minHeight: deck ? undefined : barHeight }}>
        {deck
          ? <DeckTruck {...drawingProps} cap={capacity} deckAtLeast={deckAtLeast} maxHeight={deckMaxHeight} />
          : <Truck {...drawingProps} capacity={limits.weight_kg} height={barHeight} />}
      </div>
      {named.length > 0 && (
        <ul className="truck-card-items" aria-hidden="true">
          {named.map((s) => {
            const code = dgCodeOf(s);
            return (
              <li
                key={s.id}
                className={s.id === activeId ? "active" : undefined}
                onPointerEnter={() => onHover(s.id)}
                onPointerLeave={() => onHover(null)}
              >
                <span className="swatch" style={{ background: colorFor(s.id) }} />
                <span className="truck-card-item-name">{s.name}</span>
                {code && <DgDiamond code={code} size="sm" />}
              </li>
            );
          })}
        </ul>
      )}
    </article>
  );
}

