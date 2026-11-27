import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import CheckerApp from "./CheckerApp.tsx";
import "../planner/styles/tokens.css";
import "../planner/styles/base.css";

// Use the theme picked in the load planner (it saves "light" / "dark"; nothing means the system setting).
try {
  const t = localStorage.getItem("load-planner.theme");
  if (t === "light" || t === "dark") document.documentElement.dataset.theme = t;
} catch {
  // storage blocked: follow the system setting
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <CheckerApp />
  </StrictMode>,
);
