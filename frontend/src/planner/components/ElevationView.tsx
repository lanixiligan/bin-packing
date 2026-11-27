// Side elevation, on the same x scale as the deck view: from the driver's side (front at the left)
// or the passenger's side (the same drawing mirrored, front at the right). Every placed unit is a
// rectangle from deck height + z_mm, height_mm tall; stacks that overlap across the width overlay
// with slight transparency (nearest the viewer on top). The dashed line is the vehicle's overall
// height limit; stacks above it are outlined in the error colour.
//
// RearView (below) is the end-on view through the back doors: the same units across the deck's
// width instead of along its length, so it shows how the width and height are used.

import { useId } from "react";
import type { Placement, VehicleConfig } from "../api/types.ts";
import { useUnits } from "../lib/units.ts";
import { AxleWheels, PatternDefs } from "./Legend.tsx";
import { DgDiamond } from "./DeckView.tsx";
import type { ColorMode, Frame, Paint, PlanStack, StackEvents, UnitFace } from "./LoadPlanView.tsx";
import "./ElevationView.css";

export interface ElevationViewProps {
  vehicle: VehicleConfig;
  stacks: PlanStack[];
  frame: Frame;
  mode: ColorMode;
  /** CSS width of the SVG; the same as the deck view's so the x scales match. */
  width: string;
  /** result.max_load_height_mm: the tallest point above the ground. */
  maxLoadHeight: number;
  events: StackEvents;
  /** Which side the viewer stands on (default the driver's). */
  side?: "driver" | "passenger";
}

const HEADROOM = 650;
const BELOW_GROUND = 250;
const CAB_HEIGHT = 3000;
const LABEL_FONT = 200;
const CHAR_WIDTH = 0.56;

/** The stack's classes for its highlight / dim / over-limit / conflict state (both views). */
function stackClass(s: PlanStack, events: StackEvents): string {
  // Lit from outside (a freight line hovered in step 2) only while no stack is highlighted here.
  const lit = !events.highlighted && Boolean(events.lit?.includes(s.key));
  const dim = events.highlighted ? events.highlighted !== s.key : events.lit && !lit;
  return `elev-stack${s.overLimit ? " is-over" : ""}${dim ? " is-dimmed" : ""}${events.highlighted === s.key || lit ? " is-highlighted" : ""}`
    + `${s.conflict ? ` has-conflict is-conflict-${s.conflict.severity}` : ""}`;
}

/** The warning triangles above a stack: over the height limit, conflicting DG (side by side when both). */
function StackMarks({ s, cx, y, scale = 1 }: { s: PlanStack; cx: number; y: number; scale?: number }) {
  const shift = s.overLimit && s.conflict ? 260 * scale : 0;
  return (
    <>
      {s.overLimit && (
        <g className="elev-warning" transform={`translate(${cx - shift} ${y}) scale(${scale})`}>
          <title>Over the height limit</title>
          <path d="M 0 -340 L 200 0 L -200 0 Z" />
          <text x={0} y={-50} textAnchor="middle">!</text>
        </g>
      )}
      {s.conflict && (
        <g className={`elev-conflict is-${s.conflict.severity}`} transform={`translate(${cx + shift} ${y}) scale(${scale})`}>
          <title>{s.conflict.severity === "error" ? "Incompatible dangerous goods" : "Dangerous goods to check"}</title>
          <path d="M 0 -340 L 200 0 L -200 0 Z" />
          <text x={0} y={-50} textAnchor="middle">!</text>
        </g>
      )}
    </>
  );
}

