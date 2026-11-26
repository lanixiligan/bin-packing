// The demo's "shipments drop in one by one" animation as a hook:
// `step` counts how many units have dropped. With reduced motion the final
// state shows at once.
import { useCallback, useEffect, useState } from "react";
import { REDUCED_MOTION, useMediaQuery } from "../../useMediaQuery.js";

const DROP_INTERVAL_MS = 150;

export function useDropAnimation(count: number) {
  const reducedMotion = useMediaQuery(REDUCED_MOTION);
  const [step, setStep] = useState(0);
  const [run, setRun] = useState(0); // bumped to replay

  useEffect(() => {
    if (reducedMotion) return;
    const id = setInterval(() => {
      setStep((s) => (s >= count ? s : s + 1));
    }, DROP_INTERVAL_MS);
    // stop ticking once everything has dropped
    const stop = setTimeout(() => clearInterval(id), DROP_INTERVAL_MS * (count + 2));
    return () => {
      clearInterval(id);
      clearTimeout(stop);
    };
  }, [count, reducedMotion, run]);

  const replay = useCallback(() => {
    setStep(0);
    setRun((r) => r + 1);
  }, []);

  return { step: reducedMotion ? count : step, replay };
}
