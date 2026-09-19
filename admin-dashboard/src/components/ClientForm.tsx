import { useEffect, useState } from "react";
import { api, errorDetail } from "../api/client";
import { IconWand } from "./icons";
import type { AiProvider, Client, ClientPayload, Tenant } from "../types";

interface Props {
  initial?: Partial<Client>;
  onSubmit: (data: ClientPayload) => Promise<void>;
  loading: boolean;
  submitLabel: string;
  /** Given to the super admin when creating a bot: which customer it belongs to. */
  tenants?: Tenant[];
}

const field: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 4 };
const label: React.CSSProperties = { fontSize: 13, fontWeight: 600, color: "var(--fg-2)" };
const input: React.CSSProperties = {
  padding: "9px 12px",
  border: "1px solid var(--border-strong)",
  borderRadius: 8,
  fontSize: 14,
  outline: "none",
  fontFamily: "inherit",
  width: "100%",
  boxSizing: "border-box",
};
const textarea: React.CSSProperties = { ...input, minHeight: 100, resize: "vertical" };
const sectionTitle: React.CSSProperties = { fontSize: 13, fontWeight: 700, color: "var(--fg-2)", marginBottom: 10 };
const sectionWrap: React.CSSProperties = { borderTop: "1px solid var(--border)", paddingTop: 14, marginTop: 4 };

// Shown until the real catalogue arrives from GET /admin/providers (the backend owns the list:
// backend/app/services/providers.py). Adding a provider there needs no change here.
const FALLBACK_PROVIDERS: AiProvider[] = [
  { id: "deepseek", label: "DeepSeek", default_model: "deepseek-flash", model_hint: "", keys_url: "", needs_base_url: false },
];

const FONT_PRESETS = [
  { label: "Same as my website (default)", value: "" },
  { label: "Inter", value: '"Inter", -apple-system, sans-serif' },
  { label: "Roboto", value: '"Roboto", sans-serif' },
  { label: "Poppins", value: '"Poppins", sans-serif' },
  { label: "Georgia (serif)", value: 'Georgia, "Times New Roman", serif' },
  { label: "Monospace", value: 'ui-monospace, "SF Mono", Menlo, monospace' },
];