export default function ElevationView({ vehicle, stacks, frame, mode, width, maxLoadHeight, events, side = "driver" }: ElevationViewProps) {
  const units = useUnits();
  const prefix = `ev${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const limit = vehicle.overall_height_limit_mm;
  const tallestTop = Math.max(0, ...stacks.map((s) => s.top));
  const sky = Math.max(limit, maxLoadHeight, tallestTop, CAB_HEIGHT) + HEADROOM;
  const Y = (mm: number) => sky - mm; // height above ground -> svg y
  const height = sky + BELOW_GROUND;
  const cab = frame.cabLength;
  const end = frame.vehicleLength;

  // The passenger's side is the same drawing mirrored: x becomes vehicleLength − x, which keeps the
  // viewBox. Text stays outside the mirror (at the mirrored x, right-aligned) so it reads forwards.
  const mirror = side === "passenger";
  const flip = mirror ? `translate(${end} 0) scale(-1 1)` : undefined;
  const textX = (x: number) => (mirror ? end - x : x);
  const anchor = mirror ? "end" : "start";
  // Farthest from the viewer first, so the units on the viewer's side sit on top (y runs from the
  // driver's side).
  const ordered = [...stacks].sort((a, b) => (mirror ? a.y - b.y : b.y - a.y));
  const over = stacks.filter((s) => s.overLimit);
  const tallest = stacks.reduce<PlanStack | undefined>((t, s) => (!t || s.top > t.top ? s : t), undefined);

  const limitLabel = `${units.length(limit)} height limit`;
  const limitLabelEnd = limitLabel.length * LABEL_FONT * CHAR_WIDTH + 100;
  const tallestLabel = `Tallest ${units.length(maxLoadHeight)}`;
  const tallestX = tallest ? tallest.x : end - 2500;
  // Close to the limit, lift the tallest-point label above the limit line too; if that would hit the
  // limit label (both near the front), put it under its own line instead.
  const nearLimit = Math.abs(limit - maxLoadHeight) < 420;
  const tallestLabelY = !nearLimit ? Y(maxLoadHeight) - 90
    : tallestX < limitLabelEnd + 200 ? Y(maxLoadHeight) + 260
    : Y(Math.max(limit, maxLoadHeight)) - 90;

  const summary = `Side view from the ${side}'s side: tallest point ${units.length(maxLoadHeight)}, `
    + `height limit ${units.length(limit)}`
    + (over.length ? `, ${over.length} ${over.length === 1 ? "stack" : "stacks"} over the height limit.` : ", all within it.");

  return (
    <svg className="elevation-view" viewBox={`${frame.x0} 0 ${frame.width} ${height}`} style={{ width }}
         role="img" aria-label={summary} data-mode={mode}>
      <PatternDefs prefix={prefix} />

      <g transform={flip}>
      <g className="elev-chrome">
        <line x1={frame.x0} x2={frame.x0 + frame.width} y1={Y(0)} y2={Y(0)} className="elev-ground" />
        {/* Prime mover chassis, cab */}
        {vehicle.decks.filter((d) => !d.cargo).map((d) => (
          <rect key={d.id} x={0} y={Y(1150)} width={Math.max(cab, d.rear_support.position_mm + 900)} height={400}
                className="elev-chassis" />
        ))}
        <path className="elev-cab"
              d={`M 0 ${Y(550)} V ${Y(CAB_HEIGHT - 700)} L ${Math.min(500, cab / 4)} ${Y(CAB_HEIGHT)} H ${cab} V ${Y(550)} Z`} />
        <path className="elev-cab-window"
              d={`M ${Math.min(120, cab / 10)} ${Y(CAB_HEIGHT - 800)} L ${Math.min(560, cab / 4 + 60)} ${Y(CAB_HEIGHT - 150)} H ${cab * 0.55} V ${Y(CAB_HEIGHT - 800)} Z`} />
        {vehicle.decks.filter((d) => d.cargo).map((d) => (
          <rect key={d.id} x={d.x_mm} y={Y(d.deck_height_mm)} width={d.length_mm} height={220} className="elev-deck" />
        ))}
        {vehicle.axle_groups.map((a) => (
          <AxleWheels key={a.id} x={a.position_mm} groundY={Y(0)} kind={a.kind} />
        ))}
      </g>

      <g className="elev-stacks">
        {ordered.map((s) => (
          <g key={s.base.unit_id} data-stack={s.key} data-over-limit={s.overLimit || undefined}
             className={stackClass(s, events)} data-conflict={s.conflict?.severity}
             style={{ transform: `translate(${s.x}px, 0px)` }}
             onMouseEnter={(e) => events.onEnter(s.key, e.currentTarget)}
             onMouseLeave={() => events.onLeave(s.key)}
             onClick={(e) => events.onFocus(s.key, e.currentTarget)}>
            <title>{s.description}</title>
            {s.units.map((u, i) => (
              <UnitBox key={u.unit_id} u={u} face={s.faces[i]} paint={s.paint} prefix={prefix} x={0} width={u.length_mm} mirrored={mirror}
                       y={Y(s.deck.deck_height_mm + u.z_mm + u.height_mm)} />
            ))}
            <StackMarks s={s} cx={s.length / 2} y={Math.max(380, Y(s.top) - 120)} />
          </g>
        ))}
      </g>

      <g className="elev-marks" aria-hidden="true">
        <line x1={frame.x0} x2={frame.x0 + frame.width} y1={Y(limit)} y2={Y(limit)} className="elev-limit" />
        {maxLoadHeight > 0 && (
          <line x1={tallestX - 200} x2={tallestX + (tallest?.length ?? 1200) + 200} y1={Y(maxLoadHeight)} y2={Y(maxLoadHeight)}
                className="elev-tallest" />
        )}
      </g>
      </g>

      <g className="elev-marks" aria-hidden="true">
        <text x={textX(0)} y={Y(limit) - 90} textAnchor={anchor} className="elev-label elev-limit-label">{limitLabel}</text>
        {maxLoadHeight > 0 && (
          <text x={textX(tallestX)} y={tallestLabelY} textAnchor={anchor}
                className="elev-label elev-tallest-label">{tallestLabel}</text>
        )}
      </g>
    </svg>
  );
}

