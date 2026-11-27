// Step 3's drawing, one view at a time (the toolbar's "View"): the top-down deck view to scale, the
// side elevation from either side against the height limit, or the rear view through the back
// doors. Colour by DG class / weight / type, with a legend; item details on hover / tap / focus; the
// same placements as a table for screen readers. The toolbar's "3D" swaps the drawing for a 3D view
// of the truck (TruckScene3D.jsx, loaded on first use), its units dropping in floor first.
//
// Driven purely by the planner's response: placements are grouped into floor stacks (by deck and
// stack_id) and drawn where the API put them. Nothing here moves or re-plans a unit.
//
// Hover link with the freight table: `lit` (a freight line hovered in step 2) lights its stacks;
// hovering a stack or a 3D unit reports its units through `onHoverLit`.

import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode, type TouchEvent } from "react";
import type { Deck, DgInfo, FleetResult, Placement, PlanRequest, PlanResult, PlanWarning, ReferenceData, VehicleConfig } from "../api/types.ts";
import { colorFor } from "../lib/capacity.ts";
import { dgByItem, dgConflicts, dgLabel, dgName, placardCode } from "../lib/dg.ts";
import { catColor, catTextColor, heatColor, typePattern, type PatternKind } from "../lib/colors.ts";
import { fleetScene, isLit, litFromIds, litIds, type Lit } from "../lib/sceneData.ts";
import { useDropAnimation } from "../lib/useDropAnimation.ts";
import { useUnits, type Units } from "../lib/units.ts";
import DeckView from "./DeckView.tsx";
import ElevationView, { RearView } from "./ElevationView.tsx";
import { Scene3DView, ViewToggle, type TruckView } from "./FleetOverview.tsx";
import { AlertIcon } from "./icons.tsx";
import ItemDetails, { type Anchor } from "./ItemDetails.tsx";
import Legend from "./Legend.tsx";
import PlacementTable from "./PlacementTable.tsx";
import "./LoadPlanView.css";

export interface LoadPlanViewProps {
  /** One truck's plan. */
  result?: PlanResult;
  /** Or a whole split: every truck, one drawing under another (3D: all of them side by side). */
  fleet?: FleetResult;
  /** All-trucks mode: open a truck (its heading, or a truck clicked in 3D). */
  onSelectTruck?(index: number): void;
  reference: ReferenceData;
  /** The request that produced `result` / `fleet` (item labels, DG data). */
  request: PlanRequest;
  /** The toolbar's choices, when the page keeps them (otherwise the view keeps its own). */
  settings?: DrawingSettings;
  onSettingsChange?(settings: DrawingSettings): void;
  /** What is lit across the page (lib/sceneData.ts): a freight line hovered in step 2. */
  lit?: Lit | null;
  /** Hovering a stack or a 3D unit: its units (null when the pointer leaves). */
  onHoverLit?(lit: Lit | null): void;
  /** Focusing a unit in the 3D view's list. */
  onFocusLit?(lit: Lit | null): void;
}

// ---- Shared model (types only; the views draw it) ------------------------------------

export type ColorMode = "line" | "dg" | "weight" | "type";

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

/** How one unit looks from the side: its fill and its DG placard code (null for general freight). */
export interface UnitFace {
  fill: string;
  dg: string | null;
  /** Its freight line's place in the request (the legend lists lines in that order). */
  line: number;
}

/** One floor position: the floor unit and anything stacked on it. */
export interface PlanStack {
  key: string;
  /** Floor first. */
  units: Placement[];
  /** Each unit's look, in the same order as `units` (by freight line, each unit its own colour). */
  faces: UnitFace[];
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
  /** Stacks lit from outside the drawing (a freight line hovered in step 2); the rest are dimmed
   *  while nothing is highlighted. */
  lit?: string[] | null;
  onEnter(key: string, el: Element): void;
  onLeave(key: string): void;
  onFocus(key: string, el: Element): void;
  onBlur(key: string): void;
  onDismiss(): void;
}

