import { useState } from "react";
import { api, errorDetail } from "../api/client";

export interface Reply {
  id: string;
  subject: string;
  body: string;
  delivered: boolean;
  created_at: string;
}

interface Props {
  enquiryId: string;
  to: string | null;
  name: string | null;
  replies: Reply[];
  /** A mail server is configured, so a reply can actually leave the building. */
  emailReady: boolean;
  onSent: () => void;
}

/**
 * Answering an enquiry without leaving the page. What is sent is kept with the enquiry, so a week later
 * it is still clear what was promised to whom.
 */
export default function EnquiryReply({ enquiryId, to, name, replies, emailReady, onSent }: Props) {
  const [open, setOpen] = useState(false);
  const [subject, setSubject] = useState("Re: your message to Zehnox");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setSending(true);
    setError("");
    try {
      await api.post(`/admin/enquiries/${enquiryId}/reply`, { subject, message });
      setMessage("");
      setOpen(false);
      onSent();
    } catch (err: unknown) {
      setError(errorDetail(err, "Could not send that reply."));
    } finally {
      setSending(false);
    }
  }

  const blocked = !to ? "This enquiry left a phone number but no email address." : !emailReady ? "No mail server is configured, so replies cannot be sent from here." : "";

  return (
    <div style={{ marginTop: 14 }}>
      {replies.length > 0 && (
        <ol style={{ listStyle: "none", margin: "0 0 12px", padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
          {replies.map((reply) => (
            <li key={reply.id} style={{ borderLeft: "2px solid var(--primary-border)", padding: "2px 0 2px 12px" }}>
              <div className="zb-help" style={{ marginBottom: 2 }}>
                You replied {new Date(reply.created_at).toLocaleString()} · {reply.subject}
                {!reply.delivered && <span style={{ color: "var(--danger)" }}> · not delivered</span>}
              </div>
              <div style={{ fontSize: 14, color: "var(--fg-2)", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{reply.body}</div>
            </li>
          ))}
        </ol>
      )}

      {!open ? (
        <button type="button" className="zb-btn zb-btn--secondary zb-btn--sm" disabled={!!blocked} title={blocked || undefined}
          onClick={() => { setOpen(true); setError(""); }}>
          {replies.length ? "Reply again" : "Reply by email"}
        </button>
      ) : (
        <form onSubmit={send} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div className="zb-help">To {name ? `${name}, ` : ""}{to}</div>
          <div className="zb-field">
            <label className="zb-sr-only" htmlFor={`subject-${enquiryId}`}>Subject</label>
            <input id={`subject-${enquiryId}`} className="zb-input" value={subject} maxLength={255} required
              onChange={(e) => setSubject(e.target.value)} placeholder="Subject" />
          </div>
          <div className="zb-field">
            <label className="zb-sr-only" htmlFor={`message-${enquiryId}`}>Your reply</label>
            <textarea id={`message-${enquiryId}`} className="zb-input" style={{ minHeight: 120, resize: "vertical" }} value={message}
              maxLength={5000} required autoFocus onChange={(e) => setMessage(e.target.value)}
              placeholder={`Hi ${name?.split(" ")[0] ?? "there"},\n\n`} />
            <span className="zb-help">Sent from your ZehnBot address. Their answer comes back to your own inbox.</span>
          </div>
          {error && <div className="zb-alert zb-alert--danger" role="alert">{error}</div>}
          <div style={{ display: "flex", gap: 8 }}>
            <button type="submit" className="zb-btn zb-btn--primary zb-btn--sm" disabled={sending || !message.trim()}>
              {sending ? "Sending…" : "Send reply"}
            </button>
            <button type="button" className="zb-btn zb-btn--ghost zb-btn--sm" disabled={sending} onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </form>
      )}
    </div>
  );
}
