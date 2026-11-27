// 3D view of the trucks (copied from the bin packing demo, fed by lib/sceneData.ts), built from the
// planner's placements exactly as returned: each truck is the chosen vehicle, its cargo decks laid
// end to end behind the cab at their real length and width (a B-double has two), and every unit is
// a box at its placement (x along the deck from the cab end, y across from the driver's side, z up)
// with its real size. Pallet loads stand on a thin wooden base; stacked units sit on the one below.
// Clicking a truck (without dragging) calls `onSelectTruck` with its index.
//
// Loaded lazily from FleetOverview and LoadPlanView so three.js is only downloaded when the user
// switches to 3D.
import { useLayoutEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Vector3 } from "three";
import { Edges, OrbitControls } from "@react-three/drei";
import { colorOf } from "../lib/capacity.ts";
import { DECK_GAP_MM, stackColumns } from "../lib/deck.ts";
import { describeItem, metres } from "../lib/sizes.ts";
import { REDUCED_MOTION, useDarkTheme, useMediaQuery } from "../lib/useMediaQuery.js";

/** Pointer travel (px) above which a click on a truck was really a drag to rotate the view. */
const CLICK_SLOP_PX = 4;

// Scene units per metre (a 2.4 m deck is 1.5 units wide).
const S = 0.625;
const mm = (n) => (n / 1000) * S;
const FLOOR = 0.62; // deck floor height above the ground
const CAB = 1.1; // cab length
const GAP = 0.012; // drawn gap between neighbouring boxes
const PALLET_BASE_MM = 144; // height of a pallet's wooden base
const LABEL_ROOM = 2.2; // empty ground in front of the cab, where the label goes
const ROW_SPACING = mm(2500) + 1.3;
// Shift trucks right so truck + cab + label is centred on its grid slot.
const X_SHIFT = (CAB + LABEL_ROOM) / 2;
/** Grid column spacing for trucks `len` long (plus cab and label). */
const colSpacing = (len) => len + CAB + LABEL_ROOM + 1;
/** Label anchor (right edge of the label), just in front of the cab. */
const labelX = (len) => -len / 2 - CAB - 0.3;
const LABEL_Y = FLOOR + 0.45;
const DROP_HEIGHT = 2.6;
const DROP_SECONDS = 0.35;

