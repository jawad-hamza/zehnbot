import { useEffect, useRef, useState } from "react";

type Turn = { role: "you" | "bot" | "note"; text: string; streaming?: boolean };

// Starter questions only make sense for a bot we know: the seeded bike-workshop demo (scripts/seed_demo.py)
export const BIKE_DEMO_BOT = "tallis-cycles";
const SUGGESTIONS: Record<string, string[]> = { [BIKE_DEMO_BOT]: ["Do you service e-bikes?", "When are you open?", "Can I book a bike fitting?"] };
const GREETING = "Hi! Ask me anything.";

/** Shows **bold** as bold. Everything else is plain text, placed with React (never as HTML). */
function Rich({ text }: { text: string }) {
  // Models love long dashes; this page allows none, so they are shown as commas and hyphens (punctuation only)
  text = text.replace(/\s*\u2014\s*/g, ", ").replace(/\u2013/g, "-");
  return <>{text.split(/(\*\*[^*\n]+\*\*)/g).map((part, i) => (part.startsWith("**") && part.endsWith("**") ? <strong key={i}>{part.slice(2, -2)}</strong> : part))}</>;
}

/**
 * The product itself, on the marketing page: a real bot, the real streaming endpoint, the real
 * rules (rate limits and the monthly quota apply). Nothing here is scripted.
 */
export default function LiveDemo({ clientId }: { clientId: string }) {
  const [turns, setTurns] = useState<Turn[]>([{ role: "bot", text: GREETING }]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const session = useRef(`landing-${crypto.randomUUID?.() ?? Math.random().toString(16).slice(2).padEnd(12, "0")}`);
  const log = useRef<HTMLDivElement>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => () => abort.current?.abort(), []);
  // The bot greets in its own words, exactly as its widget would
  useEffect(() => {
    fetch(`/api/widget/config?client_id=${encodeURIComponent(clientId)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((config) => { if (config?.welcome_message) setTurns((t) => (t.length === 1 ? [{ role: "bot", text: config.welcome_message }] : t)); })
      .catch(() => undefined);
  }, [clientId]);
  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight });
  }, [turns]);

  async function send(message: string) {
    const text = message.trim().slice(0, 2000);
    if (!text || busy) return;
    setDraft("");
    setBusy(true);
    setTurns((t) => [...t, { role: "you", text }, { role: "bot", text: "", streaming: true }]);

    const patchLast = (fn: (turn: Turn) => Turn) => setTurns((t) => t.map((turn, i) => (i === t.length - 1 ? fn(turn) : turn)));
    const fail = (why: string) => patchLast((turn) => ({ role: "note", text: turn.text ? `${turn.text}\n\n${why}` : why }));

    try {
      abort.current = new AbortController();
      const res = await fetch("/api/chat/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify({ client_id: clientId, session_id: session.current, message: text }),
        signal: abort.current.signal,
      });
      if (!res.ok || !res.body) {
        // a 429 explains itself: either "slow down" or the visitor's daily demo allowance
        const detail = res.status === 429 ? await res.json().then((j) => (typeof j?.detail === "string" ? j.detail : ""), () => "") : "";
        fail(detail || (res.status === 429 ? "The demo is busy right now. Please try again in a minute." : "The demo could not answer just now. Please try again."));
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let opensForm = false;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let end: number;
        while ((end = buffer.indexOf("\n\n")) !== -1) {
          const block = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          for (const line of block.split("\n")) {
            if (!line.startsWith("data:")) continue;
            const event = JSON.parse(line.slice(5).trim());
            if (event.type === "delta") patchLast((turn) => ({ ...turn, text: turn.text + event.text }));
            else if (event.type === "done") opensForm = !!event.show_lead_form;
            else if (event.type === "error") throw new Error("stream");
          }
        }
      }
      patchLast((turn) => ({ ...turn, streaming: false }));
      if (opensForm) setTurns((t) => [...t, { role: "note", text: "On your website, a short contact form opens here. Details typed into the chat are captured too." }]);
    } catch (err) {
      if ((err as Error).name !== "AbortError") fail("The demo could not answer just now. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const untouched = turns.length === 1;
  const suggestions = SUGGESTIONS[clientId] ?? [];

  return (
    <div className="lp-chat">
      <div className="lp-chat-log" ref={log} role="log" aria-live="polite" aria-label="Demo conversation">
        {turns.map((turn, i) => (
          <div key={i} className={`lp-bubble lp-bubble--${turn.role}`} aria-busy={turn.streaming || undefined}>
            {turn.role === "bot" ? <Rich text={turn.text} /> : turn.text}
            {turn.streaming && <span className="lp-caret" aria-hidden="true" />}
          </div>
        ))}
      </div>
      {untouched && suggestions.length > 0 && (
        <div className="lp-chat-suggest">
          {suggestions.map((q) => <button key={q} type="button" className="lp-chip" disabled={busy} onClick={() => send(q)}>{q}</button>)}
        </div>
      )}
      <form className="lp-chat-form" onSubmit={(e) => { e.preventDefault(); send(draft); }}>
        <label className="zb-sr-only" htmlFor="lp-demo-input">Ask the demo bot a question</label>
        <input id="lp-demo-input" className="zb-input" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Type a question" maxLength={2000} autoComplete="off" />
        <button type="submit" className="zb-btn zb-btn--primary" disabled={busy || !draft.trim()}>Send</button>
      </form>
    </div>
  );
}
