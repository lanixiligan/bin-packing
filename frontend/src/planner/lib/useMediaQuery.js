// Media query hooks for the truck views (reduced motion, narrow screen, dark theme), originally
// from the bin packing demo.
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

function subscribeTheme(notify) {
  const observer = new MutationObserver(notify);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => observer.disconnect();
}

/**
 * True while the page is dark: data-theme="dark" on <html>, or no data-theme
 * (the "Auto" theme) and a dark system preference.
 */
export function useDarkTheme() {
  const system = useMediaQuery(DARK_SCHEME);
  const theme = useSyncExternalStore(subscribeTheme, () => document.documentElement.dataset.theme ?? "");
  return theme === "dark" || (theme !== "light" && system);
}

export const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";
export const NARROW_SCREEN = "(max-width: 600px)"; // trucks get shorter below this width
export const DARK_SCHEME = "(prefers-color-scheme: dark)";
