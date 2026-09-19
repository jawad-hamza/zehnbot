import { Suspense, lazy, useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { api } from "../api/client";
import { useAuthStore } from "../store/authStore";

// The marketing page ships its own chunk (it carries the motion library and the screenshots),
// so an installation whose landing page lives on another website never downloads it.
const LandingPage = lazy(() => import("./LandingPage"));

/**
 * "/" of the app. When the operator has a landing page elsewhere (MARKETING_URL, ours is
 * zehnox.com/zehnbot) this address is only the door to the product: log in, or straight to the
 * dashboard. With none configured, the built-in landing page is shown.
 */
export default function HomeRoute() {
  const signedIn = useAuthStore((s) => !!s.token);
  const [external, setExternal] = useState<boolean | null>(null);

  useEffect(() => {
    api.get("/auth/config").then((r) => setExternal(!!r.data.marketing_url)).catch(() => setExternal(false));
  }, []);

  if (external === null) return null;
  if (external) return <Navigate to={signedIn ? "/overview" : "/login"} replace />;
  return <Suspense fallback={null}><LandingPage /></Suspense>;
}
