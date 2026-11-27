// Step 3's drawing: a top-down deck view to scale (colour by DG class / weight / type, with a legend),
// the side elevation against the height limit, item details on hover / tap / focus, and the same
// placements as a table for screen readers.
//
// Driven purely by the planner's response: placements are grouped into floor stacks (by deck and
// stack_id) and drawn where the API put them. Nothing here moves or re-plans a unit.

import { useCallback, useEffect, useId, useMemo, useRef, useState, type TouchEvent } from "react";
import type { Deck, DgInfo, Placement, PlanRequest, PlanResult, PlanWarning, ReferenceData, VehicleConfig } from "../api/types.ts";
import { dgByItem, dgConflicts, dgLabel, dgName, placardCode } from "../lib/dg.ts";
import { catColor, catTextColor, heatColor, typePattern, type PatternKind } from "../lib/colors.ts";
import { useUnits, type Units } from "../lib/units.ts";
import DeckView from "./DeckView.tsx";
import ElevationView from "./ElevationView.tsx";
import { AlertIcon } from "./icons.tsx";
import ItemDetails, { type Anchor } from "./ItemDetails.tsx";
import Legend from "./Legend.tsx";
import PlacementTable from "./PlacementTable.tsx";
import "./LoadPlanView.css";

export interface LoadPlanViewProps {
  result: PlanResult;
  reference: ReferenceData;
  /** The request that produced `result` (item labels, DG data). */
  request: PlanRequest;
}

// ---- Shared model (types only; the views draw it) ------------------------------------

export type ColorMode = "dg" | "weight" | "type";

export interface Paint {
  fill: string;
  text: string;
  /** Type mode: the pattern laid over the fill. */
  pattern: PatternKind | null;
  /** The badge that carries the colour's meaning: "AU" (type mode) or "" (the DG class mode has the
   *  DG diamonds instead). */
  badge: string;
}

/** A dangerous goods line carried in a stack (from the request's `items[].dg`). */
export interface StackDg {
  itemId: string;
  label: string;
  info: DgInfo;
  /** Placard code: "3", "5.1", "1.4S", "F", "R". */
  code: string;
  /** "Class 5.1 Oxidising substance", plus subsidiaries: "Class 3 Flammable liquid, subsidiary 6.1". */
  text: string;
}

/** The stack's lines named in DG_INCOMPATIBLE (error) / DG_CHECK (warning) plan warnings. */
export interface StackConflict {
  severity: "error" | "warning";
  /** "Pool chlorine (Class 5.1)" for each other line this stack's goods conflict with. */
  with: string[];
  messages: string[];
}

