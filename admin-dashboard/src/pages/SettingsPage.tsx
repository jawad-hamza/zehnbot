import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";

const field: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 4 };
const label: React.CSSProperties = { fontSize: 13, fontWeight: 600, color: "#475569" };
const input: React.CSSProperties = {
  padding: "9px 12px",
  border: "1px solid #cbd5e1",
  borderRadius: 8,
  fontSize: 14,
  outline: "none",
  fontFamily: "inherit",
};

export default function SettingsPage() {
  const [currentEmail, setCurrentEmail] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  useEffect(() => {
    api.get("/auth/me").then((r) => {
      setCurrentEmail(r.data.email);
      setNewEmail(r.data.email);
    });
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMsg(null);
    try {
      await api.post("/auth/change-credentials", {
        current_password: currentPassword,
        new_email: newEmail !== currentEmail ? newEmail : undefined,
        new_password: newPassword || undefined,
      });
      setCurrentEmail(newEmail);
      setCurrentPassword("");
      setNewPassword("");
      setMsg({ type: "ok", text: "Credentials updated successfully." });
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setMsg({ type: "err", text: detail || "Failed to update credentials." });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 24 }}>
        <Link to="/clients" style={{ color: "#64748b", textDecoration: "none", fontSize: 14 }}>← Clients</Link>
        <h1 style={{ fontSize: 20, fontWeight: 700 }}>Account Settings</h1>
      </div>

      <div style={{ maxWidth: 480, background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: 28 }}>
        <p style={{ fontSize: 13, color: "#64748b", marginBottom: 20 }}>
          Current username: <strong style={{ color: "#1e293b" }}>{currentEmail || "…"}</strong>
        </p>

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={field}>
            <label style={label}>Current Password *</label>
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
              style={input}
              autoComplete="current-password"
            />
          </div>

          <div style={{ borderTop: "1px solid #f1f5f9", paddingTop: 16 }} />

          <div style={field}>
            <label style={label}>New Username</label>
            <input
              type="text"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              style={input}
              autoComplete="off"
            />
          </div>

          <div style={field}>
            <label style={label}>New Password (leave blank to keep current)</label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              style={input}
              minLength={4}
              autoComplete="new-password"
              placeholder="At least 4 characters"
            />
          </div>

          {msg && (
            <p style={{ fontSize: 13, color: msg.type === "ok" ? "#16a34a" : "#dc2626" }}>
              {msg.text}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              background: "#2563eb",
              color: "#fff",
              border: "none",
              borderRadius: 8,
              padding: "10px 24px",
              cursor: "pointer",
              fontSize: 14,
              fontWeight: 600,
              alignSelf: "flex-start",
              opacity: loading ? 0.6 : 1,
            }}
          >
            {loading ? "Saving…" : "Update Credentials"}
          </button>
        </form>
      </div>
    </div>
  );
}
