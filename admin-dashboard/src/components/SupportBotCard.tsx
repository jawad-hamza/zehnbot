import { useEffect, useState } from "react";
import { api, errorDetail } from "../api/client";
import type { ClientListItem } from "../types";

interface SiteChats {
  support_client_id: string | null;
  demo_client_id: string | null;
  demo_from_env: string | null;
}

/**
 * Super admin only. The two chats on this app's own pages, each answered by one of the operator's bots:
 * the support chat in the corner of every page, and the live demo on the landing page.
 */
export default function SupportBotCard() {
  const [bots, setBots] = useState<ClientListItem[] | null>(null);
  const [chats, setChats] = useState<SiteChats>({ support_client_id: null, demo_client_id: null, demo_from_env: null });
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    Promise.all([api.get("/admin/clients"), api.get("/admin/site-chats")])
      .then(([list, current]) => { setBots(list.data); setChats(current.data); })
      .catch((err: unknown) => setNote({ ok: false, text: errorDetail(err, "Could not load the chat settings.") }));
  }, []);

  if (!bots) return note ? <div className="zb-alert zb-alert--danger" role="alert">{note.text}</div> : null;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setNote(null);
    try {
      setChats((await api.put("/admin/site-chats", { support_client_id: chats.support_client_id || null, demo_client_id: chats.demo_client_id || null })).data);
      setNote({ ok: true, text: "Saved. Visitors see the change on their next page load (within a minute)." });
    } catch (err: unknown) {
      setNote({ ok: false, text: errorDetail(err, "Could not save.") });
    } finally {
      setSaving(false);
    }
  }

  const picker = (id: string, value: string | null, onChange: (v: string | null) => void, offLabel: string) => {
    const current = bots.find((b) => b.client_id === value);
    return (
      <>
        <select id={id} className="zb-input" value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}>
          <option value="">{offLabel}</option>
          {bots.map((b) => (
            <option key={b.id} value={b.client_id}>{b.name} ({b.client_id}){b.tenant_name ? ` · ${b.tenant_name}` : ""}{b.is_active ? "" : " · paused"}</option>
          ))}
        </select>
        {current && !current.is_active && <span className="zb-help">This bot is paused, so this chat stays hidden until it is switched back on.</span>}
      </>
    );
  };

  return (
    <section className="zb-card zb-card--pad" aria-labelledby="settings-site-chats">
      <h2 className="zb-card-title" id="settings-site-chats">Chats on this site</h2>
      <p className="zb-card-sub">
        Both are answered by one of your bots, on your platform AI key and that bot's workspace quota, with a daily
        allowance per visitor. Leads they collect arrive in that bot's Leads.
      </p>
      <form onSubmit={save} style={{ display: "flex", flexDirection: "column", gap: 16, marginTop: 18 }}>
        <div className="zb-field" style={{ maxWidth: 460 }}>
          <label className="zb-label" htmlFor="site-support-bot">Support chat (lower-right corner of every page)</label>
          {picker("site-support-bot", chats.support_client_id, (v) => setChats({ ...chats, support_client_id: v }), "Off: no support chat")}
          <span className="zb-help">Give this bot knowledge about ZehnBot itself: plans, set-up, billing. Your own console never shows it.</span>
        </div>
        <div className="zb-field" style={{ maxWidth: 460 }}>
          <label className="zb-label" htmlFor="site-demo-bot">Live demo on the landing page ("Ask it something")</label>
          {picker("site-demo-bot", chats.demo_client_id, (v) => setChats({ ...chats, demo_client_id: v }),
            chats.demo_from_env ? `Use the server's setting (${chats.demo_from_env})` : "Off: show a screenshot instead")}
          <span className="zb-help">An example business visitors can try, such as a bike workshop with a few pages of knowledge.</span>
        </div>
        {!bots.length && <p className="zb-help">Create a bot first (Bots → New bot), then pick it here.</p>}
        {note && <div role={note.ok ? "status" : "alert"} className={`zb-alert ${note.ok ? "zb-alert--info" : "zb-alert--danger"}`}>{note.text}</div>}
        <button type="submit" className="zb-btn zb-btn--primary" disabled={saving} style={{ alignSelf: "flex-start" }}>{saving ? "Saving…" : "Save"}</button>
      </form>
    </section>
  );
}
