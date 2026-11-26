// Routes of the portal area, mounted at /portal for role "customer".
// The area owner may add, remove or rename routes here.
import { Navigate, type RouteObject } from "react-router";
import { RequireRole } from "../auth/RequireRole";
import PortalLayout from "./PortalLayout";
import OrdersPage from "./pages/OrdersPage";
import OrderNewPage from "./pages/OrderNewPage";
import OrderDetailPage from "./pages/OrderDetailPage";
import OrderEditPage from "./pages/OrderEditPage";
import ItemsPage from "./pages/ItemsPage";
import AddressesPage from "./pages/AddressesPage";

export const portalRoutes: RouteObject = {
  path: "/portal",
  element: (
    <RequireRole role="customer">
      <PortalLayout />
    </RequireRole>
  ),
  children: [
    { index: true, element: <Navigate to="orders" replace /> },
    { path: "orders", element: <OrdersPage /> },
    { path: "orders/new", element: <OrderNewPage /> },
    { path: "orders/:orderId", element: <OrderDetailPage /> },
    { path: "orders/:orderId/edit", element: <OrderEditPage /> },
    { path: "items", element: <ItemsPage /> },
    { path: "addresses", element: <AddressesPage /> },
  ],
};
