import { Suspense, lazy, useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { api } from "../api/client";
import { useAuthStore } from "../store/authStore";

// The marketing page ships its own chunk (it carries the motion library and the screenshots),
// so an installation whose landing page lives on another website never downloads it.
const LandingPage = lazy(() => import("./LandingPage"));

/**
 * "/" of the app. When the landing page lives on another website (MARKETING_URL, ours is
 * zehnox.com/zehnbot), someone who types bot.zehnox.com sees THAT page: a visitor is sent there,
 * and someone already signed in goes straight to their dashboard. The landing page's own
 * "Log in" and "Start free" point at /login and /signup here, so nobody is bounced in a loop.
 * With no MARKETING_URL, the built-in landing page is shown.
 */
export default function HomeRoute() {
  const signedIn = useAuthStore((s) => !!s.token);
  const [marketingUrl, setMarketingUrl] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    api.get("/auth/config").then((r) => setMarketingUrl(r.data.marketing_url ?? null)).catch(() => setMarketingUrl(null));
  }, []);

  // replace(), not assign(): the Back button must not land on a page that only forwards again
  useEffect(() => {
    if (marketingUrl && !signedIn) window.location.replace(marketingUrl);
  }, [marketingUrl, signedIn]);

  if (marketingUrl === undefined) return null;
  if (marketingUrl) return signedIn ? <Navigate to="/overview" replace /> : null;
  return <Suspense fallback={null}><LandingPage /></Suspense>;
}
