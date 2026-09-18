import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { api } from "../api/client";
import type { Conversation, Message } from "../types";

export default function ConversationsPage() {
  const { id } = useParams<{ id: string }>();
  const [convs, setConvs] = useState<Conversation[]>([]);
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get(`/admin/clients/${id}/conversations`).then((r) => {
      setConvs(r.data.items);
      setTotal(r.data.total);
      setLoading(false);
    });
  }, [id]);

  function openConversation(convId: string) {
    setSelected(convId);
    api.get(`/admin/conversations/${convId}/messages`).then((r) => setMessages(r.data));
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 24 }}>
        <Link to="/clients" style={{ color: "#64748b", textDecoration: "none", fontSize: 14 }}>← Clients</Link>
        <h1 style={{ fontSize: 20, fontWeight: 700 }}>Conversations ({total})</h1>
      </div>

      {loading && <p style={{ color: "#64748b" }}>Loading…</p>}

      <div style={{ display: "flex", gap: 24 }}>
        <div style={{ width: 320, flexShrink: 0 }}>
          {convs.map((c) => (
            <div
              key={c.id}
              onClick={() => openConversation(c.id)}
              style={{
                background: selected === c.id ? "#eff6ff" : "#fff",
                border: `1px solid ${selected === c.id ? "#93c5fd" : "#e2e8f0"}`,
                borderRadius: 10,
                padding: "12px 16px",
                marginBottom: 8,
                cursor: "pointer",
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 600, color: "#1e293b" }}>Session: {c.session_id.slice(0, 8)}…</div>
              <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 2 }}>
                {c.message_count} messages · {new Date(c.last_message_at).toLocaleDateString()}
              </div>
            </div>
          ))}
        </div>

        {selected && (
          <div style={{ flex: 1, background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: 20, maxHeight: 560, overflowY: "auto" }}>
            {messages.map((m) => (
              <div key={m.id} style={{ marginBottom: 12, display: "flex", flexDirection: "column", alignItems: m.role === "user" ? "flex-end" : "flex-start" }}>
                <div style={{
                  background: m.role === "user" ? "#2563eb" : "#f1f5f9",
                  color: m.role === "user" ? "#fff" : "#1e293b",
                  padding: "10px 14px",
                  borderRadius: 12,
                  maxWidth: "80%",
                  fontSize: 13,
                  lineHeight: 1.5,
                }}>
                  {m.content}
                </div>
                <span style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>{m.role} · {new Date(m.created_at).toLocaleTimeString()}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
