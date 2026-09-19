import { useState } from "react";
import { api, errorDetail } from "../api/client";
import { IconGoogle, IconMail } from "./icons";

/**
 * Sign in with Google. A plain link: the server sends the browser to Google and brings it back
 * signed in, so no third-party script ever runs on these pages.
 */
export function GoogleButton({ label = "Continue with Google" }: { label?: string }) {
  return (
    <>
      <a className="zb-btn zb-btn--google zb-btn--lg zb-btn--block" href="/api/auth/google/start"><IconGoogle size={18} /> {label}</a>
      <div className="zb-or" role="separator">or</div>
    </>
  );
}

/** Shown after sign-up, and to anyone who logs in before confirming their address. */
export function CheckInbox({ email, onBack }: { email: string; onBack?: () => void }) {
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [note, setNote] = useState("");

  async function resend() {
    setState("sending");
    setNote("");
    try {
      const res = await api.post("/auth/resend-verification", { email });
      setNote(res.data.detail ?? "A new link is on its way.");
      setState("sent");
    } catch (err: unknown) {
      setNote(errorDetail(err, "Could not send a new link just now. Please try again."));
      setState("idle");
    }
  }

  return (
    <div className="zb-auth-form zb-inbox">
      <span className="zb-stat-icon"><IconMail size={24} /></span>
      <div>
        <h1>Check your inbox</h1>
        <p style={{ color: "var(--muted-fg)", marginTop: 8, lineHeight: 1.6 }}>
          We sent a link to <strong style={{ color: "var(--fg)", overflowWrap: "anywhere" }}>{email}</strong>. Open it to confirm your address and your workspace opens. The link works for 24 hours.
        </p>
      </div>
      <p className="zb-help">Nothing there? Look in your spam folder, then ask for a new link.</p>
      {note && <div className="zb-alert zb-alert--info" role="status">{note}</div>}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button type="button" className="zb-btn zb-btn--secondary" onClick={resend} disabled={state !== "idle"}>
          {state === "sending" ? "Sending…" : state === "sent" ? "Link sent" : "Send a new link"}
        </button>
        {onBack && <button type="button" className="zb-btn zb-btn--ghost" onClick={onBack}>Use a different email</button>}
      </div>
    </div>
  );
}
