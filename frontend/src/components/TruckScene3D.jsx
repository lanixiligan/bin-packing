// 3D view of one method's trucks. Each truck is a trailer with a cab, and each
// shipment is a crate whose LENGTH is proportional to its weight, so a crate
// row that reaches the back door means a full truck (the problem is still 1D:
// only weight counts, the crate shape is just a picture of it).
//
// With a multi-dimension capacity ({ weight_kg, volume_m3, pallets }, see
// Truck.jsx) each crate's length is its share of the truck's binding
// dimension (shipmentFractions in capacity.ts), and the labels show the fill
// of every limited dimension.
//
// Loaded lazily from ResultPanel so three.js is only downloaded when the user
// switches to 3D.
import { useLayoutEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Vector3 } from "three";
import { Edges, OrbitControls } from "@react-three/drei";
import { colorFor, describeSize, describeUsage, dgTextOf, limitedDims, shipmentFractions, sizeOf, truckFill } from "./capacity.ts";
import { DARK_SCHEME, REDUCED_MOTION, useMediaQuery } from "../useMediaQuery.js";

// Scene units (roughly metres, scaled down).
const L = 4; // trailer length = 100% of capacity
const W = 1.5; // trailer width
const H = 1.3; // trailer height
const FLOOR = 0.62; // trailer floor height above the ground
const CAB = 1.1; // cab length
const GAP = 0.03; // space between crates
const LABEL_ROOM = 2.2; // empty ground in front of the cab, where the label goes
const COL_SPACING = L + CAB + LABEL_ROOM + 1;
const ROW_SPACING = W + 1.3;
// Shift trucks right so truck + cab + label is centred on its grid slot.
const X_SHIFT = (CAB + LABEL_ROOM) / 2;
// Label anchor (right edge of the label), just in front of the cab.
const LABEL_X = -L / 2 - CAB - 0.3;
const LABEL_Y = FLOOR + 0.45;
const DROP_HEIGHT = 2.6;
const DROP_SECONDS = 0.35;

const PALETTE = {
  light: { ground: "#eceef3", frame: "#8a94a8", floor: "#c9cfdb", cab: "#5b6b8c", wheel: "#2a2f3a", active: "#1d2433", warn: "#b35c00" },
  dark: { ground: "#1f2636", frame: "#6b7690", floor: "#2b3346", cab: "#7a8fbd", wheel: "#0b0e14", active: "#ffffff", warn: "#f0b45a" },
};

/** Columns and rows of the parking grid: lanes front-to-back, up to 3 columns. */
function grid(n) {
  const cols = Math.min(3, Math.ceil(n / 4));
  return { cols, rows: Math.ceil(n / cols) };
}

/** Grid position of truck `i` of `n`. */
function slot(i, n) {
  const { cols, rows } = grid(n);
  const col = Math.floor(i / rows);
  const row = i % rows;
  return [(col - (cols - 1) / 2) * COL_SPACING + X_SHIFT, 0, (row - (rows - 1) / 2) * ROW_SPACING];
}

