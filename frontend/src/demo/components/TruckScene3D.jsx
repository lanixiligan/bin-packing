// 3D view of one method's trucks. Each truck is a trailer with a cab. With
// weight only, each shipment is a crate whose LENGTH is proportional to its
// weight, so a crate row that reaches the back door means a full truck (only
// weight counts, the crate shape is just a picture of it).
//
// Trucks with a pallet limit, or carrying shipments on pallets, are drawn at
// real proportions instead (deck.ts): the trailer is as long as its pallet deck
// (1165 mm pallets, two across a 2.4 m deck), each pallet is a wooden base with
// its load on top, empty slots are outlined on the floor, and pallets over the
// limit hang past the rear doors.
//
// Loaded lazily from ResultPanel so three.js is only downloaded when the user
// switches to 3D.
import { useLayoutEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Vector3 } from "three";
import { Edges, OrbitControls } from "@react-three/drei";
import { colorFor, describeSize, describeUsage, dgTextOf, limitedDims, sizeOf, truckFill } from "./capacity.ts";
import { describeDeck, layoutPallets, LOAD_MM, PALLET_MM, ROW_GAP_MM, truckDeck, usesDeck } from "./deck.ts";
import { REDUCED_MOTION, useDarkTheme, useMediaQuery } from "../useMediaQuery.js";

// Scene units (roughly metres, scaled down).
const L = 4; // trailer length = 100% of capacity (crate mode)
const W = 1.5; // trailer width
const H = 1.3; // trailer height
const FLOOR = 0.62; // trailer floor height above the ground
const CAB = 1.1; // cab length
const GAP = 0.03; // space between crates
const LABEL_ROOM = 2.2; // empty ground in front of the cab, where the label goes
const ROW_SPACING = W + 1.3;
// Shift trucks right so truck + cab + label is centred on its grid slot.
const X_SHIFT = (CAB + LABEL_ROOM) / 2;
// Deck mode: scene units per metre, so the 2.4 m deck is the trailer width W.
const S = W / 2.4;
const mm = (n) => (n / 1000) * S;
const PALLET_BASE = mm(144); // height of a pallet's wooden base
const SLOT_GAP = 0.02;
/** Grid column spacing for trailers up to `len` long (plus cab and label). */
const colSpacing = (len) => len + CAB + LABEL_ROOM + 1;
/** Label anchor (right edge of the label), just in front of the cab. */
const labelX = (len) => -len / 2 - CAB - 0.3;
const LABEL_Y = FLOOR + 0.45;
const DROP_HEIGHT = 2.6;
const DROP_SECONDS = 0.35;

// Slate neutrals and the teal accent of the planner's tokens (src/planner/styles/tokens.css).
const PALETTE = {
  light: { ground: "#e2e8f0", frame: "#94a3b8", floor: "#cbd5e1", cab: "#0f766e", wheel: "#1e293b", active: "#0f172a", warn: "#b45309", pallet: "#b08a5a" },
  dark: { ground: "#1e293b", frame: "#64748b", floor: "#334155", cab: "#0d9488", wheel: "#020617", active: "#ffffff", warn: "#fbbf24", pallet: "#8a6a42" },
};

/** Columns and rows of the parking grid: lanes front-to-back, up to 3 columns. */
function grid(n) {
  const cols = Math.min(3, Math.ceil(n / 4));
  return { cols, rows: Math.ceil(n / cols) };
}

/** Grid position of truck `i` of `n`, columns `spacing` apart. */
function slot(i, n, spacing) {
  const { cols, rows } = grid(n);
  const col = Math.floor(i / rows);
  const row = i % rows;
  return [(col - (cols - 1) / 2) * spacing + X_SHIFT, 0, (row - (rows - 1) / 2) * ROW_SPACING];
}

/** Deck mode for a truck: its deck and pallet layout, or null for the crate view. */
function deckOf(truck, capacity) {
  if (!usesDeck(truck.shipments, capacity)) return null;
  const deck = truckDeck(truck.shipments, capacity);
  const layout = layoutPallets(truck.shipments, deck);
  return { deck, layout, len: mm(deck.lengthMm), over: layout.pieces.some((p) => p.over) };
}

