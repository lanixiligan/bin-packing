// Step 3's drawing: a top-down deck view to scale (colour by stop / weight / type, with a legend),
// the side elevation against the height limit, item details on hover / tap / focus, and the same
// placements as a table for screen readers.
//
// Driven purely by the planner's response: placements are grouped into floor stacks (by deck and
// stack_id) and drawn where the API put them. Nothing here moves or re-plans a unit.

import { useCallback, useEffect, useId, useMemo, useRef, useState, type TouchEvent } from "react";
import type { Deck, Placement, PlanRequest, PlanResult, ReferenceData, VehicleConfig } from "../api/types.ts";
import { heatColor, stopBadge, stopColor, stopTextColor, typePattern, type PatternKind } from "../lib/colors.ts";
import { useUnits, type Units } from "../lib/units.ts";
import DeckView from "./DeckView.tsx";
import ElevationView from "./ElevationView.tsx";
import ItemDetails, { type Anchor } from "./ItemDetails.tsx";
import Legend from "./Legend.tsx";
import PlacementTable from "./PlacementTable.tsx";
import "./LoadPlanView.css";

export interface LoadPlanViewProps {
  result: PlanResult;
  reference: ReferenceData;
  /** The request that produced `result` (item labels, stops). */
  request: PlanRequest;
}

// ---- Shared model (types only; the views draw it) ------------------------------------

export type ColorMode = "stop" | "weight" | "type";

export interface Paint {
  fill: string;
  text: string;
  /** Type mode: the pattern laid over the fill. */
  pattern: PatternKind | null;
  /** The badge that carries the colour's meaning: "S2" (stop mode), "AU" (type mode) or "". */
  badge: string;
}

/** One floor position: the floor unit and anything stacked on it. */
export interface PlanStack {
  key: string;
  /** Floor first. */
  units: Placement[];
  base: Placement;
  deck: Deck;
  /** Vehicle x of the stack's front edge. */
  x: number;
  /** From the driver's side of the deck. */
  y: number;
  length: number;
  width: number;
  /** Stack total. */
  weight: number;
  /** Top of the stack above the ground. */
  top: number;
  label: string;
  typeName: string;
  typeCode: string;
  stop: number | null;
  overLimit: boolean;
  paint: Paint;
  /** Full details for assistive tech. */
  description: string;
}

/** The drawing's horizontal extent in vehicle mm, shared by the deck and elevation views. */
export interface Frame {
  x0: number;
  width: number;
  vehicleLength: number;
  cabLength: number;
}

export interface StackEvents {
  /** The stack shown in both views (hovered, else focused / tapped). */
  highlighted: string | null;
  onEnter(key: string, el: Element): void;
  onLeave(key: string): void;
  onFocus(key: string, el: Element): void;
  onBlur(key: string): void;
  onDismiss(): void;
}

// ---- Model building --------------------------------------------------------------------

const MARGIN_MM = 300;
/** Below this scale the drawing stops shrinking and its container scrolls instead. */
const MIN_PX_PER_MM = 0.045;
const ZOOM_STEPS = [1, 1.5, 2, 3, 4];
const MAX_ZOOM = ZOOM_STEPS[ZOOM_STEPS.length - 1];

function typeNameOf(reference: ReferenceData, p: Pick<Placement, "kind" | "type_id">): string {
  if (p.kind === "container") {
    const c = reference.containers[p.type_id];
    return c ? `${c.name} container` : p.type_id;
  }
  const pallet = reference.pallets[p.type_id];
  return pallet ? `${pallet.name} pallet` : p.type_id;
}

function frameFor(vehicle: VehicleConfig): Frame {
  const cargo = vehicle.decks.filter((d) => d.cargo);
  const ends = [
    ...vehicle.decks.map((d) => d.x_mm + d.length_mm),
    ...vehicle.axle_groups.map((a) => a.position_mm + 900),
    vehicle.overall_length_mm ?? 0,
  ];
  const vehicleLength = Math.max(1000, ...ends);
  const firstCargo = cargo.length ? Math.min(...cargo.map((d) => d.x_mm)) : vehicleLength;
  const cabLength = Math.min(2600, Math.max(1200, firstCargo - 150));
  return { x0: -MARGIN_MM, width: vehicleLength + 2 * MARGIN_MM, vehicleLength, cabLength };
}

