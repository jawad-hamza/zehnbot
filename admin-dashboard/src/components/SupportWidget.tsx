import { useEffect, useState } from "react";
import { api } from "../api/client";
import { useAuthStore } from "../store/authStore";

/**
 * ZehnBot's own customer-support chat, in the corner of every page of this app: the real widget, running
 * the bot the super admin picked in Settings. Not shown to the super admin (it is their own support desk).
 * The widget cannot be unloaded once it is on the page, so it is hidden rather than removed.
 */
export default function SupportWidget() {
  const isOperator = useAuthStore((s) => s.kind === "operator" || s.me?.role === "superadmin");
  const [clientId, setClientId] = useState<string | null>(null);

  useEffect(() => {
    api.get("/public/support-bot").then((r) => setClientId(r.data?.client_id ?? null)).catch(() => undefined);
  }, []);

  useEffect(() => {
    const host = document.getElementById("cb-widget-root");
    if (host) host.style.display = isOperator ? "none" : "";
    if (!clientId || isOperator || document.querySelector("script[data-zehnbot-support]")) return;
    const script = document.createElement("script");
    script.src = `/static/widget.js?client_id=${encodeURIComponent(clientId)}`;
    script.defer = true;
    script.dataset.zehnbotSupport = "1";
    document.body.appendChild(script);
  }, [clientId, isOperator]);

  return null;
}
