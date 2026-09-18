import { useEffect, useState } from "react";
import { api } from "../api/client";
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
const label: React.CSSProperties = { fontSize: 13, fontWeight: 600, color: "#475569" };
const input: React.CSSProperties = {
  padding: "9px 12px",
  border: "1px solid #cbd5e1",
  borderRadius: 8,
  fontSize: 14,
  outline: "none",
  fontFamily: "inherit",
  width: "100%",
  boxSizing: "border-box",
};
const textarea: React.CSSProperties = { ...input, minHeight: 100, resize: "vertical" };
const sectionTitle: React.CSSProperties = { fontSize: 13, fontWeight: 700, color: "#334155", marginBottom: 10 };
const sectionWrap: React.CSSProperties = { borderTop: "1px solid #e2e8f0", paddingTop: 14, marginTop: 4 };

// Shown until the real catalogue arrives from GET /admin/providers (the backend owns the list:
// backend/app/services/providers.py). Adding a provider there needs no change here.
const FALLBACK_PROVIDERS: AiProvider[] = [
  { id: "deepseek", label: "DeepSeek", default_model: "deepseek-flash", model_hint: "", keys_url: "", needs_base_url: false },
];

const FONT_PRESETS = [
  { label: "System default", value: "" },
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
  const [form, setForm] = useState({
    name: initial.name ?? "",
    domain: initial.domain ?? "",
    client_id: initial.client_id ?? "",
    bot_name: initial.bot_name ?? "Assistant",
    system_prompt: initial.system_prompt ?? "",
    welcome_message: initial.welcome_message ?? "Hi! How can I help you?",
    theme_color: initial.theme_color ?? "#2563eb",
    widget_position: initial.widget_position ?? "bottom-right",
    font_family: initial.font_family ?? "",
    custom_css: initial.custom_css ?? "",
    ai_provider: initial.ai_provider ?? "deepseek",
    ai_model: initial.ai_model ?? "",
    ai_base_url: initial.ai_base_url ?? "",
    ai_api_key: "",   // never pre-filled: the server does not send stored keys back
    is_active: initial.is_active ?? true,
  });

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
    const { ai_api_key, ...rest } = form;
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
        <input style={input} value={form.name} onChange={set("name")} required placeholder="Acme Corp" />
      </div>
      <div style={field}>
        <label style={label}>Domain *</label>
        <input style={input} value={form.domain} onChange={set("domain")} required placeholder="acme.com" />
        <span style={{ fontSize: 12, color: "#94a3b8" }}>
          The widget only works on this website (subdomains and www included). Separate several with commas, e.g. <code>acme.com, acme.co.uk</code>. Add <code>localhost</code> while testing locally.
        </span>
      </div>
      <div style={field}>
        <label style={label}>Client ID * (unique slug, used in embed script)</label>
        <input style={input} value={form.client_id} onChange={set("client_id")} required placeholder="acme-001" pattern="[a-z0-9\-]+" title="Lowercase letters, numbers and dashes only" disabled={!!initial.client_id} />
      </div>
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
            <input style={input} type="url" value={form.ai_base_url} onChange={set("ai_base_url")} placeholder="https://llm.example.com/v1" maxLength={500} required />
            <span style={{ fontSize: 12, color: "#94a3b8" }}>
              Any server that speaks the OpenAI chat-completions API (LiteLLM, vLLM, a company gateway…). It must be reachable from the internet over https.
            </span>
          </div>
        )}
        <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 4 }}>
          {currentProvider.default_model ? `Leave the model blank to use ${currentProvider.default_model}. ` : ""}
          {currentProvider.model_hint}
          {currentProvider.keys_url && (
            <> · <a href={currentProvider.keys_url} target="_blank" rel="noopener noreferrer" style={{ color: "#2563eb" }}>Get an API key</a></>
          )}
        </div>
        <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 4 }}>
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
          <label style={{ fontSize: 12, color: "#475569", display: "flex", alignItems: "center", gap: 6 }}>
            <input type="checkbox" checked={removeKey} onChange={(e) => { setRemoveKey(e.target.checked); if (e.target.checked) setForm((f) => ({ ...f, ai_api_key: "" })); }} />
            Remove the saved key
          </label>
        )}
        <span style={{ fontSize: 12, color: "#94a3b8" }}>
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
        <span style={{ fontSize: 12, color: "#94a3b8" }}>
          A professional customer-service persona (warm tone, lead capture, concise answers) is already applied automatically. Use this field only for business-specific rules.
        </span>
      </div>

      <div style={field}>
        <label style={label}>Welcome Message</label>
        <input style={input} value={form.welcome_message} onChange={set("welcome_message")} placeholder="Hi! How can I help you?" />
      </div>

      <div style={sectionWrap}>
        <div style={sectionTitle}>Widget Appearance</div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div style={field}>
            <label style={label}>Theme Color</label>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input type="color" value={form.theme_color} onChange={set("theme_color")} style={{ width: 40, height: 36, border: "1px solid #cbd5e1", borderRadius: 6, cursor: "pointer", padding: 2 }} />
              <input style={{ ...input, flex: 1 }} value={form.theme_color} onChange={set("theme_color")} placeholder="#2563eb" maxLength={7} pattern="^#[0-9A-Fa-f]{6}$" />
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
            placeholder='e.g. "Inter", sans-serif — leave blank for system default'
          />
          <span style={{ fontSize: 12, color: "#94a3b8" }}>The client's site needs to load the font (Google Fonts, etc.) for it to render.</span>
        </div>

        <div style={{ ...field, marginTop: 12 }}>
          <label style={label}>Custom CSS (advanced)</label>
          <textarea
            style={{ ...textarea, fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12, minHeight: 120 }}
            value={form.custom_css}
            onChange={set("custom_css")}
            placeholder={`/* Override any element. Selectors:\n   #cb-launcher, #cb-panel, #cb-header, #cb-messages,\n   .cb-msg--user, .cb-msg--assistant, #cb-input, #cb-send */\n#cb-launcher { border-radius: 12px; }`}
          />
          <span style={{ fontSize: 12, color: "#94a3b8" }}>
            Injected into the widget's style tag. Use <code>#cb-launcher</code>, <code>#cb-panel</code>, <code>.cb-msg--user</code>, etc.
          </span>
        </div>
      </div>

      <button
        type="submit"
        disabled={loading}
        style={{ background: "#2563eb", color: "#fff", border: "none", borderRadius: 8, padding: "10px 24px", cursor: "pointer", fontSize: 14, fontWeight: 600, alignSelf: "flex-start", opacity: loading ? 0.6 : 1 }}
      >
        {loading ? "Saving…" : submitLabel}
      </button>
    </form>
  );
}
