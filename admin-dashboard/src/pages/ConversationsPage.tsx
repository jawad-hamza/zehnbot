import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { api } from "../api/client";
import type { Conversation, Message } from "../types";

const PAGE_SIZE = 20;

export default function ConversationsPage() {
  const { id } = useParams<{ id: string }>();
  const [convs, setConvs] = useState<Conversation[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [searchBox, setSearchBox] = useState("");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);

  // Search as the owner types, but only once they pause
  useEffect(() => {
    const timer = setTimeout(() => { setQuery(searchBox.trim()); setPage(1); }, 300);
    return () => clearTimeout(timer);
  }, [searchBox]);

  useEffect(() => {
    let current = true;
    setLoading(true);
    api.get(`/admin/clients/${id}/conversations`, { params: { page, page_size: PAGE_SIZE, q: query || undefined } }).then((r) => {
      if (!current) return;   // a slower, older search must not overwrite a newer one
      setConvs(r.data.items);
      setTotal(r.data.total);
      setLoading(false);
    });
    return () => { current = false; };
  }, [id, page, query]);

  function openConversation(convId: string) {
    setSelected(convId);
    api.get(`/admin/conversations/${convId}/messages`).then((r) => setMessages(r.data));
  }

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pagerBtn = (disabled: boolean): React.CSSProperties => ({
    background: "var(--surface)", border: "1px solid var(--border-strong)", borderRadius: 6, padding: "4px 12px", fontSize: 12,
    cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.45 : 1, fontFamily: "inherit",
  });

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 20 }}>
        <Link to="/bots" style={{ color: "var(--muted-fg)", textDecoration: "none", fontSize: 14 }}>← Bots</Link>
        <h1 style={{ fontSize: 20, fontWeight: 700 }}>Conversations ({total})</h1>
      </div>

      <input
        type="search"
        value={searchBox}
        onChange={(e) => setSearchBox(e.target.value)}
        placeholder="Search what visitors and the bot said…"
        aria-label="Search conversations"
        maxLength={200}
        style={{ width: 320, padding: "9px 12px", border: "1px solid var(--border-strong)", borderRadius: 8, fontSize: 13, outline: "none", marginBottom: 14, fontFamily: "inherit" }}
      />

      <div style={{ display: "flex", gap: 24 }}>
        <div style={{ width: 320, flexShrink: 0, opacity: loading ? 0.5 : 1, transition: "opacity 0.15s" }}>
          {!loading && convs.length === 0 && (
            <p style={{ color: "var(--muted-fg)", fontSize: 13 }}>{query ? `No conversation mentions "${query}".` : "No conversations yet."}</p>
          )}
          {convs.map((c) => (
            <div
              key={c.id}
              onClick={() => openConversation(c.id)}
              style={{
                background: selected === c.id ? "var(--primary-soft)" : "var(--surface)",
                border: `1px solid ${selected === c.id ? "var(--primary-border)" : "var(--border)"}`,
                borderRadius: 10,
                padding: "12px 16px",
                marginBottom: 8,
                cursor: "pointer",
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 600, color: "var(--fg)" }}>Session: {c.session_id.slice(0, 8)}…</div>
              <div style={{ fontSize: 12, color: "var(--subtle-fg)", marginTop: 2 }}>
                {c.message_count} messages · {new Date(c.last_message_at).toLocaleDateString()}
              </div>
            </div>
          ))}
          {pages > 1 && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 6, fontSize: 12, color: "var(--muted-fg)" }}>
              <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)} style={pagerBtn(page <= 1)}>Newer</button>
              <span>Page {page} of {pages}</span>
              <button type="button" disabled={page >= pages} onClick={() => setPage(page + 1)} style={pagerBtn(page >= pages)}>Older</button>
            </div>
          )}
        </div>

        {selected && (
          <div style={{ flex: 1, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: 20, maxHeight: 560, overflowY: "auto" }}>
            {messages.map((m) => (
              <div key={m.id} style={{ marginBottom: 12, display: "flex", flexDirection: "column", alignItems: m.role === "user" ? "flex-end" : "flex-start" }}>
                <div style={{
                  background: m.role === "user" ? "var(--primary)" : "var(--surface-3)",
                  color: m.role === "user" ? "var(--on-primary)" : "var(--fg)",
                  padding: "10px 14px",
                  borderRadius: 12,
                  maxWidth: "80%",
                  fontSize: 13,
                  lineHeight: 1.5,
                  whiteSpace: "pre-wrap",
                  overflowWrap: "anywhere",
                }}>
                  {m.content}
                </div>
                <span style={{ fontSize: 11, color: "var(--subtle-fg)", marginTop: 2 }}>
                  {m.role} · {new Date(m.created_at).toLocaleTimeString()}
                  {m.unanswered && (
                    <span style={{ marginLeft: 6, background: "var(--warning-soft)", color: "var(--warning)", padding: "1px 7px", borderRadius: 999, fontWeight: 600 }}>
                      couldn't answer
                    </span>
                  )}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
