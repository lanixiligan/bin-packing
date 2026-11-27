// Every placement as a table: the text alternative to the drawings (the deck view's SVG points
// here with aria-describedby). Collapsed by default; sortable by deck position or stop.

import { useState } from "react";
import type { Deck, Placement } from "../api/types.ts";
import { useUnits } from "../lib/units.ts";
import "./PlacementTable.css";

export interface PlacementTableProps {
  id: string;
  placements: Placement[];
  decks: Deck[];
  typeName(p: Placement): string;
}

type SortKey = "position" | "stop";

export default function PlacementTable({ id, placements, decks, typeName }: PlacementTableProps) {
  const units = useUnits();
  const [sort, setSort] = useState<SortKey>("position");
  const deckIndex = new Map(decks.map((d, i) => [d.id, i]));
  const deckName = new Map(decks.map((d) => [d.id, d.name]));
  const deckX = new Map(decks.map((d) => [d.id, d.x_mm]));

  const byPosition = (a: Placement, b: Placement) =>
    (deckX.get(a.deck_id) ?? 0) + a.x_mm - ((deckX.get(b.deck_id) ?? 0) + b.x_mm)
    || (deckIndex.get(a.deck_id) ?? 0) - (deckIndex.get(b.deck_id) ?? 0)
    || a.y_mm - b.y_mm || a.stack_level - b.stack_level;
  const rows = [...placements].sort(sort === "stop"
    ? (a, b) => (a.stop ?? Infinity) - (b.stop ?? Infinity) || byPosition(a, b)
    : byPosition);
  const bare = (mm: number) => units.length(mm).replace(/\s*(mm|m)$/, "");

  const sortHeader = (key: SortKey, label: string, className?: string) => (
    <th scope="col" className={className} aria-sort={sort === key ? "ascending" : undefined}>
      <button type="button" className="ptable-sort" onClick={() => setSort(key)}>
        {label}<span className="visually-hidden">{key === "position" ? ", sort by position" : ", sort by stop"}</span>
        <span aria-hidden="true" className="ptable-sort-mark">{sort === key ? "▲" : "↕"}</span>
      </button>
    </th>
  );

  return (
    <details className="ptable">
      <summary className="ptable-summary">Show the plan as a table <span className="subtle num">({placements.length} units)</span></summary>
      <div className="table-scroll">
        <table className="table" id={id}>
          <caption className="visually-hidden">
            Every placed unit. Positions are from the front of the deck (x) and its driver’s side (y); level 1 is the floor.
          </caption>
          <thead>
            <tr>
              <th scope="col">Unit</th>
              <th scope="col">Item</th>
              <th scope="col">Type</th>
              {sortHeader("position", "Deck")}
              <th scope="col" className="num">x</th>
              <th scope="col" className="num">y</th>
              <th scope="col" className="num">L × W × H</th>
              <th scope="col" className="num">Weight</th>
              {sortHeader("stop", "Stop", "num")}
              <th scope="col" className="num">Level</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.unit_id}>
                <td className="ptable-unit">{p.unit_id}</td>
                <td>{p.label || p.item_id}</td>
                <td>{typeName(p)}{p.rotated ? <span className="subtle"> (turned)</span> : null}</td>
                <td>{deckName.get(p.deck_id) ?? p.deck_id}</td>
                <td className="num">{units.length(p.x_mm)}</td>
                <td className="num">{units.length(p.y_mm)}</td>
                <td className="num">{bare(p.length_mm)} × {bare(p.width_mm)} × {units.length(p.height_mm)}</td>
                <td className="num">{units.weight(p.weight_kg)}</td>
                <td className="num">{p.stop ?? "–"}</td>
                <td className="num">{p.stack_level + 1}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
