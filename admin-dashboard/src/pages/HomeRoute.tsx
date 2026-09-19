import { Suspense, lazy } from "react";

// The marketing page ships its own chunk (it carries the motion library and the screenshots),
// so people who only ever open the dashboard never download it.
const LandingPage = lazy(() => import("./LandingPage"));

/**
 * "/" of the app: always the ZehnBot landing page, for everyone. It never sends visitors elsewhere
 * (MARKETING_URL is only where the sign-in pages' logo points). Signed-in people see "Open dashboard"
 * on the page itself, and /login and /signup are their own routes.
 */
export default function HomeRoute() {
  return <Suspense fallback={null}><LandingPage /></Suspense>;
}
