// Vitest setup: jest-dom matchers, a clean DOM between tests, and browser APIs jsdom lacks.
import "@testing-library/jest-dom/vitest";
import { cleanup, configure } from "@testing-library/react";
import { afterEach, vi } from "vitest";

// findBy*/waitFor wait up to 1 s by default; a full parallel run can be slower than that.
configure({ asyncUtilTimeout: 4000 });

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  document.documentElement.removeAttribute("data-theme");
  try {
    localStorage.clear();
  } catch {
    // ignore
  }
});

if (!window.matchMedia) {
  window.matchMedia = (query: string) => ({
    matches: false, media: query, onchange: null,
    addListener: () => {}, removeListener: () => {},
    addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
  }) as MediaQueryList;
}
