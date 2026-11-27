// The key for the load plan's colour coding (DG class / weight / type) plus the axle marker.
// Also home of the SVG pattern definitions the drawings share, so a swatch here matches the deck.

import { useId } from "react";
import { HEAT_STEPS, catColor, catTextColor } from "../lib/colors.ts";
import { PATTERN_KINDS, type PatternKind } from "../lib/colors.ts";
import { useUnits } from "../lib/units.ts";
import type { ColorMode, DgClassColour, PlanStack } from "./LoadPlanView.tsx";
import "./Legend.css";

/** Type patterns plus the container corrugation, sized in mm (the drawings' user units). Pattern ids
 *  must be unique in the page, so each SVG passes its own prefix: fill={`url(#${prefix}-${kind})`}. */
export function PatternDefs({ prefix }: { prefix: string }) {
  const ink = { stroke: "var(--color-text-muted)", strokeOpacity: 0.7, strokeWidth: 45 };
  const cell = 220;
  return (
    <defs>
      {PATTERN_KINDS.map((kind) => {
        const id = `${prefix}-${kind}`;
        const common = { id, patternUnits: "userSpaceOnUse" as const, width: cell, height: cell };
        switch (kind) {
          case "hatch":
          case "backhatch":
            return (
              <pattern key={kind} {...common} patternTransform={`rotate(${kind === "hatch" ? 45 : -45})`}>
                <line x1={cell / 2} y1={0} x2={cell / 2} y2={cell} {...ink} />
              </pattern>
            );
          case "cross":
            return (
              <pattern key={kind} {...common} patternTransform="rotate(45)">
                <line x1={cell / 2} y1={0} x2={cell / 2} y2={cell} {...ink} />
                <line x1={0} y1={cell / 2} x2={cell} y2={cell / 2} {...ink} />
              </pattern>
            );
          case "dots":
            return (
              <pattern key={kind} {...common}>
                <circle cx={cell / 2} cy={cell / 2} r={50} fill="var(--color-text-muted)" fillOpacity={0.75} />
              </pattern>
            );
          case "grid":
            return (
              <pattern key={kind} {...common}>
                <path d={`M ${cell / 2} 0 V ${cell} M 0 ${cell / 2} H ${cell}`} fill="none" {...ink} />
              </pattern>
            );
          case "rows":
            return (
              <pattern key={kind} {...common}>
                <line x1={0} y1={cell / 2} x2={cell} y2={cell / 2} {...ink} />
              </pattern>
            );
        }
      })}
      <pattern id={`${prefix}-corrugation`} patternUnits="userSpaceOnUse" width={180} height={180}>
        <line x1={90} y1={0} x2={90} y2={180} stroke="var(--color-text)" strokeOpacity={0.16} strokeWidth={40} />
      </pattern>
    </defs>
  );
}

type AxleKind = "steer" | "single" | "tandem" | "tri" | "quad";
const AXLES: Record<AxleKind, number> = { steer: 1, single: 1, tandem: 2, tri: 3, quad: 4 };
/** Typical spacing between axles in a group; only for drawing the ticks / wheels. */
const AXLE_SPACING_MM = 1300;

/** Vehicle x of each axle in a group centred on `x` (illustrative spacing). */
function axleXs(x: number, kind: AxleKind): number[] {
  const n = AXLES[kind] ?? 1;
  return Array.from({ length: n }, (_, i) => x + (i - (n - 1) / 2) * AXLE_SPACING_MM);
}

/** Top-down marker for an axle group: one wheel tick per axle. Coordinates in mm, centred on `x`. */
export function AxleTicks({ x, y, kind }: { x: number; y: number; kind: AxleKind }) {
  const xs = axleXs(x, kind);
  return (
    <g className="axle-ticks">
      {xs.length > 1 && (
        <line x1={xs[0]} x2={xs[xs.length - 1]} y1={y + 150} y2={y + 150} stroke="var(--color-text-subtle)"
              strokeWidth={40} />
      )}
      {xs.map((wx) => (
        <rect key={wx} x={wx - 70} y={y} width={140} height={300} rx={40} fill="var(--color-text-muted)" />
      ))}
    </g>
  );
}

/** Side-view wheels for an axle group, standing on the ground line `groundY` (mm, y down). */
export function AxleWheels({ x, groundY, kind }: { x: number; groundY: number; kind: AxleKind }) {
  const r = 500;
  return (
    <g className="axle-wheels">
      {axleXs(x, kind).map((wx) => (
        <g key={wx}>
          <circle cx={wx} cy={groundY - r} r={r} fill="var(--color-text-subtle)" />
          <circle cx={wx} cy={groundY - r} r={r * 0.45} fill="var(--color-surface)" />
        </g>
      ))}
    </g>
  );
}

