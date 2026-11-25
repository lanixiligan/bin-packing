import { useCallback, useSyncExternalStore } from "react";

/** True while the CSS media query matches; updates live when it changes. */
export function useMediaQuery(query) {
  const subscribe = useCallback(
    (notify) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", notify);
      return () => mql.removeEventListener("change", notify);
    },
    [query]
  );
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches);
}

export const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";
export const SMALL_SCREEN = "(max-width: 900px)"; // panels stack below this width
export const NARROW_SCREEN = "(max-width: 600px)"; // trucks get shorter below this width