export default function ClientForm({ initial = {}, onSubmit, loading, submitLabel, tenants }: Props) {
  const isNew = !initial.id;
  const [tenantId, setTenantId] = useState("");
  const [removeKey, setRemoveKey] = useState(false);
  // New bots take their look from the website unless the owner says otherwise
  const [matchWebsite, setMatchWebsite] = useState(isNew);
  const [matching, setMatching] = useState(false);
  const [matchNote, setMatchNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [form, setForm] = useState({
    name: initial.name ?? "",
    domain: initial.domain ?? "",
    client_id: initial.client_id ?? "",
    bot_name: initial.bot_name ?? "Assistant",
    system_prompt: initial.system_prompt ?? "",
    welcome_message: initial.welcome_message ?? "Hi! How can I help you?",
    theme_color: initial.theme_color ?? "#1a52d7",   // a data value sent to the server: a real hex, never a CSS variable
    widget_position: initial.widget_position ?? "bottom-right",
    font_family: initial.font_family ?? "",
    custom_css: initial.custom_css ?? "",
    notification_sound: initial.notification_sound ?? true,
    ai_provider: initial.ai_provider ?? "deepseek",
    ai_model: initial.ai_model ?? "",
    ai_base_url: initial.ai_base_url ?? "",
    ai_api_key: "",   // never pre-filled: the server does not send stored keys back
    is_active: initial.is_active ?? true,
  });

  /** Existing bots: read the website again and restyle the widget to it (saved straight away). */
  async function matchNow() {
    setMatching(true);
    setMatchNote(null);
    try {
      const res = await api.post(`/admin/clients/${initial.id}/match-style`);
      setForm((f) => ({ ...f, theme_color: res.data.theme_color, font_family: res.data.font_family ?? "" }));
      const how = res.data.method === "ai" ? "chosen by AI from your site's own styles" : "taken from your site's styles";
      setMatchNote(res.data.applied
        ? { ok: true, text: `Matched and saved: ${res.data.theme_color}${res.data.fonts_found?.[0] ? `, ${res.data.font_family?.split(",")[0].replace(/"/g, "")}` : ""} (${how}).` }
        : { ok: false, text: res.data.detail || "Nothing could be read from the website, so the look was left as it is." });
    } catch (err: unknown) {
      setMatchNote({ ok: false, text: errorDetail(err, "Could not read the website just now.") });
    } finally {
      setMatching(false);
    }
  }

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const [providers, setProviders] = useState<AiProvider[]>(FALLBACK_PROVIDERS);
  useEffect(() => {
    api.get("/admin/providers").then((r) => setProviders(r.data)).catch(() => undefined);
  }, []);

  // A bot saved with a provider that is no longer offered still shows what it has
  const currentProvider: AiProvider =
    providers.find((p) => p.id === form.ai_provider) ??
    { id: form.ai_provider, label: form.ai_provider, default_model: null, model_hint: "", keys_url: "", needs_base_url: false };
  const providerOptions = providers.some((p) => p.id === currentProvider.id) ? providers : [currentProvider, ...providers];
  const modelRequired = !currentProvider.default_model;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    // client_id is never sent: the server generates it on create and it cannot change afterwards
    const { ai_api_key, client_id: _generated, ...rest } = form;
    const payload: ClientPayload = {
      ...rest,
      ai_model: form.ai_model.trim() || null,
      ai_base_url: currentProvider.needs_base_url ? form.ai_base_url.trim() || null : null,
      font_family: form.font_family.trim() || null,
      custom_css: form.custom_css.trim() || null,
    };
    // Typed a key = replace it. Ticked "remove" = send "". Otherwise leave the field out so the stored key survives.
    if (ai_api_key.trim()) payload.ai_api_key = ai_api_key.trim();
    else if (removeKey) payload.ai_api_key = "";
    if (isNew && tenants && tenantId) payload.tenant_id = tenantId;
    if (isNew && matchWebsite) payload.match_website = true;
    await onSubmit(payload);
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 18, maxWidth: 620 }}>
      {isNew && tenants && (
        <div style={field}>
          <label style={label}>Tenant * (the customer this bot belongs to)</label>
          <select style={input} value={tenantId} onChange={(e) => setTenantId(e.target.value)} required>
            <option value="">Choose a tenant…</option>
            {tenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
      )}
      <div style={field}>
        <label style={label}>Company Name *</label>
        <input style={input} value={form.name} onChange={set("name")} required placeholder="Example Ltd" />
      </div>
      <div style={field}>
        <label style={label}>Website *</label>
        <input style={input} value={form.domain} onChange={set("domain")} required placeholder="example.com" autoCapitalize="none" spellCheck={false} />
        <span style={{ fontSize: 12, color: "var(--subtle-fg)" }}>
          Just the address, no <code>https://</code> or <code>www</code> needed. The widget only works on this website (subdomains included). Several sites: separate with commas, e.g. <code>example.com, example.co.uk</code>. It always works on <code>localhost</code>, so you can try it on your own computer first.
        </span>
      </div>
      {/* The Client ID is generated by the server. It is shown once it exists, because it appears in the embed code. */}
      {initial.client_id && (
        <div style={field}>
          <label style={label}>Client ID (generated, used in the embed code)</label>
          <input style={{ ...input, background: "var(--surface-2)", color: "var(--muted-fg)" }} value={initial.client_id} readOnly />
        </div>
      )}
      <div style={field}>
        <label style={label}>Bot Name</label>
        <input style={input} value={form.bot_name} onChange={set("bot_name")} placeholder="Assistant" />
      </div>

      <div style={sectionWrap}>
        <div style={sectionTitle}>AI Provider</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div style={field}>
            <label style={label}>Provider</label>
            <select style={input} value={form.ai_provider} onChange={set("ai_provider")}>
              {providerOptions.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          </div>
          <div style={field}>
            <label style={label}>{modelRequired ? "Model" : "Model (optional)"}</label>
            <input style={input} value={form.ai_model} onChange={set("ai_model")} placeholder={currentProvider.default_model ?? "model name"} maxLength={100} />
          </div>
        </div>
        {currentProvider.needs_base_url && (
          <div style={{ ...field, marginTop: 12 }}>
            <label style={label}>Endpoint base URL *</label>
            <input style={input} type="text" value={form.ai_base_url} onChange={set("ai_base_url")} placeholder="llm.example.com/v1" maxLength={500} required autoCapitalize="none" spellCheck={false} />
            <span style={{ fontSize: 12, color: "var(--subtle-fg)" }}>
              Any server that speaks the OpenAI chat-completions API (LiteLLM, vLLM, a company gateway…). It must be reachable from the internet over https.
            </span>
          </div>
        )}
        <div style={{ fontSize: 12, color: "var(--subtle-fg)", marginTop: 4 }}>
          {currentProvider.default_model ? `Leave the model blank to use ${currentProvider.default_model}. ` : ""}
          {currentProvider.model_hint}
          {currentProvider.keys_url && (
            <> · <a href={currentProvider.keys_url} target="_blank" rel="noopener noreferrer" style={{ color: "var(--primary)" }}>Get an API key</a></>
          )}
        </div>
        <div style={{ fontSize: 12, color: "var(--subtle-fg)", marginTop: 4 }}>
          These settings apply once you add your own API key below. Without a key, the platform's AI answers for this bot.
        </div>
      </div>

      <div style={field}>
        <label style={label}>API Key (optional)</label>
        <input
          style={input}
          value={form.ai_api_key}
          onChange={(e) => { setRemoveKey(false); set("ai_api_key")(e); }}
          placeholder={initial.ai_api_key_set ? `Key saved (${initial.ai_api_key_hint ?? "…"}). Type a new one to replace it` : "Paste provider API key"}
          type="password"
          autoComplete="new-password"
          disabled={removeKey}
        />
        {initial.ai_api_key_set && (
          <label style={{ fontSize: 12, color: "var(--fg-2)", display: "flex", alignItems: "center", gap: 6 }}>
            <input type="checkbox" checked={removeKey} onChange={(e) => { setRemoveKey(e.target.checked); if (e.target.checked) setForm((f) => ({ ...f, ai_api_key: "" })); }} />
            Remove the saved key
          </label>
        )}
        <span style={{ fontSize: 12, color: "var(--subtle-fg)" }}>
          With your own key, this bot uses the provider and model above and is not limited by your plan's message quota. Without one, it runs on the platform's AI and counts against the quota. Keys are stored encrypted and are never shown again.
        </span>
      </div>

      <div style={field}>
        <label style={label}>Business-Specific Instructions (optional)</label>
        <textarea
          style={textarea}
          value={form.system_prompt}
          onChange={set("system_prompt")}
          placeholder="e.g. We're a boutique web studio. Always mention that pricing depends on scope, and never quote exact numbers."
        />
        <span style={{ fontSize: 12, color: "var(--subtle-fg)" }}>
          A professional customer-service persona (warm tone, lead capture, concise answers) is already applied automatically. Use this field only for business-specific rules.
        </span>
      </div>

      <div style={field}>
        <label style={label}>Welcome Message</label>
        <input style={input} value={form.welcome_message} onChange={set("welcome_message")} placeholder="Hi! How can I help you?" />
      </div>

      <div style={sectionWrap}>
        <div style={sectionTitle}>Widget Appearance</div>

        {isNew ? (
          <label style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 14, fontSize: 13, color: "var(--fg-2)", cursor: "pointer" }}>
            <input type="checkbox" checked={matchWebsite} onChange={(e) => setMatchWebsite(e.target.checked)} style={{ marginTop: 2 }} />
            <span>
              Match my website's colours and font
              <span style={{ display: "block", fontSize: 12, color: "var(--subtle-fg)" }}>
                When you create the bot, we read the website above and pick its brand colour and font for the chat. It takes a few seconds, and you can change either afterwards.
              </span>
            </span>
          </label>
        ) : (
          <div style={{ marginBottom: 14 }}>
            <button type="button" className="zb-btn zb-btn--secondary zb-btn--sm" onClick={matchNow} disabled={matching}>
              <IconWand size={15} /> {matching ? "Reading your website…" : "Match my website"}
            </button>
            {matchNote && <p role="status" style={{ fontSize: 12.5, marginTop: 8, color: matchNote.ok ? "var(--success)" : "var(--muted-fg)" }}>{matchNote.text}</p>}
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div style={field}>
            <label style={label}>Theme Color</label>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input type="color" value={form.theme_color} onChange={set("theme_color")} disabled={isNew && matchWebsite} style={{ width: 40, height: 36, border: "1px solid var(--border-strong)", borderRadius: 6, cursor: "pointer", padding: 2 }} />
              <input style={{ ...input, flex: 1 }} value={form.theme_color} onChange={set("theme_color")} placeholder="#1a52d7" maxLength={7} disabled={isNew && matchWebsite} pattern="^#[0-9A-Fa-f]{6}$" />
            </div>
          </div>

          <div style={field}>
            <label style={label}>Position</label>
            <select style={input} value={form.widget_position} onChange={set("widget_position")}>
              <option value="bottom-right">Bottom right</option>
              <option value="bottom-left">Bottom left</option>
            </select>
          </div>
        </div>

        <label style={{ display: "flex", alignItems: "flex-start", gap: 8, marginTop: 12, fontSize: 13, color: "var(--fg-2)", cursor: "pointer" }}>
          <input type="checkbox" checked={form.notification_sound} onChange={(e) => setForm((f) => ({ ...f, notification_sound: e.target.checked }))} style={{ marginTop: 2 }} />
          <span>
            Play a soft chirp when the bot replies
            <span style={{ display: "block", fontSize: 12, color: "var(--subtle-fg)" }}>Visitors can still mute it for themselves with the speaker button in the chat header.</span>
          </span>
        </label>

        <div style={{ ...field, marginTop: 12 }}>
          <label style={label}>Font</label>
          <select
            style={input}
            value={FONT_PRESETS.find((p) => p.value === form.font_family) ? form.font_family : "__custom__"}
            onChange={(e) => {
              if (e.target.value === "__custom__") return;
              setForm((f) => ({ ...f, font_family: e.target.value }));
            }}
          >
            {FONT_PRESETS.map((f) => <option key={f.label} value={f.value}>{f.label}</option>)}
            <option value="__custom__">Custom (enter below)</option>
          </select>
          <input
            style={{ ...input, marginTop: 6 }}
            value={form.font_family}
            onChange={set("font_family")}
            placeholder='e.g. "Inter", sans-serif (leave blank for the system default)'
          />
          <span style={{ fontSize: 12, color: "var(--subtle-fg)" }}>Left blank, the chat uses whatever font the page around it uses. A named font only shows if the website loads it.</span>
        </div>

        <div style={{ ...field, marginTop: 12 }}>
          <label style={label}>Custom CSS (advanced)</label>
          <textarea
            style={{ ...textarea, fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12, minHeight: 120 }}
            value={form.custom_css}
            onChange={set("custom_css")}
            placeholder={`/* Override any element. Selectors:\n   #cb-launcher, #cb-panel, #cb-header, #cb-messages,\n   .cb-msg--user, .cb-msg--assistant, #cb-input, #cb-send */\n#cb-launcher { border-radius: 12px; }`}
          />
          <span style={{ fontSize: 12, color: "var(--subtle-fg)" }}>
            Injected into the widget's style tag. Use <code>#cb-launcher</code>, <code>#cb-panel</code>, <code>.cb-msg--user</code>, etc.
          </span>
        </div>
      </div>

      <button
        type="submit"
        disabled={loading}
        style={{ background: "var(--primary)", color: "var(--on-primary)", border: "none", borderRadius: 8, padding: "10px 24px", cursor: "pointer", fontSize: 14, fontWeight: 600, alignSelf: "flex-start", opacity: loading ? 0.6 : 1 }}
      >
        {loading ? (isNew && matchWebsite ? "Creating, and reading your website…" : "Saving…") : submitLabel}
      </button>
    </form>
  );
}