// ---- Legend ---------------------------------------------------------------------------------

export interface LegendProps {
  mode: ColorMode;
  stacks: PlanStack[];
  /** The DG classes in the plan and their colours, for the DG class mode. */
  dgClasses: Map<string, DgClassColour>;
}

export default function Legend({ mode, stacks, dgClasses }: LegendProps) {
  return (
    <div className="legend" aria-label="Legend" role="group">
      <div className="legend-main">
        {mode === "dg" && <DgLegend stacks={stacks} dgClasses={dgClasses} />}
        {mode === "weight" && <WeightLegend stacks={stacks} />}
        {mode === "type" && <TypeLegend stacks={stacks} />}
      </div>
      <div className="legend-axle">
        <svg className="legend-axle-glyph" viewBox="-1600 0 3200 380" aria-hidden="true">
          <AxleTicks x={0} y={40} kind="tri" />
        </svg>
        <span className="subtle">Axle group, one tick per axle</span>
      </div>
    </div>
  );
}

function DgLegend({ stacks, dgClasses }: { stacks: PlanStack[]; dgClasses: Map<string, DgClassColour> }) {
  const general = stacks.some((s) => !s.dg.length);
  const entries = [
    ...[...dgClasses.values()].map((c) => ({ key: c.code, code: c.code, name: c.name, fill: c.fill, text: c.text })),
    ...(general ? [{ key: "general", code: "–", name: "General freight", fill: catColor(null), text: catTextColor(null) }] : []),
  ];
  return (
    <>
      <h3 className="legend-title">Dangerous goods class</h3>
      <ul className="legend-list">
        {entries.map((e) => (
          <li key={e.key} className="legend-item">
            <span className="legend-swatch legend-swatch-cat num" style={{ background: e.fill, color: e.text }}
                  aria-hidden="true">{e.code}</span>
            <strong>{e.name}</strong>
          </li>
        ))}
      </ul>
    </>
  );
}

function WeightLegend({ stacks }: { stacks: PlanStack[] }) {
  const units = useUnits();
  if (!stacks.length) return null;
  const weights = stacks.map((s) => s.weight);
  const [min, max] = [Math.min(...weights), Math.max(...weights)];
  const steps = Array.from({ length: HEAT_STEPS }, (_, i) => i + 1);
  return (
    <>
      <h3 className="legend-title">Stack weight</h3>
      <div className="legend-heat">
        <span className="num small">{units.weight(min)}</span>
        <span className="legend-heat-bar" aria-hidden="true">
          {steps.map((level) => (
            <span key={level} style={{ background: `var(--heat-${level})` }} />
          ))}
        </span>
        <span className="num small">{units.weight(max)}</span>
      </div>
      <p className="subtle legend-note">
        Lightest {units.weight(min)}, heaviest {units.weight(max)}
        {max > min ? "; darker is heavier." : "."} Each stack is labelled with its weight.
      </p>
    </>
  );
}

function TypeLegend({ stacks }: { stacks: PlanStack[] }) {
  const prefix = `lg${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const types = new Map<string, { name: string; code: string; pattern: PatternKind; count: number }>();
  for (const s of stacks) {
    const t = types.get(s.base.type_id);
    if (t) t.count += s.units.length;
    else types.set(s.base.type_id, { name: s.typeName, code: s.typeCode, pattern: s.paint.pattern ?? "hatch", count: s.units.length });
  }
  return (
    <>
      <h3 className="legend-title">Pallet or container type</h3>
      <svg width="0" height="0" className="legend-defs" aria-hidden="true"><PatternDefs prefix={prefix} /></svg>
      <ul className="legend-list">
        {[...types.entries()].map(([id, t]) => (
          <li key={id} className="legend-item">
            <svg className="legend-swatch legend-swatch-type" viewBox="0 0 900 560" aria-hidden="true">
              <rect width={900} height={560} rx={80} fill="var(--color-surface)" stroke="var(--color-border-strong)"
                    strokeWidth={30} />
              <rect width={900} height={560} rx={80} fill={`url(#${prefix}-${t.pattern})`} />
            </svg>
            <span>
              <strong>{t.code}</strong> {t.name} <span className="muted num">× {t.count}</span>
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}
