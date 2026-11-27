// The 3D view of LoadPlanView (one truck, or all the trucks of a split side by side), loaded on
// first use, and its 2D / 3D toggle. The units drop in, truck by truck (lib/useDropAnimation.ts).
import { lazy, Suspense, useId, useMemo } from "react";
import { dropIndexOf, type Scene } from "../lib/sceneData.ts";
import { NARROW_SCREEN, useMediaQuery } from "../lib/useMediaQuery.js";
import "./truck.css";

// three.js is large, so the 3D view is only downloaded when it's first shown.
const TruckScene3D = lazy(() => import("./TruckScene3D.jsx"));

export type TruckView = "2d" | "3d";

export interface Scene3DViewProps {
  scene: Scene;
  step: number;
  activeIds: number[] | null;
  onHover(ids: number[] | null): void;
  onFocusBlock(ids: number[] | null): void;
  onSelectTruck?(index: number): void;
}

/** The 3D scene of a scene's trucks, loaded on first use (also LoadPlanView's 3D option). */
export function Scene3DView({ scene, step, activeIds, onHover, onFocusBlock, onSelectTruck }: Scene3DViewProps) {
  const narrow = useMediaQuery(NARROW_SCREEN);
  const dropIndex = useMemo(() => dropIndexOf(scene), [scene]);
  const height = narrow ? 320 : 420;
  return (
    <Suspense fallback={<div className="scene3d scene3d-loading muted" style={{ height }}>Loading 3D view…</div>}>
      <TruckScene3D data={scene} step={step} dropIndex={dropIndex} height={height} activeIds={activeIds}
                    onHover={onHover} onFocusBlock={onFocusBlock} onSelectTruck={onSelectTruck} />
    </Suspense>
  );
}

/** "2D" / "3D" radio buttons. */
export function ViewToggle({ view, onChange, label }: { view: TruckView; onChange(v: TruckView): void; label: string }) {
  const name = useId();
  return (
    <fieldset className="segmented" aria-label={label}>
      {([["2d", "2D"], ["3d", "3D"]] as [TruckView, string][]).map(([v, text]) => (
        <label key={v}>
          <input type="radio" name={name} value={v} checked={view === v} onChange={() => onChange(v)} />
          <span>{text}</span>
        </label>
      ))}
    </fieldset>
  );
}
