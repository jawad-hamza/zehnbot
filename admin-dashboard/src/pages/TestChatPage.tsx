import { useEffect, useRef, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { api, errorDetail } from "../api/client";
import type { Client } from "../types";

// `note` tells the owner what happened behind the reply: things a visitor would see as widget behaviour
type Msg = { role: "user" | "assistant"; content: string; note?: { kind: "lead" | "form"; text: string } };

export default function TestChatPage() {
  const { id } = useParams<{ id: string }>();
  const [client, setClient] = useState<Client | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const sessionRef = useRef<string>(`test-${crypto.randomUUID()}`);
  const scrollRef = useRef<HTMLDivElement>(null);
  const leadNoted = useRef(false);

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
      let note: Msg["note"];
      if (res.data.lead_captured && !leadNoted.current) {
        leadNoted.current = true;
        note = { kind: "lead", text: "Lead captured from this chat. It is on the Leads page now (the name is added as soon as the visitor gives it)." };
      } else if (res.data.show_lead_form && !res.data.lead_captured) {
        note = { kind: "form", text: "On your website, the widget opens its contact form at this point." };
      }
      setMessages([...next, { role: "assistant", content: res.data.reply, note }]);
    } catch (err: unknown) {
      setError(errorDetail(err, "Request failed"));
    } finally {
      setLoading(false);
    }
  }

  function resetConversation() {
    sessionRef.current = `test-${crypto.randomUUID()}`;
    leadNoted.current = false;
    setMessages(client ? [{ role: "assistant", content: client.welcome_message }] : []);
    setError("");
  }

  if (!client) return <p style={{ color: "var(--muted-fg)" }}>Loading…</p>;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 20 }}>
        <Link to="/bots" style={{ color: "var(--muted-fg)", textDecoration: "none", fontSize: 14 }}>← Bots</Link>
        <h1 style={{ fontSize: 20, fontWeight: 700 }}>Test {client.name}</h1>
        <span style={{ fontSize: 12, color: "var(--muted-fg)", background: "var(--surface-3)", padding: "2px 10px", borderRadius: 999 }}>
          {/* without its own key the bot's provider settings are not used: the platform's AI answers */}
          {client.ai_api_key_set ? `${client.ai_provider}${client.ai_model ? ` · ${client.ai_model}` : ""}` : "platform AI"}
        </span>
        <button
          onClick={resetConversation}
          style={{ marginLeft: "auto", background: "none", border: "1px solid var(--border-strong)", color: "var(--fg-2)", padding: "6px 14px", borderRadius: 6, cursor: "pointer", fontSize: 13 }}
        >
          New conversation
        </button>
      </div>

      <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, maxWidth: 720, height: 560, display: "flex", flexDirection: "column" }}>
        <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: 18, display: "flex", flexDirection: "column", gap: 10 }}>
          {messages.map((m, i) => (
            <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: m.role === "user" ? "flex-end" : "flex-start", gap: 4 }}>
              <div style={{
                maxWidth: "78%",
                padding: "9px 14px",
                borderRadius: 14,
                background: m.role === "user" ? (client.theme_color || "var(--primary)") : "var(--surface-3)",
                color: m.role === "user" ? "var(--on-primary)" : "var(--fg)",
                fontSize: 14,
                lineHeight: 1.45,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}>{m.content}</div>
              {m.note && (
                <div style={{
                  fontSize: 12, padding: "5px 10px", borderRadius: 8, maxWidth: "78%",
                  background: m.note.kind === "lead" ? "var(--success-soft)" : "var(--primary-soft)",
                  color: m.note.kind === "lead" ? "var(--success)" : "var(--primary-text)",
                }}>
                  {m.note.text}
                  {m.note.kind === "lead" && <> <Link to={`/bots/${id}/leads`} style={{ color: "inherit", fontWeight: 600 }}>Open Leads</Link></>}
                </div>
              )}
            </div>
          ))}
          {loading && (
            <div style={{ display: "flex", justifyContent: "flex-start" }}>
              <div style={{ padding: "9px 14px", borderRadius: 14, background: "var(--surface-3)", color: "var(--muted-fg)", fontSize: 14 }}>…</div>
            </div>
          )}
          {error && (
            <div style={{ background: "var(--danger-soft)", border: "1px solid var(--danger-border)", color: "var(--danger)", padding: "8px 12px", borderRadius: 8, fontSize: 12, marginTop: 4 }}>
              {error}
            </div>
          )}
        </div>

        <form onSubmit={handleSend} style={{ borderTop: "1px solid var(--border)", padding: 12, display: "flex", gap: 8, alignItems: "flex-end" }}>
          {/* same keys as the widget: Enter sends, Shift+Enter starts a new line */}
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                e.currentTarget.form?.requestSubmit();
              }
            }}
            rows={Math.min(5, Math.max(1, input.split("\n").length))}
            maxLength={2000}
            placeholder="Type a message…  (Shift+Enter for a new line)"
            style={{ flex: 1, padding: "10px 14px", border: "1px solid var(--border-strong)", borderRadius: 8, fontSize: 14, outline: "none", resize: "none", fontFamily: "inherit", lineHeight: 1.4 }}
            disabled={loading}
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            style={{ background: client.theme_color || "var(--primary)", color: "var(--on-primary)", border: "none", borderRadius: 8, padding: "10px 22px", fontSize: 14, fontWeight: 600, cursor: "pointer", opacity: loading || !input.trim() ? 0.6 : 1 }}
          >
            Send
          </button>
        </form>
      </div>
    </div>
  );
}
