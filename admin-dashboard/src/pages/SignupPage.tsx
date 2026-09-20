import { useEffect, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { api, errorDetail } from "../api/client";
import { CheckInbox, GoogleButton } from "../components/AuthExtras";
import AuthShell, { PasswordField } from "../components/AuthShell";
import ContactDialog, { type ContactRequest } from "../components/ContactDialog";
import { IconAlert } from "../components/icons";
import { useAuthStore } from "../store/authStore";

const MIN_PASSWORD = 10;

export default function SignupPage() {
  const [company, setCompany] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [website, setWebsite] = useState(""); // honeypot: people never see it, form-filling bots fill it in
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [config, setConfig] = useState<{ allowed: boolean; google: boolean; googleSignup: boolean } | null>(null);
  const [inbox, setInbox] = useState(false);
  const [contact, setContact] = useState<ContactRequest | null>(null);
  const token = useAuthStore((s) => (s.kind === "operator" ? null : s.token));   // an operator session is not a customer's
  const setToken = useAuthStore((s) => s.setToken);
  const navigate = useNavigate();

  useEffect(() => {
    api.get("/auth/config")
      .then((r) => setConfig({ allowed: !!r.data.allow_signup, google: !!r.data.google_enabled, googleSignup: !!r.data.google_signup }))
      .catch(() => setConfig({ allowed: false, google: false, googleSignup: false }));
  }, []);

  if (token) return <Navigate to="/overview" replace />;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await api.post("/auth/signup", { company_name: company, email, password, website: website || undefined });
      if (res.data.verification_required) {
        setInbox(true);      // no session until the link in the email is opened
        return;
      }
      setToken(res.data.access_token, "tenant");
      navigate("/overview");
    } catch (err: unknown) {
      setError(errorDetail(err, "Could not create the account. Please try again."));
    } finally {
      setLoading(false);
    }
  }

  const progress = Math.min(1, password.length / MIN_PASSWORD);
  const longEnough = password.length >= MIN_PASSWORD;

  if (inbox) return <AuthShell><CheckInbox email={email.trim()} onBack={() => setInbox(false)} /></AuthShell>;

  return (
    <AuthShell>
      {config?.allowed === false && config.googleSignup ? (
        <div className="zb-auth-form">
          <div>
            <h1>Start free</h1>
            <p style={{ color: "var(--muted-fg)", marginTop: 6 }}>One bot and 200 messages a month. No card needed. New accounts are created with Google, which confirms your address for us.</p>
          </div>
          <a className="zb-btn zb-btn--primary zb-btn--lg zb-btn--block" href="/api/auth/google/start">Sign up with Google</a>
          <p style={{ fontSize: 14, color: "var(--muted-fg)" }}>Already have an account? <Link to="/login">Log in</Link></p>
          <p style={{ fontSize: 13, color: "var(--subtle-fg)" }}>
            By creating an account you agree to our <Link to="/terms">terms</Link> and <Link to="/privacy">privacy policy</Link>.
          </p>
        </div>
      ) : config?.allowed === false ? (
        <div className="zb-auth-form">
          <h1>Sign-up is closed</h1>
          <p style={{ color: "var(--muted-fg)" }}>New accounts are set up by the Zehnox team at the moment. Leave your details and they will create your workspace.</p>
          <button type="button" className="zb-btn zb-btn--primary zb-btn--lg" onClick={() => setContact({ source: "signup-closed" })}>Talk to Zehnox</button>
          <p style={{ fontSize: 14, color: "var(--muted-fg)" }}>Already have an account? <Link to="/login">Log in</Link></p>
        </div>
      ) : (
        <form className="zb-auth-form" onSubmit={handleSubmit}>
          <div>
            <h1>Start free</h1>
            <p style={{ color: "var(--muted-fg)", marginTop: 6 }}>One bot and 200 messages a month. No card needed.</p>
          </div>

          {config?.google && <GoogleButton label="Sign up with Google" />}

          <div className="zb-field">
            <label className="zb-label" htmlFor="su-company">Company or website name</label>
            <input id="su-company" className="zb-input" value={company} onChange={(e) => setCompany(e.target.value)} required minLength={2} maxLength={255} autoComplete="organization" />
          </div>
          <div className="zb-field">
            <label className="zb-label" htmlFor="su-email">Work email</label>
            <input id="su-email" className="zb-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" autoCapitalize="none" spellCheck={false} />
          </div>
          <div className="zb-field" style={{ gap: 8 }}>
            <PasswordField id="su-password" label="Password" value={password} onChange={setPassword} autoComplete="new-password" minLength={MIN_PASSWORD} describedBy="su-password-help" />
            <div className="zb-strength" aria-hidden="true"><span style={{ width: `${progress * 100}%`, background: longEnough ? "var(--success)" : "var(--border-strong)" }} /></div>
            <span id="su-password-help" className="zb-help">{longEnough ? "Long enough." : `At least ${MIN_PASSWORD} characters. ${Math.max(0, MIN_PASSWORD - password.length)} to go.`}</span>
          </div>

          <div className="zb-sr-only" aria-hidden="true">
            <label htmlFor="su-website">Leave this field empty</label>
            <input id="su-website" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
          </div>

          {error && <p className="zb-error" role="alert"><IconAlert size={16} style={{ flexShrink: 0, marginTop: 2 }} /> <span style={{ whiteSpace: "pre-wrap" }}>{error}</span></p>}

          <button type="submit" className="zb-btn zb-btn--primary zb-btn--lg zb-btn--block" disabled={loading || config === null}>
            {loading ? "Creating your workspace…" : "Create my workspace"}
          </button>

          <p style={{ fontSize: 14, color: "var(--muted-fg)" }}>Already have an account? <Link to="/login">Log in</Link></p>
        </form>
      )}
      <ContactDialog request={contact} onClose={() => setContact(null)} />
    </AuthShell>
  );
}
