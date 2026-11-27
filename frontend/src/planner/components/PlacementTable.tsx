// Every placement as a table: the text alternative to the drawings (the deck view's SVG points
// here with aria-describedby). Collapsed by default; in deck position order. Kept to a few columns
// (position and size are one column each) so it fits its box without scrolling inside it.

import type { Deck, DgInfo, Placement } from "../api/types.ts";
import { dgName, placardCode } from "../lib/dg.ts";
import { useUnits } from "../lib/units.ts";
import "./PlacementTable.css";

export interface PlacementTableProps {
  id: string;
  placements: Placement[];
  decks: Deck[];
  typeName(p: Placement): string;
  /** DG per freight line id (lib/dg.ts dgByItem); lines without an entry are general freight. */
  dg?: ReadonlyMap<string, DgInfo>;
}

export default function PlacementTable({ id, placements, decks, typeName, dg }: PlacementTableProps) {
  const units = useUnits();
  const deckIndex = new Map(decks.map((d, i) => [d.id, i]));
  const deckName = new Map(decks.map((d) => [d.id, d.name]));
  const deckX = new Map(decks.map((d) => [d.id, d.x_mm]));

  const byPosition = (a: Placement, b: Placement) =>
    (deckX.get(a.deck_id) ?? 0) + a.x_mm - ((deckX.get(b.deck_id) ?? 0) + b.x_mm)
    || (deckIndex.get(a.deck_id) ?? 0) - (deckIndex.get(b.deck_id) ?? 0)
    || a.y_mm - b.y_mm || a.stack_level - b.stack_level;
  const rows = [...placements].sort(byPosition);
  const bare = (mm: number) => units.length(mm).replace(/\s*(mm|m)$/, "");
  // The deck only needs saying when the vehicle has more than one to load.
  const showDeck = decks.filter((d) => d.cargo).length > 1;
  /** "3" from "line-1#3": which unit of its freight line (the line id itself is internal). */
  const unitNumber = (p: Placement) => (p.unit_id.includes("#") ? p.unit_id.slice(p.unit_id.lastIndexOf("#") + 1) : "");

  return (
    <details className="ptable">
      <summary className="ptable-summary">Show the plan as a table <span className="subtle num">({placements.length} units)</span></summary>
      <div className="table-scroll">
        <table className="table" id={id}>
          <caption className="visually-hidden">
            Every placed unit. Positions are from the front of the deck (x), from its driver’s side (y) and up from
            the deck floor (z); level 1 is the floor.
          </caption>
          <thead>
            <tr>
              <th scope="col">Item</th>
              <th scope="col">DG</th>
              <th scope="col">Type</th>
              {showDeck && <th scope="col">Deck</th>}
              <th scope="col" className="num"
                  title="From the front of the deck (x), from its driver’s side (y) and up from the deck floor (z)">
                Position <span className="ptable-axes">(x, y, z)</span>
              </th>
              <th scope="col" className="num">Size <span className="ptable-axes">(L × W × H)</span></th>
              <th scope="col" className="num">Weight</th>
              <th scope="col" className="num">Level</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.unit_id} data-unit={p.unit_id}>
                <td>
                  {p.label || p.item_id}
                  {unitNumber(p) && <> <span className="ptable-unit"><span className="visually-hidden">unit </span>#{unitNumber(p)}</span></>}
                </td>
                <DgCell dg={dg?.get(p.item_id)} />
                <td>{typeName(p)}{p.rotated ? <span className="subtle"> (turned)</span> : null}</td>
                {showDeck && <td>{deckName.get(p.deck_id) ?? p.deck_id}</td>}
                <td className="num ptable-nowrap">{bare(p.x_mm)} · {bare(p.y_mm)} · {units.length(p.z_mm)}</td>
                <td className="num ptable-nowrap">{bare(p.length_mm)} × {bare(p.width_mm)} × {units.length(p.height_mm)}</td>
                <td className="num ptable-nowrap">{units.weight(p.weight_kg)}</td>
                <td className="num">{p.stack_level + 1}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

/** "5.1 Oxidising substance", "F Food"; a dash for general freight. */
function DgCell({ dg }: { dg: DgInfo | undefined }) {
  const code = placardCode(dg);
  if (!code) return <td className="subtle">–</td>;
  return (
    <td>
      {/* The code shows; the class name is its tooltip and is read out (the legend names the classes too). */}
      <span className="ptable-dg" title={dgName(dg)}>{code}</span> <span className="visually-hidden">{dgName(dg)}</span>
    </td>
  );
}