// Slate neutrals and the teal accent of the planner's tokens (src/planner/styles/tokens.css).
const PALETTE = {
  light: { ground: "#e2e8f0", frame: "#94a3b8", floor: "#cbd5e1", cab: "#0f766e", wheel: "#1e293b", active: "#0f172a", pallet: "#b08a5a" },
  dark: { ground: "#1e293b", frame: "#64748b", floor: "#334155", cab: "#0d9488", wheel: "#020617", active: "#ffffff", pallet: "#8a6a42" },
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

/**
 * The vehicle's decks laid out along the truck, in scene units: each deck's centre x (the
 * truck centred on 0, cab end at -len/2), length, width and inside height.
 */
function layoutDecks(decks) {
  const totalMm = decks.reduce((s, d) => s + d.length_mm, 0) + DECK_GAP_MM * Math.max(0, decks.length - 1);
  const len = mm(totalMm);
  let start = -len / 2;
  const out = decks.map((d) => {
    const box = { ...d, x0: start, cx: start + mm(d.length_mm) / 2, len: mm(d.length_mm), w: mm(d.width_mm), h: mm(d.height_mm) };
    start += mm(d.length_mm + DECK_GAP_MM);
    return box;
  });
  return { len, decks: out, byId: new Map(out.map((d) => [d.id, d])) };
}

/** A shipment's box: pallet base (pallets only) and load, dropping in when `animate`. */
function Crate({ shipment, x, z, bottom, size, base, colors, activeIds, onHover, animate }) {
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

  const active = activeIds?.includes(shipment.id) ?? false;
  const dim = activeIds != null && !active;
  const [lx, ly, lz] = size;
  const load = ly - base;

  return (
    <group
      ref={ref}
      position={[x, animate ? DROP_HEIGHT : 0, z]}
      onPointerOver={(e) => {
        e.stopPropagation();
        onHover([shipment.id]);
      }}
      onPointerOut={(e) => {
        e.stopPropagation();
        onHover(null);
      }}
    >
      {base > 0 && (
        <mesh position={[0, FLOOR + bottom + base / 2, 0]}>
          <boxGeometry args={[lx, base, lz]} />
          <meshLambertMaterial color={colors.pallet} transparent depthWrite={!dim} opacity={dim ? 0.25 : 1} />
        </mesh>
      )}
      <mesh position={[0, FLOOR + bottom + base + load / 2, 0]}>
        <boxGeometry args={[lx, load, lz]} />
        <meshLambertMaterial
          color={colorOf(shipment)}
          // always transparent: three.js doesn't recompile when this flag flips
          transparent
          depthWrite={!dim}
          opacity={dim ? 0.25 : 1}
          emissive={active ? colorOf(shipment) : "#000000"}
          emissiveIntensity={active ? 0.35 : 0}
        />
        <Edges color={active ? colors.active : "#000000"} transparent opacity={active ? 1 : dim ? 0.08 : 0.25} />
      </mesh>
    </group>
  );
}

function Wheel({ x, z, colors }) {
  return (
    <mesh position={[x, 0.3, z]} rotation={[Math.PI / 2, 0, 0]}>
      <cylinderGeometry args={[0.3, 0.3, 0.22, 8]} />
      <meshLambertMaterial color={colors.wheel} />
    </mesh>
  );
}

/** A shipment's box in truck coordinates, from its placement on its deck. */
function boxOf(s, layout) {
  const p = s.placement;
  const d = layout.byId.get(p.deck_id) ?? layout.decks[0];
  const height = mm(p.height_mm);
  return {
    x: d.x0 + mm(p.x_mm + p.length_mm / 2),
    // y runs from the driver's (left) side; facing the cab end (-x), left is +z.
    z: d.w / 2 - mm(p.y_mm + p.width_mm / 2),
    bottom: mm(p.z_mm),
    size: [Math.max(0.02, mm(p.length_mm) - GAP), height, Math.max(0.02, mm(p.width_mm) - GAP)],
    base: s.kind === "pallet" ? Math.min(mm(PALLET_BASE_MM), height / 2) : 0,
  };
}

function TruckModel({ truck, position, layout, step, dropIndex, colors, activeIds, onHover, animate, onSelect }) {
  const holdsActive = activeIds != null && truck.shipments.some((s) => activeIds.includes(s.id));
  const frameColor = holdsActive ? colors.active : colors.frame;
  const { len, decks } = layout;
  const first = decks[0];

  return (
    <group
      position={position}
      onClick={onSelect && ((e) => {
        e.stopPropagation();
        if (e.delta <= CLICK_SLOP_PX) onSelect();
      })}
    >
      {decks.map((d, i) => (
        <group key={d.id}>
          {/* deck floor and see-through load space up to the inside height */}
          <mesh position={[d.cx, FLOOR - 0.04, 0]}>
            <boxGeometry args={[d.len, 0.08, d.w]} />
            <meshLambertMaterial color={colors.floor} />
          </mesh>
          <mesh position={[d.cx, FLOOR + d.h / 2, 0]}>
            <boxGeometry args={[d.len, d.h, d.w]} />
            <meshLambertMaterial color={colors.frame} transparent opacity={0.07} depthWrite={false} />
            <Edges color={frameColor} />
          </mesh>
          {i > 0 && (
            <mesh position={[d.x0 - mm(DECK_GAP_MM) / 2, FLOOR - 0.1, 0]}>
              <boxGeometry args={[mm(DECK_GAP_MM), 0.06, 0.2]} />
              <meshLambertMaterial color={colors.wheel} />
            </mesh>
          )}
          {[d.x0 + d.len - 0.9, d.x0 + d.len - 0.3, ...(i === 0 ? [d.x0 + 0.7] : [])].map((x) => (
            <group key={x}>
              <Wheel x={x} z={d.w / 2 - 0.12} colors={colors} />
              <Wheel x={x} z={-d.w / 2 + 0.12} colors={colors} />
            </group>
          ))}
        </group>
      ))}

      {/* cab */}
      <mesh position={[-len / 2 - CAB / 2 - 0.08, FLOOR + 0.45, 0]}>
        <boxGeometry args={[CAB, 0.9, first.w - 0.1]} />
        <meshLambertMaterial color={colors.cab} />
      </mesh>
      <mesh position={[-len / 2 - CAB - 0.085, FLOOR + 0.6, 0]}>
        <boxGeometry args={[0.02, 0.35, first.w - 0.3]} />
        <meshLambertMaterial color="#9fc3e8" />
      </mesh>
      <group>
        <Wheel x={-len / 2 - CAB / 2} z={first.w / 2 - 0.12} colors={colors} />
        <Wheel x={-len / 2 - CAB / 2} z={-first.w / 2 + 0.12} colors={colors} />
      </group>

      {truck.shipments.map((s) => {
        if (!(dropIndex[s.id] < step)) return null;
        const b = boxOf(s, layout);
        return (
          <Crate
            key={s.id}
            shipment={s}
            {...b}
            colors={colors}
            activeIds={activeIds}
            onHover={onHover}
            animate={animate}
          />
        );
      })}
    </group>
  );
}

const VIEW_DIR = [0.5, 0.95, 1]; // from the front-right, looking down

/** Frames the whole parking grid whenever the canvas size or truck count changes. */
function CameraRig({ n, spacing, height }) {
  const camera = useThree((s) => s.camera);
  const { width, height: px } = useThree((s) => s.size);
  const controls = useThree((s) => s.controls);

  useLayoutEffect(() => {
    const { cols, rows } = grid(n);
    // half-extents of the grid, including cabs and labels
    const hx = (cols * spacing) / 2;
    const hz = (rows * ROW_SPACING) / 2;
    const radius = Math.hypot(hx, hz, height);
    const aspect = width / px;
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
  }, [camera, controls, width, px, n, spacing, height]);

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

const kg = (n) => n.toLocaleString("en-AU");

/** The label text of a truck at this point of the drop animation. */
function truckStatus(truck, capacity, step, dropIndex) {
  const shown = truck.shipments.filter((s) => dropIndex[s.id] < step);
  const done = shown.length === truck.shipments.length;
  const load = shown.reduce((sum, s) => sum + s.weight, 0);
  const fill = Math.floor((done ? truck.fill_percent : (100 * load) / capacity.weight_kg) + 1e-9);
  return {
    fill,
    sub: done ? `${kg(truck.empty)} kg free · floor ${Math.floor(truck.floor_percent + 1e-9)}%` : "loading…",
  };
}

/** Where a shipment stands in its column, for the screen reader list: "", or "level 2 of 2". */
function levelText(columns, s) {
  const col = columns.find((c) => c.items.includes(s));
  return col && col.items.length > 1 ? `, level ${s.placement.level + 1} of ${col.items.length}` : "";
}

export default function TruckScene3D({ data, step, dropIndex, activeIds, onHover, onFocusBlock, height, onSelectTruck }) {
  const dark = useDarkTheme();
  const reducedMotion = useMediaQuery(REDUCED_MOTION);
  const colors = dark ? PALETTE.dark : PALETTE.light;
  const labels = useRef([]);
  const n = data.trucks.length;
  const capacity = data.capacity;
  const layout = useMemo(() => layoutDecks(capacity.decks), [capacity]);
  const insideH = Math.max(...layout.decks.map((d) => d.h));
  const insideMm = Math.max(...capacity.decks.map((d) => d.height_mm));
  const spacing = colSpacing(layout.len);
  const positions = useMemo(() => data.trucks.map((_, i) => slot(i, n, spacing)), [data.trucks, n, spacing]);

  return (
    <div className="scene3d" style={{ height }}>
      <Canvas
        frameloop="demand"
        dpr={[1, 1.5]}
        camera={{ position: [7, 9, 13], fov: 35 }}
        onPointerMissed={() => onHover(null)}
        aria-hidden="true"
      >
        <ambientLight intensity={dark ? 0.9 : 1.1} />
        <directionalLight position={[6, 12, 8]} intensity={dark ? 1.6 : 2} />
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[400, 400]} />
          <meshLambertMaterial color={colors.ground} />
        </mesh>

        {data.trucks.map((t, i) => (
          <TruckModel
            key={t.truck}
            truck={t}
            position={positions[i]}
            layout={layout}
            step={step}
            dropIndex={dropIndex}
            colors={colors}
            activeIds={activeIds}
            onHover={onHover}
            animate={!reducedMotion}
            onSelect={onSelectTruck && (() => onSelectTruck(i))}
          />
        ))}
        <CameraRig n={n} spacing={spacing} height={insideH} />
        <LabelTracker positions={positions} labels={labels} anchorX={labelX(layout.len)} />

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
          const { fill, sub } = truckStatus(t, capacity, step, dropIndex);
          const holdsActive = activeIds != null && t.shipments.some((s) => activeIds.includes(s.id));
          return (
            <div
              key={t.truck}
              ref={(el) => (labels.current[i] = el)}
              className={`truck3d-label${holdsActive ? " active" : ""}`}
            >
              <span className="truck3d-title"><b>Truck {t.truck}</b> · {fill}%</span>
              <span className="truck3d-sub">{sub}</span>
            </div>
          );
        })}
      </div>

      <p className="scene3d-hint muted small" aria-hidden="true">Drag to rotate</p>

      {/* The canvas can't be reached by keyboard or screen reader, so the same
          content is listed here. Tabbing through it highlights each box. */}
      <ul className="sr-only">
        {data.trucks.map((t) => {
          const columns = stackColumns(t.shipments);
          return (
            <li key={t.truck}>
              {`Truck ${t.truck}: ${kg(t.load)} of ${kg(capacity.weight_kg)} kg, floor ${Math.floor(t.floor_percent + 1e-9)}% used, `}
              {`${metres(t.max_height_mm)} of ${metres(insideMm)} m high`}
              <ul>
                {t.shipments.map((s) => (
                  <li
                    key={s.id}
                    tabIndex={0}
                    onFocus={() => onFocusBlock([s.id])}
                    onBlur={() => onFocusBlock(null)}
                  >
                    {`${describeItem(s)}${levelText(columns, s)}, truck ${t.truck} of ${data.num_trucks}`}
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
