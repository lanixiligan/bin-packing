// Top-level routes. Each role area owns its own route tree (portal/routes.tsx,
// ops/routes.tsx, driver/routes.tsx). Orchestrator-owned.
import { createBrowserRouter } from "react-router";
import DemoApp from "./demo/DemoApp.jsx";
import { driverRoutes } from "./driver/routes";
import { opsRoutes } from "./ops/routes";
import { portalRoutes } from "./portal/routes";
import HomeRedirect from "./shell/HomeRedirect";
import LoginPage from "./shell/LoginPage";
import NotFound from "./shell/NotFound";

export const router = createBrowserRouter([
  { path: "/", element: <HomeRedirect /> },
  { path: "/login", element: <LoginPage /> },
  { path: "/demo", element: <DemoApp /> },
  portalRoutes,
  opsRoutes,
  driverRoutes,
  { path: "*", element: <NotFound /> },
]);