function unique<T>(xs: T[]): T[] {
  return [...new Set(xs)];
}

function buildStacks(result: PlanResult, vehicle: VehicleConfig, reference: ReferenceData, mode: ColorMode,
                     units: Units): PlanStack[] {
  const decks = new Map(vehicle.decks.map((d) => [d.id, d]));
  const groups = new Map<string, Placement[]>();
  for (const p of result.placements) {
    if (!decks.has(p.deck_id)) continue;
    const key = `${p.deck_id}:${p.stack_id}`;
    const g = groups.get(key);
    if (g) g.push(p);
    else groups.set(key, [p]);
  }
  const multiDeck = vehicle.decks.filter((d) => d.cargo).length > 1;
  const typeIds = result.placements.map((p) => p.type_id);
  const raw = [...groups.entries()].map(([key, ps]) => {
    const sorted = [...ps].sort((a, b) => a.stack_level - b.stack_level || a.z_mm - b.z_mm);
    const base = sorted[0];
    const deck = decks.get(base.deck_id)!;
    const weight = sorted.reduce((s, p) => s + p.weight_kg, 0);
    const loadTop = Math.max(...sorted.map((p) => p.z_mm + p.height_mm));
    return { key, sorted, base, deck, weight, top: deck.deck_height_mm + loadTop };
  });
  const weights = raw.map((s) => s.weight);
  const [minW, maxW] = [Math.min(...weights), Math.max(...weights)];

  return raw.map(({ key, sorted, base, deck, weight, top }) => {
    const label = unique(sorted.map((p) => p.label || p.item_id)).join(" / ");
    const typeName = typeNameOf(reference, base);
    const pattern = typePattern(base.type_id, typeIds);
    const overLimit = top > vehicle.overall_height_limit_mm;
    let paint: Paint;
    if (mode === "weight") {
      const heat = heatColor(weight, minW, maxW);
      paint = { fill: heat.fill, text: heat.text, pattern: null, badge: "" };
    } else if (mode === "type") {
      paint = { fill: "var(--color-surface)", text: "var(--color-text)", pattern: pattern.kind, badge: pattern.code };
    } else {
      paint = { fill: stopColor(base.stop), text: stopTextColor(base.stop), pattern: null, badge: stopBadge(base.stop) };
    }
    const n = sorted.length;
    const description = [
      label,
      `${typeName} ${units.footprint(base.length_mm, base.width_mm)}`,
      n > 1 ? `${units.weight(weight)} in total` : units.weight(weight),
      base.stop == null ? "no stop" : `stop ${base.stop}`,
      ...(n > 1 ? [`stack of ${n}`] : []),
      ...(multiDeck ? [`on the ${deck.name.toLowerCase()}`] : []),
      ...(overLimit ? ["over the height limit"] : []),
    ].join(", ");
    return {
      key, units: sorted, base, deck,
      x: deck.x_mm + base.x_mm, y: base.y_mm, length: base.length_mm, width: base.width_mm,
      weight, top, label, typeName, typeCode: pattern.code, stop: base.stop, overLimit, paint, description,
    };
  }).sort((a, b) => a.x - b.x || b.y - a.y);
}

// ---- Component ------------------------------------------------------------------------------

interface Shown {
  key: string;
  anchor: Anchor;
}

