import { useEffect, useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { api, errorDetail } from "../api/client";
import ClientForm from "../components/ClientForm";
import { useAuthStore } from "../store/authStore";
import type { Client, ClientPayload, Tenant } from "../types";

export default function ClientEditPage() {
  const { id } = useParams<{ id: string }>();
  const isNew = !id;
  const navigate = useNavigate();
  const isSuperadmin = useAuthStore((s) => s.me?.role === "superadmin");
  const [client, setClient] = useState<Client | null>(null);
  const [tenants, setTenants] = useState<Tenant[] | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!isNew) {
      api.get(`/admin/clients/${id}`).then((r) => setClient(r.data));
    }
  }, [id, isNew]);

  // The super admin has no tenant of their own, so must say whose bot this is
  useEffect(() => {
    if (isNew && isSuperadmin) {
      api.get("/admin/tenants").then((r) => setTenants(r.data));
    }
  }, [isNew, isSuperadmin]);

  async function handleSubmit(data: ClientPayload) {
    setLoading(true);
    setError("");
    try {
      if (isNew) {
        await api.post("/admin/clients", data);
      } else {
        await api.put(`/admin/clients/${id}`, data);
      }
      navigate("/clients");
    } catch (err: unknown) {
      setError(errorDetail(err, "Failed to save the bot."));
      window.scrollTo({ top: 0, behavior: "smooth" });
    } finally {
      setLoading(false);
    }
  }

  if (!isNew && !client) return <p style={{ color: "#64748b" }}>Loading…</p>;

  const snippet = client
    ? `<script src="${window.location.origin}/static/widget.js?client_id=${client.client_id}" defer></script>`
    : "";

  async function copySnippet() {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked */
    }
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 28 }}>
        <Link to="/clients" style={{ color: "#64748b", textDecoration: "none", fontSize: 14 }}>← Bots</Link>
        <h1 style={{ fontSize: 20, fontWeight: 700 }}>{isNew ? "New Bot" : `Edit — ${client?.name}`}</h1>
      </div>
      {error && <p style={{ color: "#dc2626", marginBottom: 16, fontSize: 13, whiteSpace: "pre-wrap" }}>{error}</p>}

      {!isNew && client && (
        <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 12, padding: "16px 20px", marginBottom: 24, maxWidth: 560 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: "#334155" }}>Embed code</span>
            <button
              onClick={copySnippet}
              style={{
                background: copied ? "#dcfce7" : "#2563eb",
                color: copied ? "#16a34a" : "#fff",
                border: "none",
                padding: "6px 14px",
                borderRadius: 6,
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              {copied ? "✓ Copied" : "Copy"}
            </button>
          </div>
          <code style={{ display: "block", background: "#fff", padding: "10px 12px", borderRadius: 6, fontSize: 12, color: "#1e293b", wordBreak: "break-all", border: "1px solid #e2e8f0" }}>
            {snippet}
          </code>
          <div style={{ fontSize: 12, color: "#64748b", marginTop: 8 }}>
            Paste this into the <code>&lt;head&gt;</code> or before <code>&lt;/body&gt;</code> on {client.domain}.
          </div>
        </div>
      )}

      <ClientForm
        initial={client ?? {}}
        onSubmit={handleSubmit}
        loading={loading}
        submitLabel={isNew ? "Create Bot" : "Save Changes"}
        tenants={tenants}
      />
    </div>
  );
}