/**
 * A crate (crate mode) or a pallet with its load (deck mode, `base` > 0),
 * centred at (x, z) on the trailer floor. `size` is the load box [x, y, z].
 */
function Crate({ shipment, x, z = 0, size, base = 0, over = false, colors, activeId, onHover, animate }) {
  const ref = useRef();
  const start = useRef(null);

  useFrame((state) => {
    if (!ref.current) return;
    if (!animate) {
      ref.current.position.y = 0;
      return;
    }
    if (start.current == null) start.current = state.clock.elapsedTime;
    const t = Math.min(1, (state.clock.elapsedTime - start.current) / DROP_SECONDS);
    const fall = 1 - t * t; // accelerate like gravity
    ref.current.position.y = DROP_HEIGHT * fall;
    if (t < 1) state.invalidate();
  });

  const active = shipment.id === activeId;
  const dim = activeId != null && !active;
  const [lx, ly, lz] = size;

  return (
    <group
      ref={ref}
      position={[x, animate ? DROP_HEIGHT : 0, z]}
      onPointerOver={(e) => {
        e.stopPropagation();
        onHover(shipment.id);
      }}
      onPointerOut={(e) => {
        e.stopPropagation();
        onHover(null);
      }}
    >
      {base > 0 && (
        <mesh position={[0, FLOOR + base / 2, 0]} castShadow={!dim}>
          <boxGeometry args={[lx, base, lz]} />
          <meshStandardMaterial color={colors.pallet} roughness={0.95} transparent depthWrite={!dim} opacity={dim ? 0.25 : 1} />
        </mesh>
      )}
      <mesh position={[0, FLOOR + base + ly / 2, 0]} castShadow={!dim}>
        <boxGeometry args={[lx, ly, lz]} />
        <meshStandardMaterial
          color={colorFor(shipment.id)}
          roughness={0.75}
          // always transparent: three.js doesn't recompile when this flag flips
          transparent
          depthWrite={!dim}
          opacity={dim ? 0.25 : 1}
          emissive={active ? colorFor(shipment.id) : "#000000"}
          emissiveIntensity={active ? 0.35 : 0}
        />
        <Edges
          color={active ? colors.active : over ? colors.warn : "#000000"}
          transparent
          opacity={active || over ? 1 : dim ? 0.08 : 0.25}
        />
      </mesh>
    </group>
  );
}

function Wheel({ x, z, colors }) {
  return (
    <mesh position={[x, 0.3, z]} rotation={[Math.PI / 2, 0, 0]} castShadow>
      <cylinderGeometry args={[0.3, 0.3, 0.22, 20]} />
      <meshStandardMaterial color={colors.wheel} roughness={0.9} />
    </mesh>
  );
}

const isMulti = (cap) => typeof cap === "object" && cap !== null;
const truckName = (t) => `Truck ${t.truck}`;

/** Fill and state of a truck at this point of the drop animation. */
function truckStatus(truck, capacity, step, dropIndex, activeId) {
  const cap = capacity;
  const d = deckOf(truck, capacity);
  const loose = d && d.layout.loose.length ? ` · +${d.layout.loose.length} loose` : "";
  if (isMulti(cap)) {
    const f = truckFill(truck, cap, step, dropIndex);
    const over = f.over || Boolean(d?.over);
    const dims = limitedDims(cap)
      .map((x) => `${x.short} ${Math.floor(100 * (f.usage[x.field] / cap[x.field]) + 1e-9)}%`)
      .join(" · ");
    return {
      fill: f.fill,
      done: f.done,
      holdsActive: activeId != null && truck.shipments.some((s) => s.id === activeId),
      sub: !f.done ? "loading…" : `${over ? "⚠ over capacity · " : ""}${dims}${loose}`,
      over,
    };
  }
  const visible = truck.shipments.filter((s) => dropIndex[s.id] < step);
  const load = visible.reduce((sum, s) => sum + s.weight, 0);
  const done = visible.length === truck.shipments.length;
  return {
    fill: Math.floor((100 * load) / capacity), // floor: 100% only when completely full
    done,
    holdsActive: activeId != null && truck.shipments.some((s) => s.id === activeId),
    sub: done ? `${truck.empty} kg free${loose}` : "loading…",
    over: Boolean(d?.over),
  };
}

