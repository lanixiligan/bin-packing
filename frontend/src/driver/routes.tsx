// Routes of the driver area, mounted at /driver for role "driver".
// The area owner may add, remove or rename routes here.
import { Navigate, type RouteObject } from "react-router";
import { RequireRole } from "../auth/RequireRole";
import DriverLayout from "./DriverLayout";
import RunPage from "./pages/RunPage";
import DriverOrderPage from "./pages/DriverOrderPage";
import PodPage from "./pages/PodPage";

export const driverRoutes: RouteObject = {
  path: "/driver",
  element: (
    <RequireRole role="driver">
      <DriverLayout />
    </RequireRole>
  ),
  children: [
    { index: true, element: <Navigate to="run" replace /> },
    { path: "run", element: <RunPage /> },
    { path: "orders/:orderId", element: <DriverOrderPage /> },
    { path: "orders/:orderId/pod", element: <PodPage /> },
  ],
};
