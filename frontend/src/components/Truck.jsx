// Same shipment = same color in both panels, so you can compare them.
// Lightness 72% keeps near-black labels at 5.6:1 or better for every hue
// (WCAG AA needs 4.5:1; at 62% the blue hues only reached 3.5:1).
export function colorFor(id) {
  const hue = (id * 137.508) % 360; // golden angle spreads colors nicely
  return `hsl(${hue}, 65%, 72%)`;
}

export default function Truck({
  truck, numTrucks, capacity, height, step, dropIndex, activeId, onHover, onFocusBlock, extra,
}) {
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
          const label = `${s.name}, ${s.weight} kg, truck ${truck.truck} of ${numTrucks}`;
          return (
            <div
              key={s.id}
              role="listitem"
              tabIndex={0}
              aria-label={label}
              className={`block${s.id === activeId ? " active" : ""}`}
              style={{ height: h, background: colorFor(s.id) }}
              onPointerEnter={() => onHover(s.id)}
              onPointerLeave={() => onHover(null)}
              onFocus={() => onFocusBlock(s.id)}
              onBlur={() => onFocusBlock(null)}
            >
              {h >= 14 && (
                <span className="block-label" aria-hidden="true">
                  {s.name}
                  {h >= 28 ? <br /> : " · "}
                  {s.weight} kg
                </span>
              )}
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
