// Top-down deck view, drawn to scale in vehicle millimetres: front (cab) at the left, rear at the
// right, the driver's side along the bottom edge. Every floor stack is drawn exactly where the API
// placed it (deck.x_mm + x_mm, y_mm) and is a focusable button with its full details in aria-label.

import { useId, useRef, type KeyboardEvent } from "react";
import type { AxleGroup, VehicleConfig } from "../api/types.ts";
import { useUnits } from "../lib/units.ts";
import { AxleTicks, PatternDefs } from "./Legend.tsx";
import type { ColorMode, Frame, PlanStack, StackEvents } from "./LoadPlanView.tsx";
import "./DeckView.css";

export interface DeckViewProps {
  vehicle: VehicleConfig;
  stacks: PlanStack[];
  frame: Frame;
  mode: ColorMode;
  /** CSS width of the SVG (zoom); the height follows the aspect ratio. */
  width: string;
  /** Id of the placement table, the long description. */
  describedBy: string;
  events: StackEvents;
  /** Id of the details popover while it is open. */
  detailsId?: string;
}

// Layout bands, top to bottom, in mm.
const TOP_ROW = 620;
const NAME_ROW = 420;
const AXLE_GAP = 160;
const AXLE_BAND = 820;
const SCALE_BAND = 520;
const MIN_BAND = 2480;
const CAB_WIDTH = 2450;

// Unit labels, in mm. Text is sized in drawing units, so zooming in enlarges it.
const FONT = 210;
const BADGE_FONT = 170;
const CHAR_WIDTH = 0.53; // average glyph width / font size (Inter)
const PAD = 70;
const LINE = 270;
const BADGE_H = 290;
/** DG placard diamond: its diagonal, a little taller than the badge row it sits in. */
const DIAMOND = 360;
/** Conflict warning triangle width. */
const WARN_W = 250;

type Direction = "left" | "right" | "up" | "down";
const KEY_DIRECTIONS: Record<string, Direction> = {
  ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down",
};

