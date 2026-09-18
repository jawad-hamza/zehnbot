import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, errorDetail } from "../api/client";
import { useAuthStore } from "../store/authStore";

const inputStyle: React.CSSProperties = { padding: "10px 14px", border: "1px solid #cbd5e1", borderRadius: 8, fontSize: 14, outline: "none" };

export default function SignupPage() {
  const [company, setCompany] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const setToken = useAuthStore((s) => s.setToken);
  const navigate = useNavigate();

  useEffect(() => {
    api.get("/auth/config").then((r) => setAllowed(!!r.data.allow_signup)).catch(() => setAllowed(false));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await api.post("/auth/signup", { company_name: company, email, password });
      setToken(res.data.access_token);
      navigate("/clients");
    } catch (err: unknown) {
      setError(errorDetail(err, "Could not create the account."));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f1f5f9" }}>
      <div style={{ background: "#fff", padding: 40, borderRadius: 16, boxShadow: "0 4px 24px rgba(0,0,0,0.08)", width: 380 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8, color: "#1e293b" }}>Create your account</h1>
        {allowed === false ? (
          <p style={{ fontSize: 14, color: "#64748b", margin: "16px 0" }}>Sign-up is currently closed. Please contact us for an account.</p>
        ) : (
          <>
            <p style={{ fontSize: 13, color: "#64748b", marginBottom: 20 }}>Set up an AI assistant for your website in a few minutes.</p>
            <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Company name" required minLength={2} autoComplete="organization" style={inputStyle} />
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Work email" required autoComplete="email" style={inputStyle} />
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password (at least 10 characters)" required minLength={10} autoComplete="new-password" style={inputStyle} />
              {error && <p style={{ color: "#dc2626", fontSize: 13, whiteSpace: "pre-wrap" }}>{error}</p>}
              <button
                type="submit"
                disabled={loading || allowed === null}
                style={{ background: "#2563eb", color: "#fff", border: "none", borderRadius: 8, padding: "11px", fontSize: 15, fontWeight: 600, cursor: "pointer", opacity: loading ? 0.7 : 1 }}
              >
                {loading ? "Creating…" : "Create account"}
              </button>
            </form>
          </>
        )}
        <p style={{ fontSize: 13, color: "#64748b", marginTop: 18, textAlign: "center" }}>
          Already have an account? <Link to="/login" style={{ color: "#2563eb", textDecoration: "none", fontWeight: 600 }}>Sign in</Link>
        </p>
      </div>
    </div>
  );
}
