import { useEffect, useState } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { api, errorDetail } from "../api/client";
import { CheckInbox, GoogleButton } from "../components/AuthExtras";
import AuthShell, { PasswordField } from "../components/AuthShell";
import { IconAlert } from "../components/icons";
import { useAuthStore } from "../store/authStore";

// What the server reports when a Google sign-in did not end in a session
const GOOGLE_PROBLEMS: Record<string, string> = {
  cancelled: "Google sign-in was cancelled. You can try again, or log in with your password.",
  failed: "Google sign-in did not complete. Please try again.",
  "no-account": "There is no ZehnBot account for that Google address, and sign-up is closed at the moment.",
  suspended: "This account is suspended. Contact the Zehnox team.",
};

export default function LoginPage() {
  const [params] = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(GOOGLE_PROBLEMS[params.get("google") ?? ""] ?? "");
  const [loading, setLoading] = useState(false);
  const [unverified, setUnverified] = useState(false);
  const [config, setConfig] = useState({ allowSignup: false, google: false });
  const token = useAuthStore((s) => s.token);
  const setToken = useAuthStore((s) => s.setToken);
  const navigate = useNavigate();

  useEffect(() => {
    api.get("/auth/config").then((r) => setConfig({ allowSignup: !!r.data.allow_signup || !!r.data.google_signup, google: !!r.data.google_enabled })).catch(() => undefined);
  }, []);

  if (token) return <Navigate to="/overview" replace />;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await api.post("/auth/login", { email, password });
      setToken(res.data.access_token);
      navigate("/overview");
    } catch (err: unknown) {
      const response = (err as { response?: { status?: number; headers?: Record<string, string> } })?.response;
      if (response?.headers?.["x-auth-reason"] === "email-unverified") {
        setUnverified(true);   // right password, address not confirmed yet
        return;
      }
      // 401 stays deliberately vague; lockouts and suspensions explain themselves
      setError(response?.status === 401 ? "That email and password don't match. Check both and try again." : errorDetail(err, "Could not sign in. Please try again."));
    } finally {
      setLoading(false);
    }
  }

  if (unverified) return <AuthShell><CheckInbox email={email.trim()} onBack={() => setUnverified(false)} /></AuthShell>;

  return (
    <AuthShell>
      <form className="zb-auth-form" onSubmit={handleSubmit} noValidate={false}>
        <div>
          <h1>Log in</h1>
          <p style={{ color: "var(--muted-fg)", marginTop: 6 }}>Welcome back.</p>
        </div>

        {config.google && <GoogleButton />}

        <div className="zb-field">
          <label className="zb-label" htmlFor="login-email">Email or username</label>
          <input id="login-email" className="zb-input" type="text" value={email} onChange={(e) => setEmail(e.target.value)}
            required autoComplete="username" autoCapitalize="none" spellCheck={false} aria-invalid={!!error || undefined} />
        </div>
        <PasswordField id="login-password" label="Password" value={password} onChange={setPassword} autoComplete="current-password"
          invalid={!!error} describedBy={error ? "login-error" : undefined} />

        {error && <p id="login-error" className="zb-error" role="alert"><IconAlert size={16} style={{ flexShrink: 0, marginTop: 2 }} /> {error}</p>}

        <button type="submit" className="zb-btn zb-btn--primary zb-btn--lg zb-btn--block" disabled={loading}>
          {loading ? "Logging in…" : "Log in"}
        </button>

        <p style={{ fontSize: 14, color: "var(--muted-fg)" }}>
          {config.allowSignup
            ? <>No account yet? <Link to="/signup">Start free</Link></>
            : <>Forgot your password? Ask the person who manages your account to reset it.</>}
        </p>
      </form>
    </AuthShell>
  );
}