/** Crate mode (`capacity` in kg): crates loaded from the cab end towards the back door, in list order. */
function crateLayout(truck, capacity) {
  let offset = -L / 2;
  return truck.shipments.map((s) => {
    const length = Math.min(s.weight / capacity, 1) * L;
    const x = offset + length / 2;
    offset += length;
    return { key: s.id, s, x, z: 0, size: [Math.max(0.02, length - GAP), H - 0.1, W - 0.14], base: 0, over: false };
  });
}

/** Deck mode: one pallet (or part of one) per layout piece, at real size. */
function palletLayout(truck, { deck, layout }, len) {
  const front = -len / 2;
  const margin = (deck.widthMm - deck.across * PALLET_MM) / (deck.across + 1);
  const byId = new Map(truck.shipments.map((s) => [s.id, s]));
  return layout.pieces.map((p) => {
    const s = byId.get(p.id);
    const startMm = ROW_GAP_MM + p.row * (PALLET_MM + ROW_GAP_MM) + p.from * PALLET_MM;
    const lengthMm = (p.to - p.from) * PALLET_MM;
    const zMm = margin + p.col * (PALLET_MM + margin) + PALLET_MM / 2;
    const loadH = Math.min(H - PALLET_BASE - 0.04, mm(LOAD_MM));
    return {
      key: `${p.id}-${p.slot}-${p.from}`,
      s,
      x: front + mm(startMm + lengthMm / 2),
      z: -W / 2 + mm(zMm),
      size: [Math.max(0.02, mm(lengthMm) - SLOT_GAP), loadH, mm(PALLET_MM) - SLOT_GAP],
      base: PALLET_BASE,
      over: p.over,
    };
  });
}

/** Faint outlines of the deck's pallet slots on the trailer floor. */
function SlotOutlines({ deck, len, colors }) {
  const margin = (deck.widthMm - deck.across * PALLET_MM) / (deck.across + 1);
  return Array.from({ length: deck.slots }, (_, i) => {
    const row = Math.floor(i / deck.across);
    const col = i % deck.across;
    const x = -len / 2 + mm(ROW_GAP_MM + row * (PALLET_MM + ROW_GAP_MM) + PALLET_MM / 2);
    const z = -W / 2 + mm(margin + col * (PALLET_MM + margin) + PALLET_MM / 2);
    return (
      <mesh key={i} position={[x, FLOOR + 0.003, z]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[mm(PALLET_MM) - SLOT_GAP, mm(PALLET_MM) - SLOT_GAP]} />
        <meshBasicMaterial color={colors.frame} transparent opacity={0.18} depthWrite={false} />
        <Edges color={colors.frame} transparent opacity={0.6} />
      </mesh>
    );
  });
}

function TruckModel({ truck, position, capacity, step, dropIndex, colors, activeId, onHover, animate, maxLen }) {
  const { holdsActive, over } = truckStatus(truck, capacity, step, dropIndex, activeId);
  const frameColor = holdsActive ? colors.active : over ? colors.warn : colors.frame;
  const d = deckOf(truck, capacity);
  const len = d ? d.len : L;
  const crates = d ? palletLayout(truck, d, len) : crateLayout(truck, capacity);

  // Every cab sits at the same x (-maxLen / 2), so labels line up; trailers
  // of different lengths reach back by their own length.
  return (
    <group position={[position[0] + (len - maxLen) / 2, position[1], position[2]]}>
      {/* trailer floor and see-through box */}
      <mesh position={[0, FLOOR - 0.04, 0]} receiveShadow castShadow>
        <boxGeometry args={[len, 0.08, W]} />
        <meshStandardMaterial color={colors.floor} roughness={0.9} />
      </mesh>
      <mesh position={[0, FLOOR + H / 2, 0]}>
        <boxGeometry args={[len, H, W]} />
        <meshStandardMaterial color={colors.frame} transparent opacity={0.07} depthWrite={false} />
        <Edges color={frameColor} />
      </mesh>

      {/* cab */}
      <mesh position={[-len / 2 - CAB / 2 - 0.08, FLOOR + 0.45, 0]} castShadow>
        <boxGeometry args={[CAB, 0.9, W - 0.1]} />
        <meshStandardMaterial color={colors.cab} roughness={0.6} />
      </mesh>
      <mesh position={[-len / 2 - CAB - 0.085, FLOOR + 0.6, 0]}>
        <boxGeometry args={[0.02, 0.35, W - 0.3]} />
        <meshStandardMaterial color="#9fc3e8" roughness={0.2} metalness={0.3} />
      </mesh>

      {[-len / 2 - CAB / 2, -len / 2 + 0.7, len / 2 - 0.9, len / 2 - 0.3].map((x) => (
        <group key={x}>
          <Wheel x={x} z={W / 2 - 0.12} colors={colors} />
          <Wheel x={x} z={-W / 2 + 0.12} colors={colors} />
        </group>
      ))}

      {d && <SlotOutlines deck={d.deck} len={len} colors={colors} />}

      {crates.map(({ key, s, x, z, size, base, over: pieceOver }) =>
        dropIndex[s.id] < step ? (
          <Crate
            key={key}
            shipment={s}
            x={x}
            z={z}
            size={size}
            base={base}
            over={pieceOver}
            colors={colors}
            activeId={activeId}
            onHover={onHover}
            animate={animate}
          />
        ) : null
      )}
    </group>
  );
}

