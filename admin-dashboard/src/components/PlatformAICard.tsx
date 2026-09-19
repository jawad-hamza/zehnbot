import { useEffect, useState } from "react";
import { api, errorDetail } from "../api/client";
import type { AiProvider } from "../types";

interface PlatformAIStatus {
  source: "dashboard" | "env" | "none";
  provider: string;
  provider_label: string;
  model: string | null;
  effective_model: string | null;
  base_url: string | null;
  key_hint: string | null;
  dashboard_key_saved: boolean;
  env_key_set: boolean;
  env_provider: string;
}
type Note = { ok: boolean; text: string } | null;

const SOURCE: Record<PlatformAIStatus["source"], { badge: string; label: string; text: string }> = {
  dashboard: { badge: "zb-badge--success", label: "Set here", text: "Bots without their own key answer with the key saved on this page. It overrides the server's .env." },
  env: { badge: "zb-badge--primary", label: "From the server's .env", text: "Bots without their own key answer with PLATFORM_AI_API_KEY from the server. Save a key here to override it without a redeploy." },
  none: { badge: "zb-badge--warning", label: "Not set", text: "No platform key anywhere: bots without their own key cannot answer. Save one here." },
};

/**
 * Super admin only. The AI key (and provider, model) that answers for every bot whose workspace has no key
 * of its own. The key is write-only: the server keeps it encrypted and only ever shows its last characters.
 */
