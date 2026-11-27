// Holds the display unit system (mm / kg or m / t) for the page, remembered per browser.
import { useMemo, useState, type ReactNode } from "react";
import { UNITS_STORAGE_KEY, UnitsContext, unitsFor, type UnitSystem } from "./units.ts";

function initialSystem(): UnitSystem {
  try {
    return localStorage.getItem(UNITS_STORAGE_KEY) === "m-t" ? "m-t" : "mm-kg";
  } catch {
    return "mm-kg";
  }
}

export function UnitsProvider({ children, initial }: { children: ReactNode; initial?: UnitSystem }) {
  const [system, setSystemState] = useState<UnitSystem>(initial ?? initialSystem);
  const value = useMemo(() => unitsFor(system, (s: UnitSystem) => {
    setSystemState(s);
    try {
      localStorage.setItem(UNITS_STORAGE_KEY, s);
    } catch {
      // storage blocked: the choice lasts for this page only
    }
  }), [system]);
  return <UnitsContext.Provider value={value}>{children}</UnitsContext.Provider>;
}
