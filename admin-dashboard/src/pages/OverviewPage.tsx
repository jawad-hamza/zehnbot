import { useAuthStore } from "../store/authStore";
import PlatformOverview from "./PlatformOverview";
import WorkspaceOverview, { OverviewSkeleton } from "./WorkspaceOverview";

/** The same URL is home for both roles; who is signed in decides which home it is. */
export default function OverviewPage() {
  const me = useAuthStore((s) => s.me);
  if (!me) return <OverviewSkeleton />;
  return me.role === "superadmin" ? <PlatformOverview /> : <WorkspaceOverview />;
}
