import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api, errorDetail } from "../api/client";
import AuthShell from "../components/AuthShell";
import { IconAlert } from "../components/icons";
import { useAuthStore } from "../store/authStore";

/** Where the link in the confirmation email lands: confirms the address and signs the person in. */
export function VerifyEmailPage() {
  const [params] = useSearchParams();
  const [error, setError] = useState("");
  const setToken = useAuthStore((s) => s.setToken);
  const navigate = useNavigate();
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;     // the link is posted once, even when React mounts twice in development
    started.current = true;
    const token = params.get("token");
    if (!token) {
      setError("This link is incomplete. Open it again from the email, or ask for a new one from the log in page.");
      return;
    }
    api.post("/auth/verify-email", { token })
      .then((res) => {
        setToken(res.data.access_token);
        navigate("/overview", { replace: true });
      })
      .catch((err: unknown) => setError(errorDetail(err, "This link could not be confirmed. Ask for a new one from the log in page.")));
  }, [params, setToken, navigate]);

  return (
    <AuthShell>
      <div className="zb-auth-form" aria-live="polite">
        {error ? (
          <>
            <h1>That link did not work</h1>
            <p className="zb-error" role="alert"><IconAlert size={16} style={{ flexShrink: 0, marginTop: 2 }} /> {error}</p>
            <Link to="/login" className="zb-btn zb-btn--primary zb-btn--lg">Go to log in</Link>
          </>
        ) : (
          <>
            <h1>Confirming your email</h1>
            <p style={{ color: "var(--muted-fg)" }}>One moment. Your workspace opens next.</p>
          </>
        )}
      </div>
    </AuthShell>
  );
}

/** Where Google sign-in returns to. The session arrives in the URL fragment, which no server ever sees. */
export function AuthCallbackPage() {
  const setToken = useAuthStore((s) => s.setToken);
  const navigate = useNavigate();

  useEffect(() => {
    const token = new URLSearchParams(window.location.hash.slice(1)).get("token");
    window.history.replaceState(null, "", window.location.pathname);   // take it out of the address bar and the history
    if (token) {
      setToken(token);
      navigate("/overview", { replace: true });
    } else {
      navigate("/login?google=failed", { replace: true });
    }
  }, [setToken, navigate]);

  return (
    <AuthShell>
      <div className="zb-auth-form" aria-live="polite">
        <h1>Signing you in</h1>
        <p style={{ color: "var(--muted-fg)" }}>One moment.</p>
      </div>
    </AuthShell>
  );
}