export default function LoadPlanView({ result, reference, request }: LoadPlanViewProps) {
  const units = useUnits();
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const tableId = `${uid}-table`;
  const detailsId = `${uid}-details`;
  const [mode, setMode] = useState<ColorMode>("stop");
  const [zoom, setZoom] = useState(1);
  const [hovered, setHovered] = useState<Shown | null>(null);
  const [active, setActive] = useState<Shown | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const deckScroll = useRef<HTMLDivElement>(null);
  const elevScroll = useRef<HTMLDivElement>(null);
  const pinch = useRef<{ dist: number; zoom: number } | null>(null);

  const vehicle = reference.vehicles[result.vehicle_id] as VehicleConfig | undefined;
  const stacks = useMemo(
    () => (vehicle ? buildStacks(result, vehicle, reference, mode, units) : []),
    [result, vehicle, reference, mode, units],
  );
  const frame = useMemo(() => (vehicle ? frameFor(vehicle) : null), [vehicle]);

  const anchorFor = useCallback((el: Element): Anchor => {
    const r = el.getBoundingClientRect();
    const root = rootRef.current?.getBoundingClientRect();
    return {
      left: r.left - (root?.left ?? 0), top: r.top - (root?.top ?? 0), width: r.width, height: r.height,
      containerWidth: root?.width ?? 0,
    };
  }, []);

  const events = useMemo<StackEvents>(() => ({
    highlighted: null,
    onEnter: (key, el) => setHovered({ key, anchor: anchorFor(el) }),
    onLeave: (key) => setHovered((h) => (h?.key === key ? null : h)),
    onFocus: (key, el) => setActive({ key, anchor: anchorFor(el) }),
    onBlur: (key) => setActive((a) => (a?.key === key ? null : a)),
    onDismiss: () => {
      setHovered(null);
      setActive(null);
    },
  }), [anchorFor]);
  const shown = hovered ?? active;
  const shownStack = shown ? stacks.find((s) => s.key === shown.key) : undefined;

  // Escape closes the popover wherever focus is (it may have opened on hover).
  const open = Boolean(shownStack);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") events.onDismiss();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, events]);
  const stackEvents = { ...events, highlighted: shownStack?.key ?? null };

  // Zoom: steps for the buttons, continuous for a pinch.
  const zoomIn = () => setZoom((z) => ZOOM_STEPS.find((s) => s > z + 0.01) ?? MAX_ZOOM);
  const zoomOut = () => setZoom((z) => [...ZOOM_STEPS].reverse().find((s) => s < z - 0.01) ?? 1);
  const minPx = frame ? Math.round(frame.width * MIN_PX_PER_MM) : 0;
  const svgWidth = `calc(max(${minPx}px, 100%) * ${zoom})`;

  // Keep both drawings on the same x scroll so they stay aligned; hide the popover while scrolling.
  const syncScroll = (from: HTMLDivElement) => {
    for (const other of [deckScroll.current, elevScroll.current]) {
      if (other && other !== from && other.scrollLeft !== from.scrollLeft) other.scrollLeft = from.scrollLeft;
    }
    events.onDismiss();
  };
  const touchDist = (e: TouchEvent) => {
    const [a, b] = [e.touches[0], e.touches[1]];
    return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
  };
  const scrollProps = {
    onScroll: (e: React.UIEvent<HTMLDivElement>) => syncScroll(e.currentTarget),
    onTouchStart: (e: TouchEvent) => {
      if (e.touches.length === 2) pinch.current = { dist: touchDist(e), zoom };
    },
    onTouchMove: (e: TouchEvent) => {
      if (e.touches.length !== 2 || !pinch.current) return;
      const next = pinch.current.zoom * (touchDist(e) / pinch.current.dist);
      setZoom(Math.min(MAX_ZOOM, Math.max(1, next)));
    },
    onTouchEnd: () => {
      pinch.current = null;
    },
  };

  const unplaced = useMemo(() => groupUnplaced(result.unplaced, request), [result.unplaced, request]);

  if (!vehicle || !frame) {
    return (
      <div className="lp" data-testid="load-plan-view">
        <p className="muted">No drawing for vehicle “{result.vehicle_name || result.vehicle_id}”.</p>
        <PlacementTable id={tableId} placements={result.placements} decks={[]} typeName={(p) => typeNameOf(reference, p)} />
      </div>
    );
  }

  return (
    <div className="lp" ref={rootRef} data-testid="load-plan-view">
      <div className="lp-toolbar">
        <div className="lp-toolbar-group">
          <span className="lp-toolbar-label" id={`${uid}-colour`}>Colour by</span>
          <fieldset className="segmented" aria-labelledby={`${uid}-colour`}>
            {([["stop", "Stop"], ["weight", "Weight"], ["type", "Type"]] as [ColorMode, string][]).map(([value, label]) => (
              <label key={value}>
                <input type="radio" name={`${uid}-colour-mode`} value={value} checked={mode === value}
                       onChange={() => setMode(value)} />
                <span>{label}</span>
              </label>
            ))}
          </fieldset>
        </div>
        <div className="lp-toolbar-group" role="group" aria-label="Zoom the drawing">
          <button type="button" className="btn btn-sm btn-icon" onClick={zoomOut} disabled={zoom <= 1}
                  aria-label="Zoom out">−</button>
          <output className="lp-zoom num" aria-live="polite" aria-label="Zoom level">{Math.round(zoom * 100)} %</output>
          <button type="button" className="btn btn-sm btn-icon" onClick={zoomIn} disabled={zoom >= MAX_ZOOM}
                  aria-label="Zoom in">+</button>
          <button type="button" className="btn btn-sm" onClick={() => setZoom(1)} disabled={zoom === 1}
                  aria-label="Fit to width">Fit</button>
        </div>
      </div>

      <figure className="lp-figure">
        <div className="lp-scroll" ref={deckScroll} {...scrollProps}>
          <DeckView vehicle={vehicle} stacks={stacks} frame={frame} mode={mode} width={svgWidth}
                    describedBy={tableId} events={stackEvents} detailsId={shownStack ? detailsId : undefined} />
        </div>
        <figcaption className="subtle lp-caption">Top-down view, driver’s side at the bottom.</figcaption>
      </figure>

      <Legend mode={mode} stacks={stacks} />

      <figure className="lp-figure">
        <div className="lp-scroll" ref={elevScroll} {...scrollProps}>
          <ElevationView vehicle={vehicle} stacks={stacks} frame={frame} mode={mode} width={svgWidth}
                         maxLoadHeight={result.max_load_height_mm} events={stackEvents} />
        </div>
        <figcaption className="subtle lp-caption">Side view from the driver’s side.</figcaption>
      </figure>

      {unplaced.length > 0 && (
        <section className="lp-unplaced" aria-labelledby={`${uid}-unplaced`}>
          <h3 id={`${uid}-unplaced`} className="lp-unplaced-title">
            <span className="badge badge-error num">{result.unplaced.length}</span> Not placed
          </h3>
          <ul className="lp-unplaced-list">
            {unplaced.map((g) => (
              <li key={g.itemId}>
                <strong>{g.label}</strong>{" "}
                <span className="muted num">× {g.unitIds.length}</span>{" "}
                <span className="subtle">({g.unitIds.join(", ")})</span>
              </li>
            ))}
          </ul>
          <p className="subtle">These units didn’t fit. See the warnings below for why and what to try.</p>
        </section>
      )}

      <PlacementTable id={tableId} placements={result.placements} decks={vehicle.decks}
                      typeName={(p) => typeNameOf(reference, p)} />

      {shown && shownStack && (
        <ItemDetails id={detailsId} stack={shownStack} anchor={shown.anchor}
                     heightLimit={vehicle.overall_height_limit_mm} />
      )}
    </div>
  );
}

interface UnplacedGroup {
  itemId: string;
  label: string;
  unitIds: string[];
}

function groupUnplaced(unitIds: string[], request: PlanRequest): UnplacedGroup[] {
  const groups = new Map<string, UnplacedGroup>();
  for (const unitId of unitIds) {
    const itemId = unitId.includes("#") ? unitId.slice(0, unitId.lastIndexOf("#")) : unitId;
    const item = request.items.find((i) => i.id === itemId);
    const g = groups.get(itemId) ?? { itemId, label: item?.label || itemId, unitIds: [] };
    g.unitIds.push(unitId);
    groups.set(itemId, g);
  }
  return [...groups.values()];
}
