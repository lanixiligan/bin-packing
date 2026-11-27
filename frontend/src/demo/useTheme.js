import { useEffect, useState } from "react";

// Auto / Light / Dark: data-theme on <html> (none = follow the system), remembered per browser.
const THEME_KEY = "load-planner.theme";

export function useTheme() {
  const [theme, setTheme] = useState(() => {
    try {
      const t = localStorage.getItem(THEME_KEY);
      return t === "light" || t === "dark" ? t : "system";
    } catch {
      return "system";
    }
  });
  useEffect(() => {
    const root = document.documentElement;
    if (theme === "system") delete root.dataset.theme;
    else root.dataset.theme = theme;
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      // storage blocked: the choice lasts for this page only
    }
  }, [theme]);
  return [theme, setTheme];
}
