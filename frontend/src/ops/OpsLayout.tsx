// Layout of the ops area (role: dispatcher).
import { AppShell, type NavItem } from "../shell/AppShell";
import "./ops.css";

const NAV: NavItem[] = [
  { to: "/ops/orders", label: "Order queue", end: true },
  { to: "/ops/plans", label: "Plans" },
  { to: "/ops/fleet", label: "Fleet" },
  { to: "/ops/zones", label: "Zones" },
  { to: "/ops/invoices", label: "Invoices" },
];

export default function OpsLayout() {
  return <AppShell area="Dispatch" nav={NAV} variant="wide" />;
}