/** Text cut to fit `widthMm`, or null when not even three characters fit. */
function fitText(text: string, widthMm: number, font = FONT): string | null {
  const max = Math.floor(widthMm / (font * CHAR_WIDTH));
  if (max < 3) return null;
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

function badgeWidth(text: string): number {
  return Math.max(BADGE_H, text.length * BADGE_FONT * 0.62 + 140);
}

/** "Steer", "Drive", "Dolly", else the group kind ("Tri", "Tandem"). Full name goes in <title>. */
function axleLabel(a: AxleGroup): string {
  if (a.kind === "steer") return "Steer";
  const first = a.name.split(/\s+/)[0];
  if (/^(drive|dolly)$/i.test(first)) return first[0].toUpperCase() + first.slice(1).toLowerCase();
  return a.kind[0].toUpperCase() + a.kind.slice(1);
}

function arrowPath(tipX: number, y: number, dir: 1 | -1): string {
  // A left-pointing arrow (dir 1) or right-pointing (dir -1), 800 mm long, tip at tipX.
  const p = (dx: number, dy: number) => `${tipX + dir * dx} ${y + dy}`;
  return `M ${p(0, 0)} L ${p(240, -130)} L ${p(240, -45)} L ${p(800, -45)} L ${p(800, 45)} L ${p(240, 45)} L ${p(240, 130)} Z`;
}

export default function DeckView({ vehicle, stacks, frame, mode, width, describedBy, events, detailsId }: DeckViewProps) {
  const units = useUnits();
  const prefix = `dv${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const nodes = useRef(new Map<string, SVGGElement>());

  const cargo = vehicle.decks.filter((d) => d.cargo);
  const multiDeck = cargo.length > 1;
  const band = Math.max(MIN_BAND, ...cargo.map((d) => d.width_mm));
  const bandTop = TOP_ROW + (multiDeck ? NAME_ROW : 0);
  const bandBottom = bandTop + band;
  const axleY = bandBottom + AXLE_GAP;
  const scaleY = axleY + AXLE_BAND;
  const height = scaleY + SCALE_BAND;
  const deckTop = (deckWidth: number) => bandTop + (band - deckWidth) / 2;
  const end = frame.vehicleLength;

  // Screen position of each stack: y_mm runs from the driver's side, which is drawn at the bottom.
  const placed = stacks.map((s) => ({
    stack: s,
    x: s.x,
    y: deckTop(s.deck.width_mm) + s.deck.width_mm - s.y - s.width,
  }));
  const byKey = new Map(placed.map((p) => [p.stack.key, p]));

  const neighbour = (key: string, dir: Direction): string | undefined => {
    const from = byKey.get(key);
    if (!from) return undefined;
    const cx = from.x + from.stack.length / 2;
    const cy = from.y + from.stack.width / 2;
    let best: { key: string; score: number } | undefined;
    for (const p of placed) {
      if (p.stack.key === key) continue;
      const dx = p.x + p.stack.length / 2 - cx;
      const dy = p.y + p.stack.width / 2 - cy;
      const primary = dir === "right" ? dx : dir === "left" ? -dx : dir === "down" ? dy : -dy;
      const secondary = dir === "left" || dir === "right" ? Math.abs(dy) : Math.abs(dx);
      if (primary <= 1) continue;
      const score = primary + 2 * secondary;
      if (!best || score < best.score) best = { key: p.stack.key, score };
    }
    return best?.key;
  };

  const onKeyDown = (key: string) => (e: KeyboardEvent<SVGGElement>) => {
    let next: string | undefined;
    if (e.key in KEY_DIRECTIONS) next = neighbour(key, KEY_DIRECTIONS[e.key]);
    else if (e.key === "Home") next = placed[0]?.stack.key;
    else if (e.key === "End") next = placed[placed.length - 1]?.stack.key;
    else if (e.key === "Escape") {
      events.onDismiss();
      return;
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      events.onFocus(key, e.currentTarget);
      return;
    } else return;
    e.preventDefault();
    if (next) nodes.current.get(next)?.focus();
  };

  const highlighted = events.highlighted ? byKey.get(events.highlighted) : undefined;
  const deckLengths = cargo.map((d) => units.length(d.length_mm));
  const unitCount = stacks.reduce((n, s) => n + s.units.length, 0);
  const summary = `Top-down plan of the ${vehicle.name}: ${stacks.length} ${stacks.length === 1 ? "stack" : "stacks"}`
    + `${unitCount !== stacks.length ? ` (${unitCount} units)` : ""} on `
    + (multiDeck ? `${cargo.length} decks (${deckLengths.join(" and ")})` : `a ${deckLengths[0] ?? ""} deck`)
    + ". Front at the left.";

  return (
    <svg className="deck-view" viewBox={`${frame.x0} 0 ${frame.width} ${height}`} style={{ width }}
         role="group" aria-label={summary} aria-describedby={describedBy} data-mode={mode}>
      <PatternDefs prefix={prefix} />

      <g aria-hidden="true" className="deck-chrome">
        {/* Direction of travel */}
        <path d={arrowPath(0, 330, 1)} className="deck-arrow" />
        <text x={950} y={420} className="deck-direction">FRONT</text>
        <path d={arrowPath(end, 330, -1)} className="deck-arrow" />
        <text x={end - 950} y={420} className="deck-direction" textAnchor="end">REAR</text>

        {/* Prime mover chassis (non-cargo decks), then the cab */}
        {vehicle.decks.filter((d) => !d.cargo).map((d) => {
          const chassisEnd = Math.max(frame.cabLength, d.rear_support.position_mm + 900);
          return (
            <rect key={d.id} x={frame.cabLength - 100} y={bandTop + band / 2 - 500} width={chassisEnd - frame.cabLength + 100}
                  height={1000} rx={120} className="deck-chassis" />
          );
        })}
        <rect x={0} y={bandTop + (band - CAB_WIDTH) / 2} width={frame.cabLength} height={CAB_WIDTH} rx={320}
              className="deck-cab" />
        <line x1={520} x2={520} y1={bandTop + (band - CAB_WIDTH) / 2 + 180} y2={bandTop + (band + CAB_WIDTH) / 2 - 180}
              className="deck-cab-screen" />

        {/* Cargo decks */}
        {cargo.map((d) => (
          <g key={d.id} data-deck={d.id}>
            {multiDeck && <text x={d.x_mm + 40} y={bandTop - 130} className="deck-name">{d.name}</text>}
            <rect x={d.x_mm} y={deckTop(d.width_mm)} width={d.length_mm} height={d.width_mm} className="deck-floor" />
            <line x1={d.x_mm} x2={d.x_mm} y1={deckTop(d.width_mm)} y2={deckTop(d.width_mm) + d.width_mm}
                  className="deck-headboard" />
          </g>
        ))}

        {/* Axle groups */}
        {vehicle.axle_groups.map((a) => (
          <g key={a.id} className="deck-axle">
            <title>{a.name}</title>
            <AxleTicks x={a.position_mm} y={axleY} kind={a.kind} />
            <text x={a.position_mm} y={axleY + 560} textAnchor="middle" className="deck-axle-label">{axleLabel(a)}</text>
          </g>
        ))}

        {/* Scale bar */}
        <g className="deck-scale">
          <path d={`M 0 ${scaleY + 120} v 160 M 0 ${scaleY + 200} H 1000 M 1000 ${scaleY + 120} v 160`} />
          <text x={1120} y={scaleY + 270}>{units.length(1000)}</text>
        </g>
      </g>

      <g className="deck-stacks">
        {placed.map(({ stack: s, x, y }) => (
          <g key={s.base.unit_id}
             ref={(el) => {
               if (el) nodes.current.set(s.key, el);
               else nodes.current.delete(s.key);
             }}
             className={`deck-stack${highlighted && highlighted.stack.key !== s.key ? " is-dimmed" : ""}`
               + `${s.conflict ? ` has-conflict is-conflict-${s.conflict.severity}` : ""}`}
             style={{ transform: `translate(${x}px, ${y}px)` }}
             tabIndex={0} role="button" aria-label={s.description}
             aria-describedby={detailsId && highlighted?.stack.key === s.key ? detailsId : undefined}
             data-stack={s.key} data-over-limit={s.overLimit || undefined}
             data-dg={s.dg.map((d) => d.code).join(" ") || undefined} data-conflict={s.conflict?.severity}
             onMouseEnter={(e) => events.onEnter(s.key, e.currentTarget)}
             onMouseLeave={() => events.onLeave(s.key)}
             onFocus={(e) => events.onFocus(s.key, e.currentTarget)}
             onBlur={() => events.onBlur(s.key)}
             onClick={(e) => events.onFocus(s.key, e.currentTarget)}
             onKeyDown={onKeyDown(s.key)}>
            <StackShape stack={s} mode={mode} prefix={prefix} weightText={units.weight(s.weight)} />
          </g>
        ))}
      </g>

      {highlighted && (
        <g aria-hidden="true" className="deck-highlight"
           style={{ transform: `translate(${highlighted.x}px, ${highlighted.y}px)` }}>
          <rect x={0} y={0} width={highlighted.stack.length} height={highlighted.stack.width} rx={50}
                className="deck-highlight-halo" />
          <rect x={0} y={0} width={highlighted.stack.length} height={highlighted.stack.width} rx={50}
                className="deck-highlight-ring" />
        </g>
      )}
    </svg>
  );
}

function StackShape({ stack: s, mode, prefix, weightText }: {
  stack: PlanStack; mode: ColorMode; prefix: string; weightText: string;
}) {
  const L = s.length;
  const W = s.width;
  const n = s.units.length;
  const inner = L - 2 * PAD;

  // Badge row, left to right: the DG placard diamond, the conflict warning, the colour's meaning
  // (type code); the stack count on the right. DG and conflict marks win when room is short.
  const badges: { text: string; x: number; w: number; dark: boolean }[] = [];
  const codes = [...new Set(s.dg.map((d) => d.code))];
  const diamonds: { code: string; cx: number }[] = [];
  let warnX: number | null = null;
  let x = PAD;
  if (W - 2 * PAD >= BADGE_H) {
    let room = inner;
    for (const code of codes) {
      if (DIAMOND > room) break;
      diamonds.push({ code, cx: x + DIAMOND / 2 });
      x += DIAMOND + 25;
      room -= DIAMOND + 25;
    }
    if (s.conflict && WARN_W <= room) {
      warnX = x + WARN_W / 2;
      x += WARN_W + 30;
      room -= WARN_W + 30;
    }
    if (s.paint.badge && badgeWidth(s.paint.badge) <= room) {
      const w = badgeWidth(s.paint.badge);
      badges.push({ text: s.paint.badge, x, w, dark: false });
      room -= w + 60;
    }
    const count = `×${n}`;
    if (n > 1 && badgeWidth(count) <= room) {
      const w = badgeWidth(count);
      badges.push({ text: count, x: L - PAD - w, w, dark: true });
    }
  }

  const top = PAD + (badges.length || diamonds.length || warnX !== null ? BADGE_H + 40 : 0);
  const avail = W - PAD - top;
  const wanted = mode === "weight" ? [weightText, s.label] : [s.label, weightText];
  const lines = wanted
    .slice(0, Math.max(0, Math.floor(avail / LINE)))
    .map((t) => fitText(t, inner))
    .filter((t): t is string => t !== null);
  const firstBaseline = top + (avail - lines.length * LINE) / 2 + LINE * 0.74;
  const halo = { stroke: s.paint.fill, strokeWidth: 50, strokeLinejoin: "round" as const, paintOrder: "stroke" };

  return (
    <g aria-hidden="true">
      <rect x={14} y={14} width={L - 28} height={W - 28} rx={50} fill={s.paint.fill} className="deck-unit" />
      {s.paint.pattern && (
        <rect x={14} y={14} width={L - 28} height={W - 28} rx={50} fill={`url(#${prefix}-${s.paint.pattern})`} />
      )}
      {s.base.kind === "container" && (
        <rect x={14} y={14} width={L - 28} height={W - 28} rx={50} fill={`url(#${prefix}-corrugation)`} />
      )}
      <rect x={14} y={14} width={L - 28} height={W - 28} rx={50} className="deck-unit-edge" />
      {s.conflict && (
        <rect x={40} y={40} width={L - 80} height={W - 80} rx={40}
              className={`deck-conflict-outline is-${s.conflict.severity}`} />
      )}
      {diamonds.map((d) => <DgDiamond key={d.code} code={d.code} cx={d.cx} cy={PAD + BADGE_H / 2} size={DIAMOND} />)}
      {s.conflict && warnX !== null && (
        <g className={`deck-conflict-icon is-${s.conflict.severity}`}>
          <path d={`M ${warnX} ${PAD + 5} L ${warnX + WARN_W / 2} ${PAD + BADGE_H} L ${warnX - WARN_W / 2} ${PAD + BADGE_H} Z`} />
          <text x={warnX} y={PAD + BADGE_H - 35} textAnchor="middle" fontSize={180}>!</text>
        </g>
      )}
      {badges.map((b) => (
        <g key={b.text} className={b.dark ? "deck-badge deck-badge-dark" : "deck-badge"}>
          <rect x={b.x} y={PAD} width={b.w} height={BADGE_H} rx={BADGE_H / 2} />
          <text x={b.x + b.w / 2} y={PAD + BADGE_H * 0.7} textAnchor="middle" fontSize={BADGE_FONT}>{b.text}</text>
        </g>
      ))}
      {lines.map((t, i) => (
        <text key={i} x={L / 2} y={firstBaseline + i * LINE} textAnchor="middle" fontSize={FONT}
              className={i === 0 ? "deck-unit-label deck-unit-label-main" : "deck-unit-label"}
              fill={s.paint.text} style={halo}>{t}</text>
      ))}
    </g>
  );
}

/** A placard-style diamond with the DG code ("3", "5.1", "1.4S", "F"), centred on (cx, cy), in mm. */
export function DgDiamond({ code, cx, cy, size }: { code: string; cx: number; cy: number; size: number }) {
  const r = size / 2;
  const font = size * (code.length <= 2 ? 0.4 : code.length === 3 ? 0.33 : 0.27);
  return (
    <g className="dg-diamond">
      <path d={`M ${cx} ${cy - r} L ${cx + r} ${cy} L ${cx} ${cy + r} L ${cx - r} ${cy} Z`} className="dg-diamond-outer" />
      <path d={`M ${cx} ${cy - r * 0.8} L ${cx + r * 0.8} ${cy} L ${cx} ${cy + r * 0.8} L ${cx - r * 0.8} ${cy} Z`}
            className="dg-diamond-inner" />
      <text x={cx} y={cy + font * 0.36} textAnchor="middle" fontSize={font}>{code}</text>
    </g>
  );
}