/** The 2D drawing shown. */
export type PlanSide = "top" | "driver" | "passenger" | "rear";

/** The toolbar's choices, shared by every truck's drawing (PlannerApp keeps them across trucks). */
export interface DrawingSettings {
  view: TruckView;
  side: PlanSide;
  mode: ColorMode;
  zoom: number;
}
const DEFAULT_DRAWING: DrawingSettings = { view: "2d", side: "top", mode: "line", zoom: 1 };
const MODES: [ColorMode, string][] = [["line", "Line"], ["dg", "DG class"], ["weight", "Weight"], ["type", "Type"]];
/** Text on the freight line colours (lib/capacity.ts colorFor keeps them light enough for it). */
const LINE_TEXT = "#0f172a";
const SIDES: [PlanSide, string][] = [["top", "Top"], ["driver", "Driver side"], ["passenger", "Passenger side"], ["rear", "Rear"]];

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
  /** Freight line index by item id (its place in the request), for the line colours. */
  lines: Map<string, number>;
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

/** Each floor stack's total weight, for the weight colours' range. */
function stackWeights(result: PlanResult): number[] {
  const sums = new Map<string, number>();
  for (const p of result.placements) sums.set(`${p.deck_id}:${p.stack_id}`, (sums.get(`${p.deck_id}:${p.stack_id}`) ?? 0) + p.weight_kg);
  return [...sums.values()];
}

/** A freight line's colour, the same as in the 3D view (lib/sceneData.ts numbers lines the same way). */
function lineFill(itemId: string, ctx: DgContext): string {
  return colorFor(ctx.lines.get(itemId) ?? ctx.lines.size);
}

