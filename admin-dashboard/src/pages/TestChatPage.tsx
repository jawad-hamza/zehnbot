import { useEffect, useRef, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { api, errorDetail } from "../api/client";
import type { Client } from "../types";

type Msg = { role: "user" | "assistant"; content: string };

export default function TestChatPage() {
  const { id } = useParams<{ id: string }>();
  const [client, setClient] = useState<Client | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const sessionRef = useRef<string>(`test-${crypto.randomUUID()}`);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.get(`/admin/clients/${id}`).then((r) => {
      setClient(r.data);
      setMessages([{ role: "assistant", content: r.data.welcome_message }]);
    });
  }, [id]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || !client) return;
    setInput("");
    setError("");
    const next = [...messages, { role: "user" as const, content: text }];
    setMessages(next);
    setLoading(true);
    try {
      // Authenticated owner endpoint: works from the dashboard regardless of the bot's domain,
      // and reports provider errors (bad key, unknown model) that visitors never see.
      const res = await api.post(`/admin/clients/${id}/test-chat`, {
        session_id: sessionRef.current,
        message: text,
      });
      setMessages([...next, { role: "assistant", content: res.data.reply }]);
    } catch (err: unknown) {
      setError(errorDetail(err, "Request failed"));
    } finally {
      setLoading(false);
    }
  }

  function resetConversation() {
    sessionRef.current = `test-${crypto.randomUUID()}`;
    setMessages(client ? [{ role: "assistant", content: client.welcome_message }] : []);
    setError("");
  }

  if (!client) return <p style={{ color: "#64748b" }}>Loading…</p>;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 20 }}>
        <Link to="/clients" style={{ color: "#64748b", textDecoration: "none", fontSize: 14 }}>← Bots</Link>
        <h1 style={{ fontSize: 20, fontWeight: 700 }}>Test — {client.name}</h1>
        <span style={{ fontSize: 12, color: "#64748b", background: "#f1f5f9", padding: "2px 10px", borderRadius: 999 }}>
          {/* without its own key the bot's provider settings are not used: the platform's AI answers */}
          {client.ai_api_key_set ? `${client.ai_provider}${client.ai_model ? ` · ${client.ai_model}` : ""}` : "platform AI"}
        </span>
        <button
          onClick={resetConversation}
          style={{ marginLeft: "auto", background: "none", border: "1px solid #cbd5e1", color: "#475569", padding: "6px 14px", borderRadius: 6, cursor: "pointer", fontSize: 13 }}
        >
          New conversation
        </button>
      </div>

      <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, maxWidth: 720, height: 560, display: "flex", flexDirection: "column" }}>
        <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: 18, display: "flex", flexDirection: "column", gap: 10 }}>
          {messages.map((m, i) => (
            <div key={i} style={{ display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start" }}>
              <div style={{
                maxWidth: "78%",
                padding: "9px 14px",
                borderRadius: 14,
                background: m.role === "user" ? (client.theme_color || "#2563eb") : "#f1f5f9",
                color: m.role === "user" ? "#fff" : "#1e293b",
                fontSize: 14,
                lineHeight: 1.45,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}>{m.content}</div>
            </div>
          ))}
          {loading && (
            <div style={{ display: "flex", justifyContent: "flex-start" }}>
              <div style={{ padding: "9px 14px", borderRadius: 14, background: "#f1f5f9", color: "#64748b", fontSize: 14 }}>…</div>
            </div>
          )}
          {error && (
            <div style={{ background: "#fef2f2", border: "1px solid #fecaca", color: "#b91c1c", padding: "8px 12px", borderRadius: 8, fontSize: 12, marginTop: 4 }}>
              {error}
            </div>
          )}
        </div>

        <form onSubmit={handleSend} style={{ borderTop: "1px solid #e2e8f0", padding: 12, display: "flex", gap: 8 }}>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type a message…"
            style={{ flex: 1, padding: "10px 14px", border: "1px solid #cbd5e1", borderRadius: 8, fontSize: 14, outline: "none" }}
            disabled={loading}
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            style={{ background: client.theme_color || "#2563eb", color: "#fff", border: "none", borderRadius: 8, padding: "10px 22px", fontSize: 14, fontWeight: 600, cursor: "pointer", opacity: loading || !input.trim() ? 0.6 : 1 }}
          >
            Send
          </button>
        </form>
      </div>
    </div>
  );
}
