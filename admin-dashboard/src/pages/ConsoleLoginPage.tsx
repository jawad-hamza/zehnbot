import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { api, errorDetail } from "../api/client";
import AuthShell, { PasswordField } from "../components/AuthShell";
import { IconAlert } from "../components/icons";
import { useAuthStore } from "../store/authStore";

/**
 * The operator console's own sign-in, at a route nothing public links to. Customers log in at /login,
 * which refuses operator accounts (and this page refuses customer accounts) with the same answer as a
 * wrong password. No sign-up, no Google, no marketing panel.
 */
export default function ConsoleLoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const signedIn = useAuthStore((s) => !!s.token && s.kind === "operator");
  const setToken = useAuthStore((s) => s.setToken);
  const navigate = useNavigate();

  if (signedIn) return <Navigate to="/overview" replace />;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await api.post("/auth/login", { email, password, console: true });
      setToken(res.data.access_token, "operator");
      navigate("/overview");
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      setError(status === 401 ? "Those details don't match." : errorDetail(err, "Could not sign in. Please try again."));
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell plain>
      <form className="zb-auth-form" onSubmit={handleSubmit}>
        <h1>Sign in</h1>
        <div className="zb-field">
          <label className="zb-label" htmlFor="console-email">Username</label>
          <input id="console-email" className="zb-input" type="text" value={email} onChange={(e) => setEmail(e.target.value)}
            required autoComplete="username" autoCapitalize="none" spellCheck={false} aria-invalid={!!error || undefined} />
        </div>
        <PasswordField id="console-password" label="Password" value={password} onChange={setPassword} autoComplete="current-password"
          invalid={!!error} describedBy={error ? "console-error" : undefined} />
        {error && <p id="console-error" className="zb-error" role="alert"><IconAlert size={16} style={{ flexShrink: 0, marginTop: 2 }} /> {error}</p>}
        <button type="submit" className="zb-btn zb-btn--primary zb-btn--lg zb-btn--block" disabled={loading}>{loading ? "Signing in…" : "Sign in"}</button>
      </form>
    </AuthShell>
  );
}
