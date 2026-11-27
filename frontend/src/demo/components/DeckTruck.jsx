import { colorFor, dgCodeOf } from "./capacity.ts";
import { rectOf, stackColumns } from "./deck.ts";
import { columnLabel, metres } from "./sizes.ts";
import { DgDiamond } from "../../dg/DgBadge.tsx";
import "./truck.css";

// One truck's cargo decks, drawn top-down to scale (deck.ts), cab at the top: each footprint
// exactly where the solver placed it (x down the deck from the cab end, y across from the
// driver's side). A stack is one footprint with a "×N" badge; loose items are long bars.
// Multi-deck vehicles (a B-double) show each deck under its name, at the same scale.
// `plan` (deckPlan) is shared by every card, so all trucks are drawn at one scale.
// TruckCard.jsx puts the truck's name, fill and contents around it.

/** px rounded to 0.1, so a style value is stable to read back. */
const px = (v) => Math.round(v * 10) / 10;

/** The DG placard shown on a column: the first one among its levels. */
const codeOf = (items) => items.map(dgCodeOf).find(Boolean) ?? null;

function Column({ column, items, plan, truck, numTrucks, activeIds, onHover, onFocusBlock }) {
  const r = rectOf(column.base, plan.scale);
  const ids = column.items.map((s) => s.id);
  const top = items[items.length - 1];
  const active = activeIds != null && ids.some((id) => activeIds.includes(id));
  const code = codeOf(items);
  const topMm = Math.max(...items.map((s) => s.placement.z_mm + s.placement.height_mm));
  const label = columnLabel(items, topMm, truck, numTrucks);
  const loose = column.items[0].kind === "loose";
  return (
    <div
      role="listitem"
      tabIndex={0}
      aria-label={label}
      title={label}
      data-ids={ids.join(" ")}
      className={`block deck-item ${loose ? "loose" : "pallet"}${active ? " active" : ""}`}
      style={{ top: px(r.top), left: px(r.left), width: px(r.width), height: px(r.height), background: colorFor(top.id) }}
      onPointerEnter={() => onHover(ids)}
      onPointerLeave={() => onHover(null)}
      onFocus={() => onFocusBlock(ids)}
      onBlur={() => onFocusBlock(null)}
    >
      {code && Math.min(r.width, r.height) >= 14 && (
        <span className="deck-dia" aria-hidden="true"><DgDiamond code={code} size="sm" /></span>
      )}
      {items.length > 1 && <span className="deck-count" aria-hidden="true">×{items.length}</span>}
    </div>
  );
}

export default function DeckTruck({ truck, numTrucks, plan, step, dropIndex, activeIds, onHover, onFocusBlock }) {
  const multi = plan.decks.length > 1;
  const columns = stackColumns(truck.shipments);
  const shown = (s) => dropIndex[s.id] < step;
  return (
    <div className="deck" style={{ width: px(plan.width) }}>
      <div className="deck-cab" style={{ width: px(plan.width * 0.86) }} aria-hidden="true" />
      {plan.decks.map((d, i) => (
        <div key={d.id} className="deck-part">
          {i > 0 && <div className="deck-hitch" aria-hidden="true" />}
          {multi && <span className="deck-name" aria-hidden="true">{d.name}</span>}
          <div
            className="deck-floor"
            role="list"
            aria-label={`Truck ${truck.truck}${multi ? `, ${d.name}` : ""}: ${metres(d.length_mm)} × ${metres(d.width_mm)} m deck`}
            data-deck={d.id}
            style={{ width: px(d.widthPx), height: px(d.lengthPx) }}
          >
            {columns.filter((c) => c.deckId === d.id).map((c) => {
              const items = c.items.filter(shown);
              return items.length ? (
                <Column
                  key={c.key}
                  column={c}
                  items={items}
                  plan={plan}
                  truck={truck.truck}
                  numTrucks={numTrucks}
                  activeIds={activeIds}
                  onHover={onHover}
                  onFocusBlock={onFocusBlock}
                />
              ) : null;
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
