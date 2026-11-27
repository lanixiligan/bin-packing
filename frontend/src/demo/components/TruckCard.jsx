import { colorFor } from "./capacity.ts";
import { floorUsedM2 } from "./deck.ts";
import { metres } from "./sizes.ts";
import DeckTruck from "./DeckTruck.jsx";
import "./truck.css";

// One truck in the 2D grid: its name and payload left, a bar each for weight and floor used,
// the tallest point against the inside height, the deck drawing (DeckTruck.jsx) and the names
// of what it carries. Hovering a name or a footprint lights up that shipment everywhere;
// hovering the card lights up its rows in the table. While shipments are still dropping in,
// the numbers follow what has landed so far.

const EPS = 1e-9;
const pct = (n) => Math.floor(n + EPS);
const kg = (n) => n.toLocaleString("en-AU");

function FillBar({ label, value }) {
  const p = pct(value);
  return (
    <div className="fill-bar">
      <span className="fill-bar-label">{label}</span>
      <span className="fill-bar-track"><span className="fill-bar-fill" style={{ width: `${Math.min(100, p)}%` }} /></span>
      <span className="fill-bar-pct">{p}%</span>
    </div>
  );
}

export default function TruckCard({
  truck, numTrucks, capacity, plan, step, dropIndex, activeIds, activeTruck, onHover, onFocusBlock, onHoverTruck,
}) {
  const shown = truck.shipments.filter((s) => dropIndex[s.id] < step);
  const done = shown.length === truck.shipments.length;
  const load = shown.reduce((sum, s) => sum + s.weight, 0);
  const weightPct = done ? truck.fill_percent : (100 * load) / capacity.weight_kg;
  const floorPct = done ? truck.floor_percent : (100 * floorUsedM2(shown)) / capacity.floor_m2;
  const highMm = done ? truck.max_height_mm : Math.max(0, ...shown.map((s) => s.placement.z_mm + s.placement.height_mm));
  const insideMm = Math.max(...capacity.decks.map((d) => d.height_mm));
  const holdsActive = activeIds != null && truck.shipments.some((s) => activeIds.includes(s.id));
  const free = done ? `${kg(truck.empty)} kg free` : "Loading…";
  const high = `${metres(highMm)} of ${metres(insideMm)} m high`;

  return (
    <article
      className={`truck-card${holdsActive ? " holds-active" : ""}${activeTruck === truck.truck ? " is-hovered" : ""}`}
      aria-labelledby={`truck-${truck.truck}-title`}
      onPointerEnter={() => onHoverTruck(truck.truck)}
      onPointerLeave={() => onHoverTruck(null)}
    >
      <header className="truck-card-head">
        <h3 id={`truck-${truck.truck}-title`}>Truck {truck.truck}</h3>
        <span className="truck-card-free">{free}</span>
      </header>
      <div className="fill-bars" aria-hidden="true">
        <FillBar label="kg" value={weightPct} />
        <FillBar label="floor" value={floorPct} />
      </div>
      <p className="truck-card-high" aria-hidden="true">{high}</p>
      <p className="sr-only">
        {`Weight ${kg(done ? truck.load : load)} of ${kg(capacity.weight_kg)} kg (${pct(weightPct)}%), `}
        {`floor ${pct(floorPct)}% used, ${high}.`}
      </p>
      <div className="truck-card-drawing">
        <DeckTruck
          truck={truck}
          numTrucks={numTrucks}
          plan={plan}
          step={step}
          dropIndex={dropIndex}
          activeIds={activeIds}
          onHover={onHover}
          onFocusBlock={onFocusBlock}
        />
      </div>
      {shown.length > 0 && (
        <ul className="truck-card-items" aria-hidden="true">
          {shown.map((s) => (
              <li
                key={s.id}
                className={activeIds?.includes(s.id) ? "active" : undefined}
                onPointerEnter={() => onHover([s.id])}
                onPointerLeave={() => onHover(null)}
              >
                <span className="swatch" style={{ background: colorFor(s.id) }} />
                <span className="truck-card-item-name">{s.name}</span>
              </li>
          ))}
        </ul>
      )}
    </article>
  );
}
