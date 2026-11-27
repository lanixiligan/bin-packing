import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import PlannerApp from "./PlannerApp.tsx";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <PlannerApp />
  </StrictMode>,
);
