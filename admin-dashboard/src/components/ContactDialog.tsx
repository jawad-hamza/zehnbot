import { useEffect, useId, useRef, useState } from "react";
import { api, errorDetail } from "../api/client";
import { IconCheck, IconClose } from "./icons";

export interface ContactRequest {
  /** Where the request came from, e.g. "landing-pricing". Shown to the operator beside the lead. */
  source: string;
  plan?: string;
  defaults?: { name?: string; email?: string; company?: string };
}

/**
 * "Talk to Zehnox": asks for the same three things the chatbot asks a visitor for (a name, and an
 * email or a phone number), plus what they need. The request lands in the operator's Enquiries.
 * A native <dialog>, so focus trapping, Esc and the backdrop are the browser's own.
 */
export default function ContactDialog({ request, onClose }: { request: ContactRequest | null; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();
  const [form, setForm] = useState({ name: "", email: "", phone: "", company: "", message: "", fax: "" });
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (request && !el.open) {
      setForm((f) => ({ ...f, name: request.defaults?.name ?? f.name, email: request.defaults?.email ?? f.email, company: request.defaults?.company ?? f.company }));
      setError("");
      setSent(false);
      el.showModal();
    } else if (!request && el.open) {
      el.close();
    }
  }, [request]);

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const reachable = form.email.trim() !== "" || form.phone.trim() !== "";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!reachable) {
      setError("Leave an email or a phone number so we can reply.");
      return;
    }
    setSending(true);
    setError("");
    try {
      await api.post("/contact", { ...form, plan: request?.plan, source: request?.source ?? "landing" });
      setSent(true);
      setForm((f) => ({ ...f, message: "" }));
    } catch (err: unknown) {
      setError(errorDetail(err, "That did not go through. Please try again."));
    } finally {
      setSending(false);
    }
  }

  const plan = request?.plan;
  return (
    <dialog ref={dialog} className="zb-dialog" aria-labelledby={`${id}-title`} onClose={onClose}
      onClick={(e) => { if (e.target === dialog.current) onClose(); }}>
      <div className="zb-dialog-head">
        <div>
          <h2 id={`${id}-title`}>{sent ? "Thanks, we have it." : "Talk to Zehnox"}</h2>
          {!sent && <p>{plan ? `Tell us where to reach you about the ${plan} plan.` : "Tell us where to reach you and what you need."}</p>}
        </div>
        <button type="button" className="zb-icon-btn" aria-label="Close" onClick={onClose}><IconClose /></button>
      </div>

      {sent ? (
        <div className="zb-dialog-body">
          <div className="zb-dialog-done" role="status">
            <span className="zb-stat-icon"><IconCheck size={22} /></span>
            <p style={{ color: "var(--muted-fg)", lineHeight: 1.6 }}>Someone from the Zehnox team will get back to you on the details you left. You do not need to do anything else.</p>
            <button type="button" className="zb-btn zb-btn--primary" onClick={onClose}>Done</button>
          </div>
        </div>
      ) : (
        <form className="zb-dialog-body" onSubmit={submit} noValidate>
          <div className="zb-field">
            <label className="zb-label" htmlFor={`${id}-name`}>Your name</label>
            <input id={`${id}-name`} className="zb-input" value={form.name} onChange={set("name")} autoComplete="name" maxLength={255} required />
          </div>
          <div className="zb-dialog-row">
            <div className="zb-field">
              <label className="zb-label" htmlFor={`${id}-email`}>Email</label>
              <input id={`${id}-email`} className="zb-input" type="email" value={form.email} onChange={set("email")} autoComplete="email" maxLength={255} aria-describedby={`${id}-reach`} />
            </div>
            <div className="zb-field">
              <label className="zb-label" htmlFor={`${id}-phone`}>Phone</label>
              <input id={`${id}-phone`} className="zb-input" type="tel" value={form.phone} onChange={set("phone")} autoComplete="tel" maxLength={30} aria-describedby={`${id}-reach`} />
            </div>
          </div>
          <span className="zb-help" id={`${id}-reach`}>Either one is enough. Both is even better.</span>
          <div className="zb-field">
            <label className="zb-label" htmlFor={`${id}-company`}>Business or website</label>
            <input id={`${id}-company`} className="zb-input" value={form.company} onChange={set("company")} autoComplete="organization" placeholder="example.com" maxLength={255} />
          </div>
          <div className="zb-field">
            <label className="zb-label" htmlFor={`${id}-message`}>What do you need?</label>
            <textarea id={`${id}-message`} className="zb-input" value={form.message} onChange={set("message")} maxLength={4000} rows={3} />
          </div>
          {/* Honeypot: invisible to people and to screen readers; form-filling bots fill it in */}
          <div aria-hidden="true" style={{ position: "absolute", left: -9999, width: 1, height: 1, overflow: "hidden" }}>
            <label>Fax <input tabIndex={-1} autoComplete="off" value={form.fax} onChange={set("fax")} /></label>
          </div>
          {error && <div className="zb-alert zb-alert--danger" role="alert">{error}</div>}
          <button type="submit" className="zb-btn zb-btn--primary zb-btn--lg" disabled={sending || !form.name.trim()}>{sending ? "Sending…" : "Send my details"}</button>
        </form>
      )}
    </dialog>
  );
}
