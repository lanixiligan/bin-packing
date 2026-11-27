// The drop-in animation of the truck views, as in the bin packing demo: `step` counts how many units
// have dropped so far (in the scene's drop_order), one more every DROP_INTERVAL_MS. It starts again
// whenever `key` changes (a new answer) and on replay(). Under reduced motion every unit is there at once.
import { useEffect, useState } from "react";
import { REDUCED_MOTION, useMediaQuery } from "./useMediaQuery.js";

export const DROP_INTERVAL_MS = 150; // time between each unit dropping in

export function useDropAnimation(count: number, key: unknown): { step: number; replay(): void } {
  const reducedMotion = useMediaQuery(REDUCED_MOTION);
  const [run, setRun] = useState({ key, round: 0, step: 0 });
  // A new answer starts from nothing (state adjusted while rendering, so the old step never shows).
  if (run.key !== key) setRun({ key, round: run.round + 1, step: 0 });

  useEffect(() => {
    if (reducedMotion) return;
    const timer = setInterval(() => {
      setRun((r) => {
        if (r.step >= count) {
          clearInterval(timer);
          return r;
        }
        return { ...r, step: r.step + 1 };
      });
    }, DROP_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [run.round, count, reducedMotion]);

  return {
    step: reducedMotion ? count : Math.min(run.step, count),
    replay: () => setRun((r) => ({ ...r, round: r.round + 1, step: 0 })),
  };
}