/** A pallet's wooden base, drawn at the bottom of a pallet unit (its height includes the pallet).
 *  The same 144 mm the 3D view uses; for the picture only, the planner doesn't use it. */
export const PALLET_BASE_MM = 144;
/** The DG diamond on a unit's face, mm across; drawn only when the face has room around it. */
const FACE_DIAMOND = 300;
const FACE_INSET = 60;

/**
 * One unit's box: its colour (the type pattern or container ribs over it), the brown pallet base for
 * a pallet, its DG placard diamond in the top corner, and its edge.
 */
function UnitBox({ u, face, paint, prefix, x, y, width, mirrored = false }: {
  u: Placement; face: UnitFace; paint: Paint; prefix: string; x: number; y: number; width: number;
  /** Inside the passenger side's mirror: flip the diamond back so its class number reads forwards. */
  mirrored?: boolean;
}) {
  const box = { x, y, width, height: u.height_mm };
  const base = u.kind === "pallet" ? Math.min(PALLET_BASE_MM, u.height_mm / 2) : 0;
  const room = Math.min(width, u.height_mm - base) >= FACE_DIAMOND + 2 * FACE_INSET;
  return (
    <g>
      <rect {...box} fill={face.fill} className="elev-unit" />
      {paint.pattern && <rect {...box} fill={`url(#${prefix}-${paint.pattern})`} className="elev-unit-overlay" />}
      {u.kind === "container" && <rect {...box} fill={`url(#${prefix}-corrugation)`} className="elev-unit-overlay" />}
      {base > 0 && <rect x={x} y={y + u.height_mm - base} width={width} height={base} className="elev-pallet" />}
      <rect {...box} className="elev-unit-edge" />
      {face.dg && room && (() => {
        const cx = x + FACE_INSET + FACE_DIAMOND / 2;
        return (
          <g transform={mirrored ? `translate(${2 * cx} 0) scale(-1 1)` : undefined}>
            <DgDiamond code={face.dg} cx={cx} cy={y + FACE_INSET + FACE_DIAMOND / 2} size={FACE_DIAMOND} />
          </g>
        );
      })()}
    </g>
  );
}

// ---- Rear view ------------------------------------------------------------------------------

const REAR_MARGIN = 300;
/** Less sky than the side view, which needs room for the cab. */
const REAR_HEADROOM = 450;
const WHEEL_WIDTH = 550;
const WHEEL_HEIGHT = 1000;
/** The rear view is drawn much larger per mm than the side view, so its labels and marks are smaller. */
const REAR_MARK_SCALE = 0.6;

export type RearViewProps = Omit<ElevationViewProps, "frame" | "side">;

/**
 * Looking in through the back doors: each unit drawn across the deck's width (at its y_mm, from the
 * driver's side, which is on the left here as in the other views) and up from its deck. Units
 * further forward sit behind the ones at the back, which are drawn last, on top.
 */