export default function PlatformAICard() {
  const [status, setStatus] = useState<PlatformAIStatus | null>(null);
  const [providers, setProviders] = useState<AiProvider[]>([]);
  const [form, setForm] = useState({ provider: "", model: "", base_url: "", api_key: "" });
  const [busy, setBusy] = useState<"" | "save" | "test" | "remove">("");
  const [note, setNote] = useState<Note>(null);

  function show(s: PlatformAIStatus) {
    setStatus(s);
    setForm({ provider: s.provider, model: s.model ?? "", base_url: s.base_url ?? "", api_key: "" });
  }

  useEffect(() => {
    api.get("/admin/platform-ai").then((r) => show(r.data)).catch((err: unknown) => setNote({ ok: false, text: errorDetail(err, "Could not load the platform AI settings.") }));
    api.get("/admin/providers").then((r) => setProviders(r.data)).catch(() => undefined);
  }, []);

  if (!status) return note ? <div className="zb-alert zb-alert--danger" role="alert">{note.text}</div> : null;

  const provider = providers.find((p) => p.id === form.provider);
  const options = providers.some((p) => p.id === form.provider) ? providers : [{ id: form.provider, label: status.provider_label } as AiProvider, ...providers];
  const source = SOURCE[status.source];
  const payload = () => ({ provider: form.provider, model: form.model.trim() || null, base_url: form.base_url.trim() || null, api_key: form.api_key.trim() || null });

  async function run(kind: "save" | "test" | "remove", call: () => Promise<void>) {
    setBusy(kind);
    setNote(null);
    try { await call(); } finally { setBusy(""); }
  }

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    return run("save", async () => {
      try {
        show((await api.put("/admin/platform-ai", payload())).data);
        setNote({ ok: true, text: "Saved. Every bot without its own key uses it from the next message." });
      } catch (err: unknown) { setNote({ ok: false, text: errorDetail(err, "Could not save.") }); }
    });
  };

  const test = () => run("test", async () => {
    try {
      const r = (await api.post("/admin/platform-ai/test", payload())).data as { ok: boolean; detail: string };
      setNote({ ok: r.ok, text: r.detail });
    } catch (err: unknown) { setNote({ ok: false, text: errorDetail(err, "Could not run the test.") }); }
  });

  const remove = () => {
    if (!window.confirm(status.env_key_set ? "Remove the key saved here? Bots will go back to the key in the server's .env." : "Remove the key saved here? The server's .env has no key, so bots without their own key will stop answering.")) return;
    return run("remove", async () => {
      try {
        show((await api.delete("/admin/platform-ai")).data);
        setNote({ ok: true, text: "Removed." });
      } catch (err: unknown) { setNote({ ok: false, text: errorDetail(err, "Could not remove the key.") }); }
    });
  };

  const keyPlaceholder = status.dashboard_key_saved ? `Key saved (${status.key_hint ?? "…"}). Type a new one to replace it` : "Paste the provider's API key";

  return (
    <section className="zb-card zb-card--pad" aria-labelledby="settings-platform-ai">
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <h2 className="zb-card-title" id="settings-platform-ai">Platform AI key</h2>
        <span className={`zb-badge ${source.badge}`}>{source.label}</span>
      </div>
      <p className="zb-card-sub">{source.text}{status.source !== "none" && status.key_hint && <> Key in use ends in <span className="zb-num">{status.key_hint}</span>, model {status.effective_model ?? "the provider's default"}.</>}</p>

      <form onSubmit={save} style={{ display: "flex", flexDirection: "column", gap: 16, marginTop: 18 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16 }}>
          <div className="zb-field">
            <label className="zb-label" htmlFor="pai-provider">Provider</label>
            <select id="pai-provider" className="zb-input" value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value, model: "" })}>
              {options.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          </div>
          <div className="zb-field">
            <label className="zb-label" htmlFor="pai-model">Model</label>
            <input id="pai-model" className="zb-input" value={form.model} maxLength={200} onChange={(e) => setForm({ ...form, model: e.target.value })}
              placeholder={provider?.default_model ? `Default: ${provider.default_model}` : "Required for this provider"} aria-describedby="pai-model-help" />
            <span className="zb-help" id="pai-model-help">{provider?.model_hint ?? ""}</span>
          </div>
        </div>
        {provider?.needs_base_url && (
          <div className="zb-field">
            <label className="zb-label" htmlFor="pai-base">Endpoint URL</label>
            <input id="pai-base" className="zb-input" value={form.base_url} maxLength={500} onChange={(e) => setForm({ ...form, base_url: e.target.value })} placeholder="llm.example.com/v1" />
            <span className="zb-help">Must be public https. An internal gateway belongs in the server's .env instead.</span>
          </div>
        )}
        <div className="zb-field">
          <label className="zb-label" htmlFor="pai-key">API key</label>
          <input id="pai-key" className="zb-input" type="password" autoComplete="new-password" spellCheck={false} value={form.api_key} maxLength={500}
            onChange={(e) => setForm({ ...form, api_key: e.target.value })} placeholder={keyPlaceholder} aria-describedby="pai-key-help" />
          <span className="zb-help" id="pai-key-help">
            Stored encrypted; nobody can read it back from the dashboard.{provider?.keys_url && <> <a className="zb-link" href={provider.keys_url} target="_blank" rel="noreferrer">Get a {provider.label} key</a></>}
          </span>
        </div>

        {note && <div role={note.ok ? "status" : "alert"} className={`zb-alert ${note.ok ? "zb-alert--info" : "zb-alert--danger"}`}>{note.text}</div>}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button type="submit" className="zb-btn zb-btn--primary" disabled={busy !== ""}>{busy === "save" ? "Saving…" : "Save"}</button>
          <button type="button" className="zb-btn zb-btn--secondary" disabled={busy !== "" || (!form.api_key.trim() && !status.dashboard_key_saved)} onClick={test}>{busy === "test" ? "Testing…" : "Test connection"}</button>
          {status.dashboard_key_saved && <button type="button" className="zb-btn zb-btn--ghost" disabled={busy !== ""} onClick={remove}>{busy === "remove" ? "Removing…" : "Remove saved key"}</button>}
        </div>
        <p className="zb-help">Knowledge-base search (embeddings) still uses the keys in the server's .env.</p>
      </form>
    </section>
  );
}