/** A DG class present in the plan and its colour in the DG class mode. */
export interface DgClassColour {
  /** Placard code: "3", "5.1", "F". */
  code: string;
  /** "Flammable liquid", "Food". */
  name: string;
  fill: string;
  text: string;
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
  overLimit: boolean;
  paint: Paint;
  /** DG lines in the stack, floor first; empty for general freight. */
  dg: StackDg[];
  conflict: StackConflict | null;
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
/** Zoom 1 is "fit": the drawing is as wide as its box, at any width. Above that the box scrolls. */
const ZOOM_STEPS = [1, 1.5, 2, 3, 4];
const MAX_ZOOM = ZOOM_STEPS[ZOOM_STEPS.length - 1];

function typeNameOf(reference: ReferenceData, p: Pick<Placement, "kind" | "type_id">): string {
  if (p.kind === "loose") return "Loose item";
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

/** "Class 5.1 Oxidising substance", "Class 3 Flammable liquid, subsidiary 6.1", "Food". */
function dgText(dg: DgInfo): string {
  if (!dg.dg_class) return dgName(dg);
  const subs = [...(dg.subsidiary ?? [])].sort();
  return `Class ${placardCode(dg)} ${dgName(dg)}${subs.length ? `, subsidiary ${subs.join(", ")}` : ""}`;
}

/** Each distinct DG class in the plan (by placard code) gets the next categorical colour, in order of
 *  first appearance in the placements. General freight has none (it takes --cat-none). */
function dgClassColours(placements: Placement[], dg: Map<string, DgInfo>): Map<string, DgClassColour> {
  const out = new Map<string, DgClassColour>();
  for (const p of placements) {
    const info = dg.get(p.item_id);
    const code = placardCode(info);
    if (!code || out.has(code)) continue;
    out.set(code, { code, name: dgName(info), fill: catColor(out.size), text: catTextColor(out.size) });
  }
  return out;
}

/** DG and conflict data for the plan: the request's DG per line and the plan's warnings (never recalculated). */
interface DgContext {
  dg: Map<string, DgInfo>;
  conflicts: ReturnType<typeof dgConflicts>;
  /** Item label by id. */
  labels: Map<string, string>;
}

function stackDg(units: Placement[], ctx: DgContext): { dg: StackDg[]; conflict: StackConflict | null } {
  const ids = unique(units.map((u) => u.item_id));
  const dg = ids.flatMap((id) => {
    const info = ctx.dg.get(id);
    const code = placardCode(info);
    return info && code ? [{ itemId: id, label: ctx.labels.get(id) ?? id, info, code, text: dgText(info) }] : [];
  });
  const found = ids.map((id) => ctx.conflicts.get(id)).filter((c) => c !== undefined);
  if (!found.length) return { dg, conflict: null };
  const others = unique(found.flatMap((c) => c.with)).filter((id) => !ids.includes(id));
  const named = (id: string) => {
    const label = ctx.labels.get(id) ?? id;
    const info = ctx.dg.get(id);
    return info ? `${label} (${dgLabel(info).replace(/ \(sub .*\)$/, "")})` : label;
  };
  return {
    dg,
    conflict: {
      severity: found.some((c) => c.severity === "error") ? "error" : "warning",
      with: others.map(named),
      messages: unique(found.flatMap((c) => c.messages)),
    },
  };
}

function buildStacks(result: PlanResult, vehicle: VehicleConfig, reference: ReferenceData, mode: ColorMode,
                     units: Units, ctx: DgContext, classes: Map<string, DgClassColour>): PlanStack[] {
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
    const { dg, conflict } = stackDg(sorted, ctx);
    let paint: Paint;
    if (mode === "weight") {
      const heat = heatColor(weight, minW, maxW);
      paint = { fill: heat.fill, text: heat.text, pattern: null, badge: "" };
    } else if (mode === "type") {
      paint = { fill: "var(--color-surface)", text: "var(--color-text)", pattern: pattern.kind, badge: pattern.code };
    } else {
      // Coloured by the stack's first (lowest) DG line; general freight takes the neutral.
      const cls = dg.length ? classes.get(dg[0].code) : undefined;
      paint = { fill: cls?.fill ?? catColor(null), text: cls?.text ?? catTextColor(null), pattern: null, badge: "" };
    }
    const n = sorted.length;
    const description = [
      label,
      `${typeName} ${units.footprint(base.length_mm, base.width_mm)}`,
      n > 1 ? `${units.weight(weight)} in total` : units.weight(weight),
      ...(n > 1 ? [`stack of ${n}`] : []),
      ...(multiDeck ? [`on the ${deck.name.toLowerCase()}`] : []),
      ...(overLimit ? ["over the height limit"] : []),
      ...dg.map((d) => `dangerous goods${dg.length > 1 ? ` (${d.label})` : ""}: ${d.text}`),
      ...(conflict?.with.length ? [`conflicts with ${conflict.with.join(", ")}`] : []),
    ].join(", ");
    return {
      key, units: sorted, base, deck,
      x: deck.x_mm + base.x_mm, y: base.y_mm, length: base.length_mm, width: base.width_mm,
      weight, top, label, typeName, typeCode: pattern.code, overLimit, paint, dg, conflict, description,
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
  const [mode, setMode] = useState<ColorMode>("dg");
  const [zoom, setZoom] = useState(1);
  const [hovered, setHovered] = useState<Shown | null>(null);
  const [active, setActive] = useState<Shown | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const deckScroll = useRef<HTMLDivElement>(null);
  const elevScroll = useRef<HTMLDivElement>(null);
  const pinch = useRef<{ dist: number; zoom: number } | null>(null);

  const vehicle = reference.vehicles[result.vehicle_id] as VehicleConfig | undefined;
  const dgCtx = useMemo<DgContext>(() => ({
    dg: dgByItem(request),
    conflicts: dgConflicts(result.warnings),
    labels: new Map(request.items.map((i) => [i.id, i.label?.trim() || i.id])),
  }), [request, result.warnings]);
  const dgClasses = useMemo(() => dgClassColours(result.placements, dgCtx.dg), [result.placements, dgCtx.dg]);
  const stacks = useMemo(
    () => (vehicle ? buildStacks(result, vehicle, reference, mode, units, dgCtx, dgClasses) : []),
    [result, vehicle, reference, mode, units, dgCtx, dgClasses],
  );
  const dgBanner = useMemo(() => incompatibleSummary(result.warnings, dgCtx.labels), [result.warnings, dgCtx.labels]);
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
  // A share of the box, so "fit" follows the box as the page is resized, with nothing to recompute.
  const svgWidth = `${Math.round(zoom * 10000) / 100}%`;

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
        <PlacementTable id={tableId} placements={result.placements} decks={[]} typeName={(p) => typeNameOf(reference, p)}
                        dg={dgCtx.dg} />
      </div>
    );
  }

  return (
    <div className="lp" ref={rootRef} data-testid="load-plan-view">
      <div className="lp-toolbar">
        <div className="lp-toolbar-group">
          <span className="lp-toolbar-label" id={`${uid}-colour`}>Colour by</span>
          <fieldset className="segmented" aria-labelledby={`${uid}-colour`}>
            {([["dg", "DG class"], ["weight", "Weight"], ["type", "Type"]] as [ColorMode, string][]).map(([value, label]) => (
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

      {dgBanner && (
        <p className="lp-dg-banner" role="note">
          <AlertIcon className="lp-dg-banner-icon" />
          <span>
            <strong>Incompatible dangerous goods on this vehicle:</strong> {dgBanner}. Split them into separate loads.
          </span>
        </p>
      )}

      <figure className="lp-figure">
        <div className="lp-scroll" ref={deckScroll} {...scrollProps}>
          <DeckView vehicle={vehicle} stacks={stacks} frame={frame} mode={mode} width={svgWidth}
                    describedBy={tableId} events={stackEvents} detailsId={shownStack ? detailsId : undefined} />
        </div>
        <figcaption className="subtle lp-caption">Top-down view, driver’s side at the bottom.</figcaption>
      </figure>

      <Legend mode={mode} stacks={stacks} dgClasses={dgClasses} />

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
                <span className="muted num">× {g.unitIds.length}</span>
              </li>
            ))}
          </ul>
          <p className="subtle">These units didn’t fit. See the warnings below for why and what to try.</p>
        </section>
      )}