function buildStacks(result: PlanResult, vehicle: VehicleConfig, reference: ReferenceData, mode: ColorMode,
                     units: Units, ctx: DgContext, classes: Map<string, DgClassColour>,
                     weightRange: [number, number]): PlanStack[] {
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
  const [minW, maxW] = weightRange;

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
    } else if (mode === "line") {
      // From above you see the top unit, so the stack takes its line's colour.
      paint = { fill: lineFill(sorted[sorted.length - 1].item_id, ctx), text: LINE_TEXT, pattern: null, badge: "" };
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
    const faces = sorted.map((u) => ({
      fill: mode === "line" ? lineFill(u.item_id, ctx) : paint.fill,
      dg: placardCode(ctx.dg.get(u.item_id)) || null,
      line: ctx.lines.get(u.item_id) ?? ctx.lines.size,
    }));
    return {
      key, units: sorted, faces, base, deck,
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

/** What one truck's drawing needs, worked out once per plan. */
interface TruckModel {
  result: PlanResult;
  vehicle: VehicleConfig | undefined;
  frame: Frame | null;
  dgCtx: DgContext;
  stacks: PlanStack[];
  dgBanner: string | null;
}

export default function LoadPlanView({
  result, fleet, onSelectTruck, reference, request, settings: given, onSettingsChange, lit = null, onHoverLit, onFocusLit,
}: LoadPlanViewProps) {
  const units = useUnits();
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const [own, setOwn] = useState<DrawingSettings>(DEFAULT_DRAWING);
  const settings = given ?? own;
  const { view, side, mode, zoom } = settings;
  const set = (patch: Partial<DrawingSettings>) => {
    const next = { ...settings, ...patch };
    if (onSettingsChange) onSettingsChange(next);
    else setOwn(next);
  };
  const all = Boolean(fleet);
  const plans = useMemo(() => (fleet ? fleet.trucks : result ? [result] : []), [fleet, result]);

  // The 3D view's truck(s), built only while shown; a new one (3D switched on, or a new plan)
  // starts the drop-in again.
  const scene = useMemo(() => {
    const source = fleet ?? result;
    return view === "3d" && source ? fleetScene(source, reference, request) : null;
  }, [view, fleet, result, reference, request]);
  const drop = useDropAnimation(scene?.drop_order.length ?? 0, scene);

  // Colours mean the same on every truck: DG classes and the weight range are taken over all of them.
  const dg = useMemo(() => dgByItem(request), [request]);
  const dgClasses = useMemo(() => dgClassColours(plans.flatMap((r) => r.placements), dg), [plans, dg]);
  const models = useMemo<TruckModel[]>(() => {
    const weights = plans.flatMap(stackWeights);
    const range: [number, number] = [Math.min(...weights), Math.max(...weights)];
    const labels = new Map(request.items.map((i) => [i.id, i.label?.trim() || i.id]));
    const lines = new Map(request.items.map((i, k) => [i.id, k]));
    return plans.map((r) => {
      const vehicle = reference.vehicles[r.vehicle_id] as VehicleConfig | undefined;
      const dgCtx: DgContext = { dg, conflicts: dgConflicts(r.warnings), labels, lines };
      return {
        result: r, vehicle, dgCtx,
        frame: vehicle ? frameFor(vehicle) : null,
        stacks: vehicle ? buildStacks(r, vehicle, reference, mode, units, dgCtx, dgClasses, range) : [],
        dgBanner: incompatibleSummary(r.warnings, labels),
      };
    });
  }, [plans, reference, request, mode, units, dg, dgClasses]);
  const allStacks = useMemo(() => models.flatMap((m) => m.stacks), [models]);

  // Zoom: steps for the buttons (a pinch is continuous, in TruckDrawing).
  const zoomIn = () => set({ zoom: ZOOM_STEPS.find((s) => s > zoom + 0.01) ?? MAX_ZOOM });
  const zoomOut = () => set({ zoom: [...ZOOM_STEPS].reverse().find((s) => s < zoom - 0.01) ?? 1 });

  if (!all && models[0] && (!models[0].vehicle || !models[0].frame)) {
    const { result: r, dgCtx } = models[0];
    return (
      <div className="lp" data-testid="load-plan-view">
        <p className="muted">No drawing for vehicle “{r.vehicle_name || r.vehicle_id}”.</p>
        <PlacementTable id={`${uid}-table`} placements={r.placements} decks={[]} typeName={(p) => typeNameOf(reference, p)}
                        dg={dgCtx.dg} />
      </div>
    );
  }

  const legend = <Legend mode={mode} stacks={allStacks} dgClasses={dgClasses} />;
  const drawing = (m: TruckModel, i: number) => (
    <TruckDrawing key={i} model={m} settings={settings} reference={reference} request={request}
                  onZoom={(z) => set({ zoom: z })} lit={lit} onHoverLit={onHoverLit}
                  title={all ? `Truck ${i + 1}` : undefined} onTitle={onSelectTruck && (() => onSelectTruck(i))}
                  legend={all ? undefined : legend} details={!all} />
  );

  return (
    <div className="lp" data-testid="load-plan-view">
      <div className="lp-toolbar">
        <div className="lp-toolbar-group">
          <ViewToggle view={view} onChange={(v) => set({ view: v })} label="Drawing" />
          {scene && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={drop.replay}>
              <span aria-hidden="true">↻</span> Replay
            </button>
          )}
        </div>
        {!scene && <>
        <div className="lp-toolbar-group">
          <span className="lp-toolbar-label" id={`${uid}-side`}>View</span>
          <fieldset className="segmented" aria-labelledby={`${uid}-side`}>
            {SIDES.map(([value, label]) => (
              <label key={value}>
                <input type="radio" name={`${uid}-side`} value={value} checked={side === value}
                       onChange={() => set({ side: value })} />
                <span>{label}</span>
              </label>
            ))}
          </fieldset>
        </div>
        <div className="lp-toolbar-group">
          <span className="lp-toolbar-label" id={`${uid}-colour`}>Colour by</span>
          <fieldset className="segmented" aria-labelledby={`${uid}-colour`}>
            {MODES.map(([value, label]) => (
              <label key={value}>
                <input type="radio" name={`${uid}-colour-mode`} value={value} checked={mode === value}
                       onChange={() => set({ mode: value })} />
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
          <button type="button" className="btn btn-sm" onClick={() => set({ zoom: 1 })} disabled={zoom === 1}
                  aria-label="Fit to width">Fit</button>
        </div>
        </>}
      </div>

      {scene ? <>
        {!all && models[0]?.dgBanner && <DgBanner text={models[0].dgBanner} />}
        <figure className="lp-figure">
          <Scene3DView scene={scene} step={drop.step} activeIds={litIds(scene, lit)}
                       onHover={(ids) => onHoverLit?.(litFromIds(scene, ids))}
                       onFocusBlock={(ids) => onFocusLit?.(litFromIds(scene, ids))}
                       onSelectTruck={all ? onSelectTruck : undefined} />
          <figcaption className="subtle lp-caption">
            3D view, one colour per line. Drag to turn it{all && onSelectTruck ? "; click a truck to open it" : ""}.
          </figcaption>
        </figure>
        {!all && models[0] && <TruckDetails model={models[0]} reference={reference} request={request} tableId={`${uid}-table`} />}
      </> : all ? <>
        <div className="lp-trucks">{models.map(drawing)}</div>
        {legend}
      </> : models[0] && drawing(models[0], 0)}
    </div>
  );
}

function DgBanner({ text }: { text: string }) {
  return (
    <p className="lp-dg-banner" role="note">
      <AlertIcon className="lp-dg-banner-icon" />
      <span>
        <strong>Incompatible dangerous goods on this vehicle:</strong> {text}. Split them into separate loads.
      </span>
    </p>
  );
}

/** Under one truck's drawing: the units that didn't fit, and every placement as a table. */
function TruckDetails({ model, reference, request, tableId }: {
  model: TruckModel; reference: ReferenceData; request: PlanRequest; tableId: string;
}) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const { result, vehicle, dgCtx } = model;
  const unplaced = useMemo(() => groupUnplaced(result.unplaced, request), [result.unplaced, request]);
  return <>
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
    <PlacementTable id={tableId} placements={result.placements} decks={vehicle?.decks ?? []}
                    typeName={(p) => typeNameOf(reference, p)} dg={dgCtx.dg} />
  </>;
}

interface TruckDrawingProps {
  model: TruckModel;
  settings: DrawingSettings;
  reference: ReferenceData;
  request: PlanRequest;
  onZoom(zoom: number): void;
  lit: Lit | null;
  onHoverLit?(lit: Lit | null): void;
  /** All-trucks mode: "Truck 2", a button that opens the truck when `onTitle` is given. */
  title?: string;
  onTitle?(): void;
  /** Shown right under the drawing (one truck: the legend, before the table). */
  legend?: ReactNode;
  /** One truck: the unplaced list and the placement table below. */
  details: boolean;
}

/** One truck's 2D drawing in the chosen view, with its own hover / focus popover. */
function TruckDrawing({ model, settings, reference, request, onZoom, lit, onHoverLit, title, onTitle, legend, details }: TruckDrawingProps) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const tableId = `${uid}-table`;
  const detailsId = `${uid}-details`;
  const { result, vehicle, frame, stacks, dgBanner } = model;
  const { side, mode, zoom } = settings;
  const [hovered, setHovered] = useState<Shown | null>(null);
  const [active, setActive] = useState<Shown | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const pinch = useRef<{ dist: number; zoom: number } | null>(null);

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

  // A new view draws different shapes: close the popover that pointed at the old one.
  useEffect(() => events.onDismiss(), [side, events]);
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
  // Stacks holding a lit unit (null for none, so nothing dims for a line that isn't on this truck).
  const litStacks = useMemo(() => {
    const keys = lit ? stacks.filter((s) => s.units.some((u) => isLit(lit, u))).map((s) => s.key) : [];
    return keys.length ? keys : null;
  }, [lit, stacks]);
  const stackLit = (key: string): Lit | null => {
    const s = stacks.find((x) => x.key === key);
    return s ? { items: unique(s.units.map((u) => u.item_id)), units: s.units.map((u) => u.unit_id) } : null;
  };
  const stackEvents: StackEvents = {
    ...events,
    highlighted: shownStack?.key ?? null,
    lit: litStacks,
    onEnter: (key, el) => {
      events.onEnter(key, el);
      onHoverLit?.(stackLit(key));
    },
    onLeave: (key) => {
      events.onLeave(key);
      onHoverLit?.(null);
    },
  };

  // A share of the box, so "fit" follows the box as the page is resized, with nothing to recompute.
  const svgWidth = `${Math.round(zoom * 10000) / 100}%`;
  // The rear view is only about 2.5 m wide: a fixed size (or the box, if narrower), times the zoom.
  const rearWidth = `calc(${zoom} * min(100%, 12rem))`;
  const touchDist = (e: TouchEvent) => {
    const [a, b] = [e.touches[0], e.touches[1]];
    return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
  };
  const scrollProps = {
    // The popover is placed against the drawing, so it closes when the drawing scrolls.
    onScroll: () => events.onDismiss(),
    onTouchStart: (e: TouchEvent) => {
      if (e.touches.length === 2) pinch.current = { dist: touchDist(e), zoom };
    },
    onTouchMove: (e: TouchEvent) => {
      if (e.touches.length !== 2 || !pinch.current) return;
      const next = pinch.current.zoom * (touchDist(e) / pinch.current.dist);
      onZoom(Math.min(MAX_ZOOM, Math.max(1, next)));
    },
    onTouchEnd: () => {
      pinch.current = null;
    },
  };

  return (
    <div className="lp-truck" ref={rootRef}>
      {title && (
        <h4 className="lp-truck-title">
          {onTitle ? (
            <button type="button" className="btn btn-ghost btn-sm" onClick={onTitle}>
              {title} <span aria-hidden="true">→</span>
            </button>
          ) : title}
        </h4>
      )}
      {dgBanner && <DgBanner text={dgBanner} />}
      {vehicle && frame ? (
        <figure className="lp-figure">
          <div className="lp-scroll" {...scrollProps}>
            {side === "top" && (
              <DeckView vehicle={vehicle} stacks={stacks} frame={frame} mode={mode} width={svgWidth}
                        describedBy={details ? tableId : undefined} events={stackEvents}
                        detailsId={shownStack ? detailsId : undefined} />
            )}
            {(side === "driver" || side === "passenger") && (
              <ElevationView vehicle={vehicle} stacks={stacks} frame={frame} mode={mode} width={svgWidth} side={side}
                             maxLoadHeight={result.max_load_height_mm} events={stackEvents} />
            )}
            {side === "rear" && (
              <RearView vehicle={vehicle} stacks={stacks} mode={mode} width={rearWidth}
                        maxLoadHeight={result.max_load_height_mm} events={stackEvents} />
            )}
          </div>
          {/* All trucks share one caption's worth of meaning: say it once, under the first. */}
          {(!title || title === "Truck 1") && (
            <figcaption className="subtle lp-caption">
              {side === "top" ? "Top-down view, driver’s side at the bottom."
                : side === "rear" ? "Rear view through the back doors, driver’s side at the left."
                : `Side view from the ${side}’s side, front at the ${side === "driver" ? "left" : "right"}.`}
            </figcaption>
          )}
        </figure>
      ) : (
        <p className="muted">No drawing for vehicle “{result.vehicle_name || result.vehicle_id}”.</p>
      )}

      {legend}
      {details && <TruckDetails model={model} reference={reference} request={request} tableId={tableId} />}

      {shown && shownStack && vehicle && (
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
