import { useState } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { api, errorDetail } from "../api/client";
import AuthShell, { PasswordField } from "../components/AuthShell";
import { IconAlert, IconCheck } from "../components/icons";
import { useAuthStore } from "../store/authStore";

/** Step one: ask for the link. The answer is the same whether or not the address has a login. */
export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      await api.post("/auth/forgot-password", { email });
      setSent(true);
    } catch (err: unknown) {
      setError(errorDetail(err, "Could not send the link just now. Please try again."));
    } finally {
      setLoading(false);
    }
  }

  if (sent) {
    return (
      <AuthShell>
        <div className="zb-auth-form" aria-live="polite">
          <h1>Check your inbox</h1>
          <p style={{ color: "var(--muted-fg)" }}>
            If <strong>{email.trim()}</strong> has a ZehnBot login, a link to choose a new password is on its way.
            It works for one hour, once. Look in your spam folder too.
          </p>
          <Link to="/login" className="zb-btn zb-btn--primary zb-btn--lg">Back to log in</Link>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <form className="zb-auth-form" onSubmit={handleSubmit}>
        <div>
          <h1>Forgot your password?</h1>
          <p style={{ color: "var(--muted-fg)", marginTop: 6 }}>Tell us your email address and we will send you a link to choose a new one.</p>
        </div>
        <div className="zb-field">
          <label className="zb-label" htmlFor="forgot-email">Email</label>
          <input id="forgot-email" className="zb-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)}
            required autoComplete="email" autoCapitalize="none" spellCheck={false} aria-invalid={!!error || undefined} />
        </div>
        {error && <p className="zb-error" role="alert"><IconAlert size={16} style={{ flexShrink: 0, marginTop: 2 }} /> {error}</p>}
        <button type="submit" className="zb-btn zb-btn--primary zb-btn--lg zb-btn--block" disabled={loading}>
          {loading ? "Sending…" : "Send me a link"}
        </button>
        <p style={{ fontSize: 14, color: "var(--muted-fg)" }}>Remembered it? <Link to="/login">Log in</Link></p>
      </form>
    </AuthShell>
  );
}

/** Step two: where the emailed link lands. Sets the new password and signs the customer in. */
export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get("token");
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const setToken = useAuthStore((s) => s.setToken);
  const signedIn = useAuthStore((s) => !!s.token && s.kind === "tenant");
  const navigate = useNavigate();

  if (signedIn) return <Navigate to="/overview" replace />;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== again) {
      setError("The two passwords are not the same.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await api.post("/auth/reset-password", { token, new_password: password });
      setToken(res.data.access_token, "tenant");
      navigate("/overview", { replace: true });
    } catch (err: unknown) {
      setError(errorDetail(err, "That did not work. Ask for a new link from the log in page."));
    } finally {
      setLoading(false);
    }
  }

  if (!token) {
    return (
      <AuthShell>
        <div className="zb-auth-form">
          <h1>That link is incomplete</h1>
          <p className="zb-error" role="alert"><IconAlert size={16} style={{ flexShrink: 0, marginTop: 2 }} /> Open it again from the email, or ask for a new one.</p>
          <Link to="/forgot-password" className="zb-btn zb-btn--primary zb-btn--lg">Ask for a new link</Link>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <form className="zb-auth-form" onSubmit={handleSubmit}>
        <div>
          <h1>Choose a new password</h1>
          <p style={{ color: "var(--muted-fg)", marginTop: 6 }}>At least 10 characters. Everywhere you are signed in now will be signed out.</p>
        </div>
        <PasswordField id="reset-password" label="New password" value={password} onChange={setPassword} autoComplete="new-password" invalid={!!error} />
        <PasswordField id="reset-password-again" label="New password again" value={again} onChange={setAgain} autoComplete="new-password" invalid={!!error} />
        {error && <p className="zb-error" role="alert"><IconAlert size={16} style={{ flexShrink: 0, marginTop: 2 }} /> {error}</p>}
        <button type="submit" className="zb-btn zb-btn--primary zb-btn--lg zb-btn--block" disabled={loading || password.length < 10}>
          {loading ? "Saving…" : <><IconCheck size={16} /> Set my new password</>}
        </button>
        <p style={{ fontSize: 14, color: "var(--muted-fg)" }}>Changed your mind? <Link to="/login">Log in</Link></p>
      </form>
    </AuthShell>
  );
}
