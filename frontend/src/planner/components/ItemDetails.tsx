// Popover with a stack's details, shown on hover / tap / focus in the deck or elevation view.
// Positioned against the hovered element's box (relative to LoadPlanView's root); Escape closes it.

import type { Placement } from "../api/types.ts";
import { useUnits, type Units } from "../lib/units.ts";
import type { PlanStack } from "./LoadPlanView.tsx";
import "./ItemDetails.css";

/** The anchor element's box relative to the positioned container, plus that container's width. */
export interface Anchor {
  left: number;
  top: number;
  width: number;
  height: number;
  containerWidth: number;
}

export interface ItemDetailsProps {
  id: string;
  stack: PlanStack;
  anchor: Anchor;
  heightLimit: number;
}

const POPOVER_WIDTH = 320;
const GAP = 8;

function dims(units: Units, p: Placement): string {
  const bare = (mm: number) => units.length(mm).replace(/\s*(mm|m)$/, "");
  return `${bare(p.length_mm)} × ${bare(p.width_mm)} × ${units.length(p.height_mm)}`;
}

const yesNo = (b: boolean) => (b ? "Yes" : "No");

export default function ItemDetails({ id, stack, anchor, heightLimit }: ItemDetailsProps) {
  const units = useUnits();
  const { base } = stack;
  const n = stack.units.length;
  const sameWeight = stack.units.every((u) => u.weight_kg === base.weight_kg);

  // Below the anchor, centred on it and kept inside the container.
  const maxLeft = Math.max(0, anchor.containerWidth - POPOVER_WIDTH);
  const left = Math.min(maxLeft, Math.max(0, anchor.left + anchor.width / 2 - POPOVER_WIDTH / 2));
  const style = { left, top: anchor.top + anchor.height + GAP, width: POPOVER_WIDTH };

  return (
    <div id={id} role="tooltip" className="item-details" style={style}>
      <div className="item-details-head">
        <strong className="item-details-title">{stack.label}</strong>
        <span className="subtle">{stack.typeName}</span>
      </div>
      {stack.overLimit && (
        <p className="item-details-alert">
          <span aria-hidden="true">⚠</span> Top at {units.length(stack.top)}, over the {units.length(heightLimit)} height
          limit
        </p>
      )}
      {stack.dg.map((d) => (
        <p key={d.itemId} className="item-details-dg">
          <span className="item-details-dg-code" aria-hidden="true"><span>{d.code}</span></span>
          <span>
            Dangerous goods{stack.dg.length > 1 ? ` (${d.label})` : ""}: <strong>{d.text}</strong>
            {d.info.un_number ? <span className="subtle num"> · UN {d.info.un_number}</span> : null}
            {d.info.packing_group ? <span className="subtle"> · PG {d.info.packing_group}</span> : null}
          </span>
        </p>
      ))}
      {stack.conflict && (
        <div className={`item-details-alert item-details-conflict is-${stack.conflict.severity}`}>
          <p className="item-details-conflict-title">
            <span aria-hidden="true">⚠</span>{" "}
            {stack.conflict.severity === "error" ? "Incompatible dangerous goods" : "Dangerous goods to check"}
          </p>
          <ul>
            {stack.conflict.messages.map((m) => <li key={m}>{m}</li>)}
          </ul>
        </div>
      )}
      <dl className="item-details-grid">
        <dt>Dimensions</dt>
        <dd className="num item-details-nowrap">{dims(units, base)}{base.rotated ? " (turned)" : ""}</dd>
        <dt>Weight</dt>
        <dd className="num">
          {n > 1
            ? `${sameWeight ? `${units.weight(base.weight_kg)} each, ` : ""}${units.weight(stack.weight)} in total`
            : units.weight(base.weight_kg)}
        </dd>
        <dt>Stop</dt>
        <dd>{base.stop == null ? "None" : `Stop ${base.stop}`}</dd>
        <dt>Stackable</dt>
        <dd>{yesNo(base.stackable)}</dd>
        <dt>Temp controlled</dt>
        <dd>{yesNo(base.temp_controlled)}</dd>
        <dt>Deck</dt>
        <dd>{stack.deck.name}</dd>
        <dt>Level</dt>
        <dd>{n > 1 ? `Stack of ${n}` : "On the floor"}</dd>
      </dl>
      {n > 1 && (
        <ol className="item-details-levels">
          {[...stack.units].reverse().map((u) => (
            <li key={u.unit_id}>
              <span className="item-details-level num">L{u.stack_level + 1}</span>
              <span>{u.label || u.item_id}</span>
              <span className="subtle num">{u.unit_id}</span>
              <span className="num">{units.length(u.height_mm)} · {units.weight(u.weight_kg)}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
