import { useState } from "react";
import type { Client } from "../types";

interface Props {
  initial?: Partial<Client>;
  onSubmit: (data: Partial<Client>) => Promise<void>;
  loading: boolean;
  submitLabel: string;
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

const PROVIDERS = [
  { value: "openai",    label: "OpenAI",    defaultModel: "gpt-4o-mini",           hint: "e.g. gpt-4o-mini, gpt-4o, gpt-4-turbo" },
  { value: "anthropic", label: "Anthropic", defaultModel: "claude-3-5-haiku-latest", hint: "e.g. claude-3-5-sonnet-latest, claude-3-5-haiku-latest" },
  { value: "gemini",    label: "Google Gemini", defaultModel: "gemini-2.0-flash",   hint: "e.g. gemini-2.0-flash, gemini-2.0-flash-lite, gemini-2.5-flash" },
  { value: "deepseek",  label: "DeepSeek",  defaultModel: "deepseek-chat",          hint: "e.g. deepseek-chat, deepseek-reasoner" },
  { value: "grok",      label: "xAI Grok",  defaultModel: "grok-2-latest",          hint: "e.g. grok-2-latest, grok-beta" },
];

const FONT_PRESETS = [
  { label: "System default", value: "" },
  { label: "Inter", value: '"Inter", -apple-system, sans-serif' },
  { label: "Roboto", value: '"Roboto", sans-serif' },
  { label: "Poppins", value: '"Poppins", sans-serif' },
  { label: "Georgia (serif)", value: 'Georgia, "Times New Roman", serif' },
  { label: "Monospace", value: 'ui-monospace, "SF Mono", Menlo, monospace' },
];

export default function ClientForm({ initial = {}, onSubmit, loading, submitLabel }: Props) {
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
    ai_provider: initial.ai_provider ?? "openai",
    ai_model: initial.ai_model ?? "",
    ai_api_key: initial.ai_api_key ?? "",
    is_active: initial.is_active ?? true,
  });

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const currentProvider = PROVIDERS.find((p) => p.value === form.ai_provider) ?? PROVIDERS[0];

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    await onSubmit({
      ...form,
      ai_model: form.ai_model.trim() || null,
      ai_api_key: form.ai_api_key || null,
      font_family: form.font_family.trim() || null,
      custom_css: form.custom_css.trim() || null,
    });
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 18, maxWidth: 620 }}>
      <div style={field}>
        <label style={label}>Company Name *</label>
        <input style={input} value={form.name} onChange={set("name")} required placeholder="Acme Corp" />
      </div>
      <div style={field}>
        <label style={label}>Domain *</label>
        <input style={input} value={form.domain} onChange={set("domain")} required placeholder="acme.com" />
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
              {PROVIDERS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </div>
          <div style={field}>
            <label style={label}>Model (optional)</label>
            <input style={input} value={form.ai_model} onChange={set("ai_model")} placeholder={currentProvider.defaultModel} />
          </div>
        </div>
        <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 4 }}>{currentProvider.hint}</div>
      </div>

      <div style={field}>
        <label style={label}>API Key</label>
        <input style={input} value={form.ai_api_key ?? ""} onChange={set("ai_api_key")} placeholder="Paste provider API key" type="password" autoComplete="off" />
        <span style={{ fontSize: 12, color: "#94a3b8" }}>This key is used only for this bot. Each bot can use a different provider and key.</span>
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
