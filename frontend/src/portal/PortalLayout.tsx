// Layout of the portal area (role: customer).
import { Outlet } from "react-router";
import { AppShell, type NavItem } from "../shell/AppShell";
import "./portal.css";

const NAV: NavItem[] = [
  { to: "/portal/orders", label: "Orders", end: true },
  { to: "/portal/orders/new", label: "New order" },
  { to: "/portal/items", label: "Items" },
  { to: "/portal/addresses", label: "Addresses" },
];

export default function PortalLayout() {
  return (
    <AppShell area="Customer" nav={NAV} variant="wide">
      <div className="portal">
        <Outlet />
      </div>
    </AppShell>
  );
}
