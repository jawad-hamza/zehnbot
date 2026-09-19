import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { useAuthStore } from "../store/authStore";
import type { ClientListItem } from "../types";

export default function ClientsPage() {
  const [clients, setClients] = useState<ClientListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const isSuperadmin = useAuthStore((s) => s.me?.role === "superadmin");

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
        <h1 style={{ fontSize: 22, fontWeight: 700 }}>Bots</h1>
        <Link to="/bots/new" style={{ background: "var(--primary)", color: "var(--on-primary)", padding: "9px 20px", borderRadius: 8, textDecoration: "none", fontSize: 14, fontWeight: 600 }}>
          + New Bot
        </Link>
      </div>

      {loading && <p style={{ color: "var(--muted-fg)" }}>Loading…</p>}

      {!loading && clients.length === 0 && (
        <p style={{ color: "var(--muted-fg)" }}>No bots yet. Create your first one above.</p>
      )}

      {clients.map((c) => (
        <div key={c.id} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: "18px 22px", marginBottom: 12, display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ fontWeight: 600, fontSize: 15 }}>
              {c.name}
              {isSuperadmin && c.tenant_name && (
                <span style={{ marginLeft: 8, background: "var(--primary-soft)", color: "var(--primary-text)", padding: "1px 8px", borderRadius: 999, fontSize: 11, fontWeight: 600 }}>{c.tenant_name}</span>
              )}
            </div>
            <div style={{ color: "var(--muted-fg)", fontSize: 13 }}>
              {c.domain} &nbsp;·&nbsp; <code style={{ background: "var(--surface-3)", padding: "1px 6px", borderRadius: 4, fontSize: 12 }}>{c.client_id}</code>
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
                ...btnStyle(copiedId === c.id ? "var(--success-soft)" : "var(--primary-soft)", copiedId === c.id ? "var(--success)" : "var(--primary-text)"),
                border: "none",
                cursor: "pointer",
                fontFamily: "inherit",
              }}
              title="Copy <script> embed tag"
            >
              {copiedId === c.id ? "Copied" : "Copy Embed"}
            </button>
            {/* a plain link, not a router Link: preview.html is a separate static page outside the app */}
            <a href={`/preview.html?client_id=${encodeURIComponent(c.client_id)}`} target="_blank" rel="noopener" style={btnStyle("var(--accent-soft)", "var(--accent-text)")} title="See the real widget on a stand-in web page">Preview</a>
            <Link to={`/bots/${c.id}/test`} style={btnStyle("var(--accent-soft)", "var(--accent-text)")} title="Plain chat that also shows AI provider errors">Test</Link>
            <Link to={`/bots/${c.id}/edit`} style={btnStyle("var(--surface-3)", "var(--fg)")}>Edit</Link>
            <Link to={`/bots/${c.id}/knowledge`} style={btnStyle("var(--surface-3)", "var(--fg)")}>Knowledge</Link>
            <Link to={`/bots/${c.id}/conversations`} style={btnStyle("var(--surface-3)", "var(--fg)")}>Chats</Link>
            <Link to={`/bots/${c.id}/leads`} style={btnStyle("var(--surface-3)", "var(--fg)")}>Leads</Link>
            <Link to={`/bots/${c.id}/insights`} style={btnStyle("var(--primary-soft)", "var(--primary-text)")}>Insights</Link>
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
      title={active ? "Active. Click to deactivate" : "Inactive. Click to activate"}
      style={{
        position: "relative",
        width: 46,
        height: 24,
        borderRadius: 999,
        border: "none",
        background: active ? "var(--success)" : "var(--border-strong)",
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
          background: "var(--surface)",
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