function Crate({ shipment, x, length, colors, activeId, onHover, animate }) {
  const ref = useRef();
  const start = useRef(null);
  const restY = FLOOR + (H - 0.1) / 2;

  useFrame((state) => {
    if (!ref.current) return;
    if (!animate) {
      ref.current.position.y = restY;
      return;
    }
    if (start.current == null) start.current = state.clock.elapsedTime;
    const t = Math.min(1, (state.clock.elapsedTime - start.current) / DROP_SECONDS);
    const fall = 1 - t * t; // accelerate like gravity
    ref.current.position.y = restY + DROP_HEIGHT * fall;
    if (t < 1) state.invalidate();
  });

  const active = shipment.id === activeId;
  const dim = activeId != null && !active;

  return (
    <mesh
      ref={ref}
      position={[x, animate ? restY + DROP_HEIGHT : restY, 0]}
      castShadow={!dim}
      onPointerOver={(e) => {
        e.stopPropagation();
        onHover(shipment.id);
      }}
      onPointerOut={(e) => {
        e.stopPropagation();
        onHover(null);
      }}
    >
      <boxGeometry args={[Math.max(0.02, length - GAP), H - 0.1, W - 0.14]} />
      <meshStandardMaterial
        color={colorFor(shipment.colorKey ?? shipment.id)}
        roughness={0.75}
        // always transparent: three.js doesn't recompile when this flag flips
        transparent
        depthWrite={!dim}
        opacity={dim ? 0.25 : 1}
        emissive={active ? colorFor(shipment.colorKey ?? shipment.id) : "#000000"}
        emissiveIntensity={active ? 0.35 : 0}
      />
      <Edges color={active ? colors.active : "#000000"} transparent opacity={active ? 1 : dim ? 0.08 : 0.25} />
    </mesh>
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
const truckName = (t) => t.label ?? `Truck ${t.truck}`;

/** Fill and state of a truck at this point of the drop animation. */
function truckStatus(truck, capacity, step, dropIndex, activeId) {
  const cap = truck.capacity ?? capacity;
  if (isMulti(cap)) {
    const f = truckFill(truck, cap, step, dropIndex);
    const dims = limitedDims(cap)
      .map((d) => `${d.short} ${Math.floor(100 * (f.usage[d.field] / cap[d.field]) + 1e-9)}%`)
      .join(" · ");
    return {
      fill: f.fill,
      done: f.done,
      holdsActive: activeId != null && truck.shipments.some((s) => s.id === activeId),
      sub: !f.done ? "loading…" : f.over ? `⚠ over capacity · ${dims}` : dims,
      over: f.over,
    };
  }
  const visible = truck.shipments.filter((s) => dropIndex[s.id] < step);
  const load = visible.reduce((sum, s) => sum + s.weight, 0);
  return {
    fill: Math.floor((100 * load) / capacity), // floor: 100% only when completely full
    done: visible.length === truck.shipments.length,
    holdsActive: activeId != null && truck.shipments.some((s) => s.id === activeId),
    sub: visible.length === truck.shipments.length ? `${truck.empty} kg free` : "loading…",
    over: false,
  };
}

function TruckModel({ truck, position, capacity, step, dropIndex, colors, activeId, onHover, extra, animate }) {
  const { holdsActive, over } = truckStatus(truck, capacity, step, dropIndex, activeId);
  const frameColor = holdsActive ? colors.active : extra || over ? colors.warn : colors.frame;
  const sizes = shipmentFractions(truck.shipments, truck.capacity ?? capacity);

  // Crates are loaded from the cab end towards the back door, in list order.
  let offset = -L / 2;
  const crates = truck.shipments.map((s) => {
    const length = Math.min(sizes.get(s.id), 1) * L;
    const x = offset + length / 2;
    offset += length;
    return { s, x, length };
  });

  return (
    <group position={position}>
      {/* trailer floor and see-through box */}
      <mesh position={[0, FLOOR - 0.04, 0]} receiveShadow castShadow>
        <boxGeometry args={[L, 0.08, W]} />
        <meshStandardMaterial color={colors.floor} roughness={0.9} />
      </mesh>
      <mesh position={[0, FLOOR + H / 2, 0]}>
        <boxGeometry args={[L, H, W]} />
        <meshStandardMaterial color={colors.frame} transparent opacity={0.07} depthWrite={false} />
        <Edges color={frameColor} />
      </mesh>

      {/* cab */}
      <mesh position={[-L / 2 - CAB / 2 - 0.08, FLOOR + 0.45, 0]} castShadow>
        <boxGeometry args={[CAB, 0.9, W - 0.1]} />
        <meshStandardMaterial color={colors.cab} roughness={0.6} />
      </mesh>
      <mesh position={[-L / 2 - CAB - 0.085, FLOOR + 0.6, 0]}>
        <boxGeometry args={[0.02, 0.35, W - 0.3]} />
        <meshStandardMaterial color="#9fc3e8" roughness={0.2} metalness={0.3} />
      </mesh>

      {[-L / 2 - CAB / 2, -L / 2 + 0.7, L / 2 - 0.9, L / 2 - 0.3].map((x) => (
        <group key={x}>
          <Wheel x={x} z={W / 2 - 0.12} colors={colors} />
          <Wheel x={x} z={-W / 2 + 0.12} colors={colors} />
        </group>
      ))}

      {crates.map(({ s, x, length }) =>
        dropIndex[s.id] < step ? (
          <Crate
            key={s.id}
            shipment={s}
            x={x}
            length={length}
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
function CameraRig({ n }) {
  const camera = useThree((s) => s.camera);
  const { width, height } = useThree((s) => s.size);
  const controls = useThree((s) => s.controls);

  useLayoutEffect(() => {
    const { cols, rows } = grid(n);
    // half-extents of the grid, including cabs and labels
    const hx = (cols * COL_SPACING) / 2;
    const hz = (rows * ROW_SPACING) / 2;
    const radius = Math.hypot(hx, hz, H);
    const aspect = width / height;
    const vFov = (camera.fov * Math.PI) / 180;
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);
    // The grid is seen at a slant, so it looks smaller than its bounding
    // sphere: 0.8 trims the empty margin that a pure sphere fit leaves.
    const dist = (0.8 * radius) / Math.sin(Math.min(vFov, hFov) / 2);
    const len = Math.hypot(...VIEW_DIR);
    camera.position.set(...VIEW_DIR.map((v) => (v / len) * dist));
    camera.lookAt(0, FLOOR, 0);
    camera.updateProjectionMatrix();
    if (controls) {
      controls.target.set(0, FLOOR, 0);
      controls.update();
    }
  }, [camera, controls, width, height, n]);

  return null;
}

/**
 * Keeps the HTML truck labels (drawn over the canvas) pinned to their trucks:
 * projects each anchor point to screen pixels on every rendered frame.
 */
function LabelTracker({ positions, labels }) {
  const v = useMemo(() => new Vector3(), []);
  useFrame(({ camera, size }) => {
    positions.forEach((p, i) => {
      const el = labels.current[i];
      if (!el) return;
      v.set(p[0] + LABEL_X, LABEL_Y, p[2]).project(camera);
      const x = ((v.x + 1) / 2) * size.width;
      const y = ((1 - v.y) / 2) * size.height;
      el.style.transform = `translate(${x}px, ${y}px) translate(-100%, -50%)`;
      el.style.visibility = "visible";
    });
  });
  return null;
}

export default function TruckScene3D({
  data, capacity, step, dropIndex, activeId, onHover, onFocusBlock, extraFrom, height,
}) {
  const dark = useMediaQuery(DARK_SCHEME);
  const reducedMotion = useMediaQuery(REDUCED_MOTION);
  const colors = dark ? PALETTE.dark : PALETTE.light;
  const labels = useRef([]);
  const n = data.trucks.length;
  const positions = useMemo(() => data.trucks.map((_, i) => slot(i, n)), [data.trucks, n]);
  const extent = useMemo(() => {
    const xs = positions.map((p) => p[0]);
    const zs = positions.map((p) => p[2]);
    return {
      w: Math.max(...xs) - Math.min(...xs) + COL_SPACING + 4,
      d: Math.max(...zs) - Math.min(...zs) + ROW_SPACING + 4,
    };
  }, [positions]);

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
            extra={extraFrom != null && t.truck > extraFrom}
            animate={!reducedMotion}
          />
        ))}
        <CameraRig n={n} />
        <LabelTracker positions={positions} labels={labels} />

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
          const extra = extraFrom != null && t.truck > extraFrom;
          return (
            <div
              key={t.truck}
              ref={(el) => (labels.current[i] = el)}
              className={`truck3d-label${holdsActive ? " active" : ""}${extra || over ? " extra" : ""}`}
            >
              <span className="truck3d-title"><b>{truckName(t)}</b> · {fill}%</span>
              <span className="truck3d-sub">{sub}</span>
              {extra && <span className="truck3d-extra">beyond optimum</span>}
            </div>
          );
        })}
      </div>

      <p className="scene3d-hint muted small" aria-hidden="true">Drag to rotate</p>

      {/* The canvas can't be reached by keyboard or screen reader, so the same
          content is listed here. Tabbing through it highlights each crate. */}
      <ul className="sr-only">
        {data.trucks.map((t) => {
          const cap = t.capacity ?? capacity;
          const multi = isMulti(cap);
          const full = multi ? truckFill(t, cap, Infinity, {}) : null;
          return (
            <li key={t.truck}>
              {multi
                ? `${truckName(t)}: ${describeUsage(full.full, cap)}${full.over ? ". Over capacity" : ""}`
                : `Truck ${t.truck}: ${t.load} of ${capacity} kg loaded`}
              <ul>
                {t.shipments.map((s) => (
                  <li
                    key={s.id}
                    tabIndex={0}
                    onFocus={() => onFocusBlock(s.id)}
                    onBlur={() => onFocusBlock(null)}
                  >
                    {`${s.name}${dgTextOf(s) ? `, ${dgTextOf(s)}` : ""}${s.detail ? `, ${s.detail}` : ""}, `}
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