export function RearView({ vehicle, stacks, mode, width, maxLoadHeight, events }: RearViewProps) {
  const units = useUnits();
  const prefix = `rv${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const cargo = vehicle.decks.filter((d) => d.cargo);
  const deckWidth = Math.max(1000, ...cargo.map((d) => d.width_mm));
  // A narrower deck (one of a B-double's) is centred on the widest.
  const offset = (d: { width_mm: number }) => (deckWidth - d.width_mm) / 2;
  const rearDeck = cargo.reduce<(typeof cargo)[number] | undefined>((r, d) => (!r || d.x_mm > r.x_mm ? d : r), undefined);
  const limit = vehicle.overall_height_limit_mm;
  const tallestTop = Math.max(0, ...stacks.map((s) => s.top));
  const sky = Math.max(limit, maxLoadHeight, tallestTop) + REAR_HEADROOM;
  const Y = (mm: number) => sky - mm;
  const height = sky + BELOW_GROUND;
  const x0 = -REAR_MARGIN;
  const viewWidth = deckWidth + 2 * REAR_MARGIN;

  // Front first, so the units nearest the doors sit on top.
  const ordered = [...stacks].sort((a, b) => a.x - b.x);
  const over = stacks.filter((s) => s.overLimit);
  const nearLimit = Math.abs(limit - maxLoadHeight) < 300;

  const summary = `Rear view: tallest point ${units.length(maxLoadHeight)}, height limit ${units.length(limit)}`
    + (over.length ? `, ${over.length} ${over.length === 1 ? "stack" : "stacks"} over the height limit.` : ", all within it.");

  return (
    <svg className="elevation-view rear-view" viewBox={`${x0} 0 ${viewWidth} ${height}`} style={{ width }}
         role="img" aria-label={summary} data-mode={mode}>
      <PatternDefs prefix={prefix} />

      <g className="elev-chrome">
        <line x1={x0} x2={x0 + viewWidth} y1={Y(0)} y2={Y(0)} className="elev-ground" />
        {[0, deckWidth - WHEEL_WIDTH].map((x) => (
          <rect key={x} x={x} y={Y(WHEEL_HEIGHT)} width={WHEEL_WIDTH} height={WHEEL_HEIGHT} rx={80} className="rear-wheel" />
        ))}
        {rearDeck && (
          <rect x={offset(rearDeck)} y={Y(rearDeck.deck_height_mm)} width={rearDeck.width_mm} height={220} className="elev-deck" />
        )}
      </g>

      <g className="elev-stacks">
        {ordered.map((s) => (
          <g key={s.base.unit_id} data-stack={s.key} data-over-limit={s.overLimit || undefined}
             className={stackClass(s, events)} data-conflict={s.conflict?.severity}
             onMouseEnter={(e) => events.onEnter(s.key, e.currentTarget)}
             onMouseLeave={() => events.onLeave(s.key)}
             onClick={(e) => events.onFocus(s.key, e.currentTarget)}>
            <title>{s.description}</title>
            {s.units.map((u, i) => (
              <UnitBox key={u.unit_id} u={u} face={s.faces[i]} paint={s.paint} prefix={prefix} x={offset(s.deck) + u.y_mm} width={u.width_mm}
                       y={Y(s.deck.deck_height_mm + u.z_mm + u.height_mm)} />
            ))}
            <StackMarks s={s} cx={offset(s.deck) + s.y + s.width / 2} y={Math.max(260, Y(s.top) - 80)} scale={REAR_MARK_SCALE} />
          </g>
        ))}
      </g>

      <g className="elev-marks" aria-hidden="true">
        <line x1={x0} x2={x0 + viewWidth} y1={Y(limit)} y2={Y(limit)} className="elev-limit" />
        <text x={0} y={Y(limit) - 60} className="elev-label elev-limit-label">{units.length(limit)} limit</text>
        {maxLoadHeight > 0 && (
          <>
            <line x1={x0} x2={x0 + viewWidth} y1={Y(maxLoadHeight)} y2={Y(maxLoadHeight)} className="elev-tallest" />
            {/* Right-aligned, and under its line when it would crowd the limit label. */}
            <text x={deckWidth} y={nearLimit ? Y(maxLoadHeight) + 180 : Y(maxLoadHeight) - 60} textAnchor="end"
                  className="elev-label elev-tallest-label">Tallest {units.length(maxLoadHeight)}</text>
          </>
        )}
      </g>
    </svg>
  );
}