const VIEW_DIR = [0.5, 0.95, 1]; // from the front-right, looking down

/** Frames the whole parking grid whenever the canvas size or truck count changes. */
function CameraRig({ n, spacing }) {
  const camera = useThree((s) => s.camera);
  const { width, height } = useThree((s) => s.size);
  const controls = useThree((s) => s.controls);

  useLayoutEffect(() => {
    const { cols, rows } = grid(n);
    // half-extents of the grid, including cabs and labels
    const hx = (cols * spacing) / 2;
    const hz = (rows * ROW_SPACING) / 2;
    const radius = Math.hypot(hx, hz, H);
    const aspect = width / height;
    const vFov = (camera.fov * Math.PI) / 180;
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);
    // The grid is seen at a slant, so it looks smaller than its bounding
    // sphere: 0.8 trims the empty margin that a pure sphere fit leaves on a wide
    // canvas. A squarer canvas (the narrow results column) needs the full sphere.
    const trim = aspect >= 1.6 ? 0.8 : 1;
    const dist = (trim * radius) / Math.sin(Math.min(vFov, hFov) / 2);
    const len = Math.hypot(...VIEW_DIR);
    camera.position.set(...VIEW_DIR.map((v) => (v / len) * dist));
    camera.lookAt(0, FLOOR, 0);
    camera.updateProjectionMatrix();
    if (controls) {
      controls.target.set(0, FLOOR, 0);
      controls.update();
    }
  }, [camera, controls, width, height, n, spacing]);

  return null;
}

/**
 * Keeps the HTML truck labels (drawn over the canvas) pinned to their trucks:
 * projects each anchor point to screen pixels on every rendered frame.
 */
function LabelTracker({ positions, labels, anchorX }) {
  const v = useMemo(() => new Vector3(), []);
  useFrame(({ camera, size }) => {
    positions.forEach((p, i) => {
      const el = labels.current[i];
      if (!el) return;
      v.set(p[0] + anchorX, LABEL_Y, p[2]).project(camera);
      const x = ((v.x + 1) / 2) * size.width;
      const y = ((1 - v.y) / 2) * size.height;
      el.style.transform = `translate(${x}px, ${y}px) translate(-100%, -50%)`;
      el.style.visibility = "visible";
    });
  });
  return null;
}