      <PlacementTable id={tableId} placements={result.placements} decks={vehicle.decks}
                      typeName={(p) => typeNameOf(reference, p)} dg={dgCtx.dg} />

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

/**
 * "Pool chlorine with Paint, Battery acid" from the DG_INCOMPATIBLE warnings (each names a pair of
 * lines): the line with the most conflicts first, with all of them, then whatever pairs are left.
 * Null without DG_INCOMPATIBLE warnings.
 */
function incompatibleSummary(warnings: PlanWarning[], labels: Map<string, string>): string | null {
  const pairs = warnings.filter((w) => w.code === "DG_INCOMPATIBLE" && w.item_ids.length >= 2)
    .map((w) => [w.item_ids[0], w.item_ids[1]]);
  if (!pairs.length) return null;
  const left = new Set(pairs.map((_, i) => i));
  const groups: string[] = [];
  const name = (id: string) => labels.get(id) ?? id;
  while (left.size) {
    const partners = new Map<string, string[]>();
    for (const i of left) {
      const [a, b] = pairs[i];
      partners.set(a, [...(partners.get(a) ?? []), b]);
      partners.set(b, [...(partners.get(b) ?? []), a]);
    }
    const [id, others] = [...partners.entries()].sort((x, y) => y[1].length - x[1].length)[0];
    for (const i of [...left]) if (pairs[i].includes(id)) left.delete(i);
    groups.push(`${name(id)} with ${unique(others).map(name).join(", ")}`);
  }
  return groups.join("; ");
}
