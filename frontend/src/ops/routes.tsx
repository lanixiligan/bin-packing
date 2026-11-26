// Routes of the ops area, mounted at /ops for role "dispatcher".
// The area owner may add, remove or rename routes here.
import { Navigate, type RouteObject } from "react-router";
import { RequireRole } from "../auth/RequireRole";
import OpsLayout from "./OpsLayout";
import OrderQueuePage from "./pages/OrderQueuePage";
import OpsOrderDetailPage from "./pages/OpsOrderDetailPage";
import PlansPage from "./pages/PlansPage";
import PlanNewPage from "./pages/PlanNewPage";
import PlanDetailPage from "./pages/PlanDetailPage";
import FleetPage from "./pages/FleetPage";
import ZonesPage from "./pages/ZonesPage";
import InvoicesPage from "./pages/InvoicesPage";
import DgCheckerPage from "./pages/DgCheckerPage";

export const opsRoutes: RouteObject = {
  path: "/ops",
  element: (
    <RequireRole role="dispatcher">
      <OpsLayout />
    </RequireRole>
  ),
  children: [
    { index: true, element: <Navigate to="orders" replace /> },
    { path: "orders", element: <OrderQueuePage /> },
    { path: "orders/:orderId", element: <OpsOrderDetailPage /> },
    { path: "plans", element: <PlansPage /> },
    { path: "plans/new", element: <PlanNewPage /> },
    { path: "plans/:planId", element: <PlanDetailPage /> },
    { path: "fleet", element: <FleetPage /> },
    { path: "zones", element: <ZonesPage /> },
    { path: "invoices", element: <InvoicesPage /> },
    { path: "dg", element: <DgCheckerPage /> },
  ],
};
