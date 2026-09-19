import { useEffect, useState } from "react";
import { api, errorDetail } from "../api/client";
import type { ClientListItem } from "../types";

/**
 * Super admin only. Which bot answers in the corner of this app's own pages (landing page, sign-up,
 * log-in, the customer dashboard) as ZehnBot's customer support.
 */
export default function SupportBotCard() {
  const [bots, setBots] = useState<ClientListItem[] | null>(null);
  const [chosen, setChosen] = useState("");
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    Promise.all([api.get("/admin/clients"), api.get("/admin/support-bot")])
      .then(([list, current]) => {
        setBots(list.data);
        setChosen(current.data?.client_id ?? "");
      })
      .catch((err: unknown) => setNote({ ok: false, text: errorDetail(err, "Could not load the support chat setting.") }));
  }, []);

  if (!bots) return note ? <div className="zb-alert zb-alert--danger" role="alert">{note.text}</div> : null;

  const current = bots.find((b) => b.client_id === chosen);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setNote(null);
    try {
      await api.put("/admin/support-bot", { client_id: chosen || null });
      setNote({ ok: true, text: chosen ? "Saved. Visitors see it within a minute (on their next page load)." : "Saved. The support chat is off." });
    } catch (err: unknown) {
      setNote({ ok: false, text: errorDetail(err, "Could not save.") });
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="zb-card zb-card--pad" aria-labelledby="settings-support">
      <h2 className="zb-card-title" id="settings-support">Support chat on this site</h2>
      <p className="zb-card-sub">
        A chat in the lower-right corner of the landing page, sign-up, log-in and your customers' dashboard, answered by one of your bots.
        Give that bot knowledge about ZehnBot (plans, set-up, billing) so it can help. Leads it collects arrive in that bot's Leads, like any other.
      </p>
      <form onSubmit={save} style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 18 }}>
        <div className="zb-field" style={{ maxWidth: 420 }}>
          <label className="zb-label" htmlFor="support-bot">Bot</label>
          <select id="support-bot" className="zb-input" value={chosen} onChange={(e) => setChosen(e.target.value)}>
            <option value="">Off: no support chat</option>
            {bots.map((b) => (
              <option key={b.id} value={b.client_id}>{b.name} ({b.client_id}){b.tenant_name ? ` · ${b.tenant_name}` : ""}{b.is_active ? "" : " · paused"}</option>
            ))}
          </select>
          {current && !current.is_active && <span className="zb-help">This bot is paused, so the chat will not appear until it is switched back on.</span>}
          {!bots.length && <span className="zb-help">Create a bot first (Bots → New bot), then pick it here.</span>}
        </div>
        {note && <div role={note.ok ? "status" : "alert"} className={`zb-alert ${note.ok ? "zb-alert--info" : "zb-alert--danger"}`}>{note.text}</div>}
        <button type="submit" className="zb-btn zb-btn--primary" disabled={saving} style={{ alignSelf: "flex-start" }}>{saving ? "Saving…" : "Save"}</button>
      </form>
    </section>
  );
}
