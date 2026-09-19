import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { api } from "../api/client";
import { useAuthStore } from "../store/authStore";

// The public pages look the same to everyone, the operator included
const PUBLIC_PAGES = new Set(["/", "/login", "/signup", "/verify-email"]);

/**
 * ZehnBot's own customer-support chat, in the corner of this app's pages: the real widget, running the bot
 * the super admin picked in Settings. Shown on the public pages and in customers' dashboards; hidden inside
 * the operator's console (it is their own support desk). The widget cannot be unloaded once it is on the
 * page, so it is hidden rather than removed.
 */
export default function SupportWidget() {
  const { pathname } = useLocation();
  const isOperator = useAuthStore((s) => s.kind === "operator" || s.me?.role === "superadmin");
  const hidden = isOperator && !PUBLIC_PAGES.has(pathname);
  const [clientId, setClientId] = useState<string | null>(null);

  useEffect(() => {
    api.get("/public/support-bot").then((r) => setClientId(r.data?.client_id ?? null)).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!clientId || hidden) return;
    if (document.querySelector("script[data-zehnbot-support]")) return;
    const script = document.createElement("script");
    script.src = `/static/widget.js?client_id=${encodeURIComponent(clientId)}`;
    script.defer = true;
    script.dataset.zehnbotSupport = "1";
    document.body.appendChild(script);
  }, [clientId, hidden]);

  // The widget adds its element asynchronously; keep its visibility in step with the page, whenever it appears
  useEffect(() => {
    const apply = () => {
      const host = document.getElementById("cb-widget-root");
      if (host) host.style.display = hidden ? "none" : "";
      return !!host;
    };
    if (apply()) return;
    const watch = new MutationObserver(() => { if (apply()) watch.disconnect(); });
    watch.observe(document.body, { childList: true });
    return () => watch.disconnect();
  }, [hidden, clientId]);

  return null;
}