export default function TruckScene3D({
  data, capacity, step, dropIndex, activeId, onHover, onFocusBlock, height,
}) {
  const dark = useDarkTheme();
  const reducedMotion = useMediaQuery(REDUCED_MOTION);
  const colors = dark ? PALETTE.dark : PALETTE.light;
  const labels = useRef([]);
  const n = data.trucks.length;
  // The longest trailer sets the grid spacing (pallet decks have real lengths).
  const maxLen = useMemo(
    () => Math.max(L, ...data.trucks.map((t) => deckOf(t, capacity)?.len ?? L)),
    [data.trucks, capacity]
  );
  const spacing = colSpacing(maxLen);
  const positions = useMemo(() => data.trucks.map((_, i) => slot(i, n, spacing)), [data.trucks, n, spacing]);
  const extent = useMemo(() => {
    const xs = positions.map((p) => p[0]);
    const zs = positions.map((p) => p[2]);
    return {
      w: Math.max(...xs) - Math.min(...xs) + spacing + 4,
      d: Math.max(...zs) - Math.min(...zs) + ROW_SPACING + 4,
    };
  }, [positions, spacing]);

  return (
    <div className="scene3d" style={{ height }}>
      <Canvas
        shadows
        frameloop="demand"
        dpr={[1, 2]}
        camera={{ position: [7, 9, 13], fov: 35 }}
        onPointerMissed={() => onHover(null)}
        aria-hidden="true"
      >
        <ambientLight intensity={dark ? 0.9 : 1.1} />
        <directionalLight
          position={[6, 12, 8]}
          intensity={dark ? 1.6 : 2}
          castShadow
          shadow-mapSize={[1024, 1024]}
          shadow-bias={-0.0005}
          shadow-normalBias={0.03}
          shadow-camera-left={-extent.w / 2}
          shadow-camera-right={extent.w / 2}
          shadow-camera-top={extent.d / 2}
          shadow-camera-bottom={-extent.d / 2}
        />
        <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <planeGeometry args={[400, 400]} />
          <meshStandardMaterial color={colors.ground} roughness={1} />
        </mesh>

        {data.trucks.map((t, i) => (
          <TruckModel
            key={t.truck}
            truck={t}
            position={positions[i]}
            capacity={capacity}
            step={step}
            dropIndex={dropIndex}
            colors={colors}
            activeId={activeId}
            onHover={onHover}
            animate={!reducedMotion}
            maxLen={maxLen}
          />
        ))}
        <CameraRig n={n} spacing={spacing} />
        <LabelTracker positions={positions} labels={labels} anchorX={labelX(maxLen)} />

        <OrbitControls
          makeDefault
          enablePan={false}
          enableZoom={false}
          minPolarAngle={0.15}
          maxPolarAngle={Math.PI / 2 - 0.08}
        />
      </Canvas>

      <div className="scene3d-labels" aria-hidden="true">
        {data.trucks.map((t, i) => {
          const { fill, sub, holdsActive, over } = truckStatus(t, capacity, step, dropIndex, activeId);
          return (
            <div
              key={t.truck}
              ref={(el) => (labels.current[i] = el)}
              className={`truck3d-label${holdsActive ? " active" : ""}${over ? " extra" : ""}`}
            >
              <span className="truck3d-title"><b>{truckName(t)}</b> · {fill}%</span>
              <span className="truck3d-sub">{sub}</span>
            </div>
          );
        })}
      </div>

      <p className="scene3d-hint muted small" aria-hidden="true">Drag to rotate</p>

      {/* The canvas can't be reached by keyboard or screen reader, so the same
          content is listed here. Tabbing through it highlights each crate. */}
      <ul className="sr-only">
        {data.trucks.map((t) => {
          const cap = capacity;
          const multi = isMulti(cap);
          const full = multi ? truckFill(t, cap, Infinity, {}) : null;
          const d = deckOf(t, capacity);
          return (
            <li key={t.truck}>
              {multi
                ? `${truckName(t)}: ${describeUsage(full.full, cap)}${full.over || d?.over ? ". Over capacity" : ""}`
                : `Truck ${t.truck}: ${t.load} of ${capacity} kg loaded`}
              {d ? `. ${describeDeck(d.deck)}` : ""}
              <ul>
                {t.shipments.map((s) => (
                  <li
                    key={s.id}
                    tabIndex={0}
                    onFocus={() => onFocusBlock(s.id)}
                    onBlur={() => onFocusBlock(null)}
                  >
                    {`${s.name}${dgTextOf(s) ? `, ${dgTextOf(s)}` : ""}, `}
                    {multi
                      ? `${describeSize(sizeOf(s))}, ${truckName(t).toLowerCase()} of ${data.num_trucks}`
                      : `${s.weight} kg, truck ${t.truck} of ${data.num_trucks}`}
                  </li>
                ))}
              </ul>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
