import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import type { ClientListItem } from "../types";

export default function ClientsPage() {
  const [clients, setClients] = useState<ClientListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  useEffect(() => {
    api.get("/admin/clients").then((r) => { setClients(r.data); setLoading(false); });
  }, []);

  function embedSnippet(clientId: string) {
    return `<script src="${window.location.origin}/static/widget.js?client_id=${clientId}" defer></script>`;
  }

  async function copyEmbed(c: ClientListItem) {
    try {
      await navigator.clipboard.writeText(embedSnippet(c.client_id));
      setCopiedId(c.id);
      setTimeout(() => setCopiedId((curr) => (curr === c.id ? null : curr)), 1500);
    } catch {
      /* clipboard blocked */
    }
  }

  async function toggleActive(c: ClientListItem) {
    setTogglingId(c.id);
    try {
      const res = await api.put(`/admin/clients/${c.id}`, { is_active: !c.is_active });
      setClients((list) => list.map((x) => (x.id === c.id ? { ...x, is_active: res.data.is_active } : x)));
    } finally {
      setTogglingId(null);
    }
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700 }}>Clients</h1>
        <Link to="/clients/new" style={{ background: "#2563eb", color: "#fff", padding: "9px 20px", borderRadius: 8, textDecoration: "none", fontSize: 14, fontWeight: 600 }}>
          + New Client
        </Link>
      </div>

      {loading && <p style={{ color: "#64748b" }}>Loading…</p>}

      {!loading && clients.length === 0 && (
        <p style={{ color: "#64748b" }}>No clients yet. Create your first one above.</p>
      )}

      {clients.map((c) => (
        <div key={c.id} style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: "18px 22px", marginBottom: 12, display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ fontWeight: 600, fontSize: 15 }}>{c.name}</div>
            <div style={{ color: "#64748b", fontSize: 13 }}>
              {c.domain} &nbsp;·&nbsp; <code style={{ background: "#f1f5f9", padding: "1px 6px", borderRadius: 4, fontSize: 12 }}>{c.client_id}</code>
            </div>
          </div>

          <ToggleSwitch
            active={c.is_active}
            disabled={togglingId === c.id}
            onClick={() => toggleActive(c)}
          />

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              onClick={() => copyEmbed(c)}
              style={{
                ...btnStyle(copiedId === c.id ? "#dcfce7" : "#dbeafe", copiedId === c.id ? "#16a34a" : "#1d4ed8"),
                border: "none",
                cursor: "pointer",
                fontFamily: "inherit",
              }}
              title="Copy <script> embed tag"
            >
              {copiedId === c.id ? "✓ Copied" : "Copy Embed"}
            </button>
            <Link to={`/clients/${c.id}/test`} style={btnStyle("#f0fdfa", "#0f766e")}>Test</Link>
            <Link to={`/clients/${c.id}/edit`} style={btnStyle("#f1f5f9", "#1e293b")}>Edit</Link>
            <Link to={`/clients/${c.id}/knowledge`} style={btnStyle("#f1f5f9", "#1e293b")}>Knowledge</Link>
            <Link to={`/clients/${c.id}/conversations`} style={btnStyle("#f1f5f9", "#1e293b")}>Chats</Link>
            <Link to={`/clients/${c.id}/leads`} style={btnStyle("#f1f5f9", "#1e293b")}>Leads</Link>
          </div>
        </div>
      ))}
    </div>
  );
}

function ToggleSwitch({ active, disabled, onClick }: { active: boolean; disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={active ? "Active — click to deactivate" : "Inactive — click to activate"}
      style={{
        position: "relative",
        width: 46,
        height: 24,
        borderRadius: 999,
        border: "none",
        background: active ? "#16a34a" : "#cbd5e1",
        cursor: disabled ? "wait" : "pointer",
        padding: 0,
        flexShrink: 0,
        transition: "background 0.15s",
        opacity: disabled ? 0.6 : 1,
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 2,
          left: active ? 24 : 2,
          width: 20,
          height: 20,
          borderRadius: "50%",
          background: "#fff",
          boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
          transition: "left 0.15s",
        }}
      />
    </button>
  );
}

function btnStyle(bg: string, color: string): React.CSSProperties {
  return { background: bg, color, padding: "6px 14px", borderRadius: 6, textDecoration: "none", fontSize: 13, fontWeight: 500, whiteSpace: "nowrap", display: "inline-block" };
}
