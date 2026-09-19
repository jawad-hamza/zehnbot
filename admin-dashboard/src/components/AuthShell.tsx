import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import ThemeToggle from "./ThemeToggle";
import { BrandMark, IconCheck, IconEye, IconEyeOff, ZehnoxWordmark } from "./icons";

/** Shared frame for sign-in and sign-up: the form on one side, what the product does on the other. */
export default function AuthShell({ children }: { children: ReactNode }) {
  // The logo leads back to the landing page, wherever that lives
  const [marketingUrl, setMarketingUrl] = useState<string | null>(null);
  useEffect(() => {
    api.get("/auth/config").then((r) => setMarketingUrl(r.data.marketing_url ?? null)).catch(() => undefined);
  }, []);

  return (
    <div className="zb-auth">
      <div className="zb-auth-main">
        <div className="zb-auth-top">
          {marketingUrl
            ? <a href={marketingUrl} className="zb-brand" style={{ padding: 0 }}><BrandMark /> ZehnBot</a>
            : <Link to="/" className="zb-brand" style={{ padding: 0 }}><BrandMark /> ZehnBot</Link>}
          <ThemeToggle />
        </div>
        {children}
      </div>
      <aside className="zb-auth-side" aria-label="What ZehnBot does">
        <div>
          <h2>Your website answers. You get the lead.</h2>
          <p>ZehnBot replies to visitors from your own pages and documents, and passes you the people who want to talk.</p>
          <ul className="zb-auth-points">
            <li><IconCheck size={18} style={{ flexShrink: 0, marginTop: 2 }} /> Answers only from the content you give it</li>
            <li><IconCheck size={18} style={{ flexShrink: 0, marginTop: 2 }} /> Collects name, email and phone inside the chat</li>
            <li><IconCheck size={18} style={{ flexShrink: 0, marginTop: 2 }} /> Shows you the questions it could not answer</li>
          </ul>
        </div>
        <span className="zb-zehnox" role="img" aria-label="Made by Zehnox"><span aria-hidden="true">Made by</span> <ZehnoxWordmark /></span>
      </aside>
    </div>
  );
}

interface PasswordProps {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete: "current-password" | "new-password";
  minLength?: number;
  describedBy?: string;
  invalid?: boolean;
}

/** A password box people can check: hidden by default, one button to look at what they typed. */
export function PasswordField({ id, label, value, onChange, autoComplete, minLength, describedBy, invalid }: PasswordProps) {
  const [shown, setShown] = useState(false);
  return (
    <div className="zb-field">
      <label className="zb-label" htmlFor={id}>{label}</label>
      <div className="zb-password">
        <input id={id} className="zb-input" type={shown ? "text" : "password"} value={value} onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete} minLength={minLength} required aria-describedby={describedBy} aria-invalid={invalid || undefined} />
        <button type="button" onClick={() => setShown((s) => !s)} aria-label={shown ? "Hide password" : "Show password"} aria-pressed={shown}>
          {shown ? <IconEyeOff /> : <IconEye />}
        </button>
      </div>
    </div>
  );
}
