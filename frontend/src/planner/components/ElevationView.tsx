// Side elevation from the driver's side, front at the left, on the same x scale as the deck view.
// Every placed unit is a rectangle from deck height + z_mm, height_mm tall; stacks that overlap
// across the width overlay with slight transparency (nearest the viewer on top). The dashed line is
// the vehicle's overall height limit; stacks above it are outlined in the error colour.

import { useId } from "react";
import type { VehicleConfig } from "../api/types.ts";
import { useUnits } from "../lib/units.ts";
import { AxleWheels, PatternDefs } from "./Legend.tsx";
import type { ColorMode, Frame, PlanStack, StackEvents } from "./LoadPlanView.tsx";
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
}

const HEADROOM = 650;
const BELOW_GROUND = 250;
const CAB_HEIGHT = 3000;
const LABEL_FONT = 200;
const CHAR_WIDTH = 0.56;

export default function ElevationView({ vehicle, stacks, frame, mode, width, maxLoadHeight, events }: ElevationViewProps) {
  const units = useUnits();
  const prefix = `ev${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const limit = vehicle.overall_height_limit_mm;
  const tallestTop = Math.max(0, ...stacks.map((s) => s.top));
  const sky = Math.max(limit, maxLoadHeight, tallestTop, CAB_HEIGHT) + HEADROOM;
  const Y = (mm: number) => sky - mm; // height above ground -> svg y
  const height = sky + BELOW_GROUND;
  const cab = frame.cabLength;
  const end = frame.vehicleLength;

  // Farthest from the viewer first, so the driver's-side units sit on top.
  const ordered = [...stacks].sort((a, b) => b.y - a.y);
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

  const summary = `Side view from the driver's side: tallest point ${units.length(maxLoadHeight)}, `
    + `height limit ${units.length(limit)}`
    + (over.length ? `, ${over.length} ${over.length === 1 ? "stack" : "stacks"} over the height limit.` : ", all within it.");

  return (
    <svg className="elevation-view" viewBox={`${frame.x0} 0 ${frame.width} ${height}`} style={{ width }}
         role="img" aria-label={summary} data-mode={mode}>
      <PatternDefs prefix={prefix} />

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
        {ordered.map((s) => {
          const dim = events.highlighted && events.highlighted !== s.key;
          return (
            <g key={s.base.unit_id} data-stack={s.key} data-over-limit={s.overLimit || undefined}
               className={`elev-stack${s.overLimit ? " is-over" : ""}${dim ? " is-dimmed" : ""}${events.highlighted === s.key ? " is-highlighted" : ""}`}
               style={{ transform: `translate(${s.x}px, 0px)` }}
               onMouseEnter={(e) => events.onEnter(s.key, e.currentTarget)}
               onMouseLeave={() => events.onLeave(s.key)}
               onClick={(e) => events.onFocus(s.key, e.currentTarget)}>
              <title>{s.description}</title>
              {s.units.map((u) => {
                const bottom = s.deck.deck_height_mm + u.z_mm;
                const box = { x: 0, y: Y(bottom + u.height_mm), width: u.length_mm, height: u.height_mm };
                return (
                  <g key={u.unit_id}>
                    <rect {...box} fill={s.paint.fill} className="elev-unit" />
                    {s.paint.pattern && <rect {...box} fill={`url(#${prefix}-${s.paint.pattern})`} className="elev-unit-overlay" />}
                    {u.kind === "container" && <rect {...box} fill={`url(#${prefix}-corrugation)`} className="elev-unit-overlay" />}
                    <rect {...box} className="elev-unit-edge" />
                  </g>
                );
              })}
              {s.overLimit && (
                <g className="elev-warning" transform={`translate(${s.length / 2} ${Math.max(380, Y(s.top) - 120)})`}>
                  <title>Over the height limit</title>
                  <path d="M 0 -340 L 200 0 L -200 0 Z" />
                  <text x={0} y={-50} textAnchor="middle">!</text>
                </g>
              )}
            </g>
          );
        })}
      </g>

      <g className="elev-marks" aria-hidden="true">
        <line x1={frame.x0} x2={frame.x0 + frame.width} y1={Y(limit)} y2={Y(limit)} className="elev-limit" />
        <text x={0} y={Y(limit) - 90} className="elev-label elev-limit-label">{limitLabel}</text>
        {maxLoadHeight > 0 && (
          <>
            <line x1={tallestX - 200} x2={tallestX + (tallest?.length ?? 1200) + 200} y1={Y(maxLoadHeight)} y2={Y(maxLoadHeight)}
                  className="elev-tallest" />
            <text x={tallestX} y={tallestLabelY}
                  className="elev-label elev-tallest-label">{tallestLabel}</text>
          </>
        )}
      </g>
    </svg>
  );
}
