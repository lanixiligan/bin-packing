// Layout of the driver area (role: driver).
import { AppShell, type NavItem } from "../shell/AppShell";
import "./driver.css";

const NAV: NavItem[] = [
  { to: "/driver/run", label: "Today's run" },
];

export default function DriverLayout() {
  return <AppShell area="Driver" nav={NAV} variant="narrow" />;
}
