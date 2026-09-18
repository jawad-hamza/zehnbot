// All widget CSS lives inside the widget's shadow root: the host page's styles cannot reach in,
// and nothing here can leak out onto the customer's site.

const DEFAULT_FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

export function buildStyles(config) {
  // Values come from the dashboard, but are still treated as untrusted when put into CSS
  const theme = /^#[0-9a-fA-F]{6}$/.test(config.theme_color || "") ? config.theme_color : "#2563eb";
  const font = (config.font_family || "").replace(/[;{}<>\\]/g, "").trim() || DEFAULT_FONT;
  const left = config.widget_position === "bottom-left";
  const side = left ? "left: 24px; right: auto;" : "right: 24px; left: auto;";
  const tailCorner = left ? "border-bottom-left-radius: 4px;" : "border-bottom-right-radius: 4px;";

  return `
    :host {
      all: initial;            /* start from browser defaults, not from the host page */
      --cb-theme: ${theme};
      --cb-font: ${font};
    }
    *, *::before, *::after { box-sizing: border-box; }

    #cb-launcher {
      position: fixed;
      bottom: 24px;
      ${side}
      width: 56px;
      height: 56px;
      border-radius: 50%;
      background: var(--cb-theme);
      color: #fff;
      border: none;
      cursor: pointer;
      box-shadow: 0 4px 14px rgba(0,0,0,0.25);
      z-index: 2147483000;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: transform 0.18s ease, box-shadow 0.18s ease;
      animation: cb-launcher-pop 0.35s cubic-bezier(0.2,0.9,0.3,1.3);
    }
    #cb-launcher:hover { transform: scale(1.08); box-shadow: 0 6px 20px rgba(0,0,0,0.3); }
    #cb-launcher:active { transform: scale(0.96); }
    #cb-launcher:focus-visible, #cb-close:focus-visible, #cb-send:focus-visible,
    #cb-lead-submit:focus-visible, #cb-lead-dismiss:focus-visible {
      outline: 3px solid rgba(255,255,255,0.9);
      outline-offset: 2px;
      box-shadow: 0 0 0 5px var(--cb-theme);
    }
    @keyframes cb-launcher-pop {
      from { transform: scale(0); opacity: 0; }
      to   { transform: scale(1); opacity: 1; }
    }

    #cb-panel {
      position: fixed;
      bottom: 92px;
      ${side}
      width: 360px;
      height: min(560px, calc(100vh - 116px));
      background: #fff;
      color: #1e293b;
      border-radius: 16px;
      box-shadow: 0 12px 40px rgba(0,0,0,0.18);
      display: none;
      flex-direction: column;
      overflow: hidden;
      z-index: 2147483001;
      font-family: var(--cb-font);
      font-size: 14px;
      line-height: 1.45;
      text-align: left;
      transform-origin: ${left ? "bottom left" : "bottom right"};
    }
    #cb-panel.cb-open {
      display: flex;
      animation: cb-panel-in 0.22s ease-out;
    }
    @keyframes cb-panel-in {
      from { opacity: 0; transform: translateY(10px) scale(0.97); }
      to   { opacity: 1; transform: translateY(0) scale(1); }
    }

    #cb-header {
      background: var(--cb-theme);
      color: #fff;
      padding: 14px 16px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-weight: 600;
      font-size: 15px;
      flex-shrink: 0;
    }
    #cb-close {
      background: none;
      border: none;
      color: #fff;
      font-size: 20px;
      cursor: pointer;
      line-height: 1;
      padding: 4px 6px;
      margin: -4px -6px;
      border-radius: 6px;
      opacity: 0.85;
      transition: opacity 0.15s;
    }
    #cb-close:hover { opacity: 1; }

    #cb-messages {
      flex: 1;
      min-height: 0;
      overflow-y: auto;
      overscroll-behavior: contain;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 8px;
      background: #fafbfc;
    }
    .cb-msg {
      max-width: 82%;
      padding: 10px 14px;
      border-radius: 14px;
      line-height: 1.45;
      overflow-wrap: anywhere;
      animation: cb-msg-in 0.25s ease-out;
    }
    @keyframes cb-msg-in {
      from { opacity: 0; transform: translateY(6px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    .cb-msg--user {
      background: var(--cb-theme);
      color: #fff;
      align-self: flex-end;
      border-bottom-right-radius: 4px;
      white-space: pre-wrap;
    }
    .cb-msg--assistant {
      background: #eef2f7;
      color: #1e293b;
      align-self: flex-start;
      ${tailCorner}
    }
    .cb-msg--error { background: #fef2f2; color: #b91c1c; }

    /* Rich text inside bot replies */
    .cb-msg p { margin: 0; }
    .cb-msg p + p, .cb-msg p + ul, .cb-msg p + ol, .cb-msg ul + p, .cb-msg ol + p { margin-top: 8px; }
    .cb-msg ul, .cb-msg ol { margin: 0; padding-left: 20px; }
    .cb-msg li + li { margin-top: 3px; }
    .cb-msg a { color: var(--cb-theme); text-decoration: underline; }
    .cb-msg code {
      font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
      font-size: 0.92em;
      background: rgba(15,23,42,0.08);
      padding: 1px 5px;
      border-radius: 4px;
    }

    /* Typing indicator */
    #cb-typing {
      display: none;
      align-self: flex-start;
      background: #eef2f7;
      padding: 12px 16px;
      border-radius: 14px;
      ${tailCorner}
    }
    #cb-typing.cb-active { display: inline-flex; gap: 4px; }
    #cb-typing span {
      width: 6px; height: 6px;
      background: #94a3b8;
      border-radius: 50%;
      display: inline-block;
      animation: cb-typing-bounce 1.1s infinite ease-in-out;
    }
    #cb-typing span:nth-child(2) { animation-delay: 0.15s; }
    #cb-typing span:nth-child(3) { animation-delay: 0.3s; }
    @keyframes cb-typing-bounce {
      0%, 60%, 100% { transform: translateY(0); opacity: 0.5; }
      30% { transform: translateY(-4px); opacity: 1; }
    }

    #cb-lead-form {
      position: relative;
      padding: 12px 16px;
      border-top: 1px solid #e2e8f0;
      display: none;
      flex-direction: column;
      gap: 8px;
      background: #fff;
      flex-shrink: 0;
    }
    #cb-lead-form.cb-open { display: flex; }
    #cb-lead-hint {
      font-size: 12px;
      color: #64748b;
      line-height: 1.4;
      padding-right: 22px;
    }
    #cb-lead-dismiss {
      position: absolute;
      top: 8px;
      right: 10px;
      background: none;
      border: none;
      color: #94a3b8;
      font-size: 16px;
      line-height: 1;
      cursor: pointer;
      padding: 4px;
      border-radius: 4px;
    }
    #cb-lead-dismiss:hover { color: #475569; }
    #cb-lead-dismiss:focus-visible { outline-color: var(--cb-theme); box-shadow: none; }
    #cb-lead-error {
      display: none;
      font-size: 12px;
      color: #dc2626;
      background: #fef2f2;
      border: 1px solid #fecaca;
      border-radius: 6px;
      padding: 6px 10px;
      line-height: 1.4;
    }
    #cb-lead-form input, #cb-input {
      border: 1px solid #cbd5e1;
      border-radius: 8px;
      font-family: inherit;
      color: #1e293b;
      background: #fff;
      outline: none;
      transition: border-color 0.15s, box-shadow 0.15s;
    }
    #cb-lead-form input { padding: 8px 12px; font-size: 13px; }
    #cb-lead-form input:focus, #cb-input:focus {
      border-color: var(--cb-theme);
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--cb-theme) 22%, transparent);
    }
    #cb-lead-submit {
      background: var(--cb-theme);
      color: #fff;
      border: none;
      border-radius: 8px;
      padding: 8px;
      cursor: pointer;
      font-size: 13px;
      font-weight: 600;
      font-family: inherit;
    }

    #cb-input-row {
      display: flex;
      gap: 8px;
      padding: 12px 16px;
      border-top: 1px solid #e2e8f0;
      background: #fff;
      flex-shrink: 0;
    }
    #cb-input { flex: 1; min-width: 0; padding: 9px 12px; font-size: 14px; }
    #cb-send {
      background: var(--cb-theme);
      color: #fff;
      border: none;
      border-radius: 8px;
      padding: 0 16px;
      cursor: pointer;
      font-weight: 600;
      font-size: 14px;
      font-family: inherit;
      transition: opacity 0.15s;
    }
    #cb-send:disabled { opacity: 0.55; cursor: not-allowed; }

    /* Phones: the chat takes the whole screen, like a native messenger */
    @media (max-width: 480px) {
      #cb-panel {
        inset: 0;
        width: 100%;
        height: 100%;
        height: 100dvh;
        border-radius: 0;
        padding-bottom: env(safe-area-inset-bottom);
      }
      #cb-panel.cb-open ~ #cb-launcher { display: none; }   /* the header's close button takes over */
      #cb-header { padding-top: calc(14px + env(safe-area-inset-top)); }
      .cb-msg { max-width: 88%; }
      /* below 16px iOS Safari zooms the page when an input is focused */
      #cb-input, #cb-lead-form input { font-size: 16px; }
    }

    @media (prefers-reduced-motion: reduce) {
      #cb-launcher, #cb-panel.cb-open, .cb-msg, #cb-typing span { animation: none; transition: none; }
    }
  `;
}
