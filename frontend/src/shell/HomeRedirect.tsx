// "/" sends each user to their area. Orchestrator-owned.
import { Navigate } from "react-router";
import { HOME_BY_ROLE, useAuth } from "../auth/AuthContext";
import { Loading } from "./QueryState";

export default function HomeRedirect() {
  const { user, status } = useAuth();
  if (status === "loading") return <Loading />;
  return <Navigate to={user ? HOME_BY_ROLE[user.role] : "/login"} replace />;
}
