import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, errorDetail } from "../api/client";
import { useAuthStore } from "../store/authStore";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [allowSignup, setAllowSignup] = useState(false);
  const setToken = useAuthStore((s) => s.setToken);
  const navigate = useNavigate();

  useEffect(() => {
    api.get("/auth/config").then((r) => setAllowSignup(!!r.data.allow_signup)).catch(() => undefined);
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await api.post("/auth/login", { email, password });
      setToken(res.data.access_token);
      navigate("/clients");
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      // 401 stays deliberately vague; lockouts and suspensions explain themselves
      setError(status === 401 ? "Invalid email or password." : errorDetail(err, "Could not sign in. Please try again."));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f1f5f9" }}>
      <div style={{ background: "#fff", padding: 40, borderRadius: 16, boxShadow: "0 4px 24px rgba(0,0,0,0.08)", width: 380 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 24, color: "#1e293b" }}>ChatBot Admin</h1>
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <input
            type="text"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email or username"
            required
            autoComplete="username"
            style={{ padding: "10px 14px", border: "1px solid #cbd5e1", borderRadius: 8, fontSize: 14, outline: "none" }}
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            required
            autoComplete="current-password"
            style={{ padding: "10px 14px", border: "1px solid #cbd5e1", borderRadius: 8, fontSize: 14, outline: "none" }}
          />
          {error && <p style={{ color: "#dc2626", fontSize: 13 }}>{error}</p>}
          <button
            type="submit"
            disabled={loading}
            style={{ background: "#2563eb", color: "#fff", border: "none", borderRadius: 8, padding: "11px", fontSize: 15, fontWeight: 600, cursor: "pointer", opacity: loading ? 0.7 : 1 }}
          >
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>
        {allowSignup && (
          <p style={{ fontSize: 13, color: "#64748b", marginTop: 18, textAlign: "center" }}>
            New here? <Link to="/signup" style={{ color: "#2563eb", textDecoration: "none", fontWeight: 600 }}>Create an account</Link>
          </p>
        )}
      </div>
    </div>
  );
}
