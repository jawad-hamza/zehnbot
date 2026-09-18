export function injectStyles(config) {
  const theme = config.theme_color || "#2563eb";
  const position = config.widget_position || "bottom-right";
  const font = config.font_family || '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  const positionCss = position === "bottom-left"
    ? "left: 24px; right: auto;"
    : "right: 24px; left: auto;";
  const panelCornerRadius = position === "bottom-left"
    ? "border-bottom-left-radius: 4px;"
    : "border-bottom-right-radius: 4px;";

  const style = document.createElement("style");
  style.textContent = `
    :root {
      --cb-theme: ${theme};
      --cb-font: ${font};
    }

    #cb-launcher {
      position: fixed;
      bottom: 24px;
      ${positionCss}
      width: 56px;
      height: 56px;
      border-radius: 50%;
      background: var(--cb-theme);
      color: #fff;
      border: none;
      cursor: pointer;
      font-size: 24px;
      box-shadow: 0 4px 14px rgba(0,0,0,0.25);
      z-index: 99998;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: transform 0.18s ease, box-shadow 0.18s ease;
      animation: cb-launcher-pop 0.35s cubic-bezier(0.2,0.9,0.3,1.3);
    }
    #cb-launcher:hover { transform: scale(1.08); box-shadow: 0 6px 20px rgba(0,0,0,0.3); }
    #cb-launcher:active { transform: scale(0.96); }
    @keyframes cb-launcher-pop {
      from { transform: scale(0); opacity: 0; }
      to   { transform: scale(1); opacity: 1; }
    }

    #cb-panel {
      position: fixed;
      bottom: 92px;
      ${positionCss}
      width: 360px;
      max-height: 560px;
      background: #fff;
      border-radius: 16px;
      box-shadow: 0 12px 40px rgba(0,0,0,0.18);
      display: none;
      flex-direction: column;
      overflow: hidden;
      z-index: 99999;
      font-family: var(--cb-font);
      font-size: 14px;
      transform-origin: ${position === "bottom-left" ? "bottom left" : "bottom right"};
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
    }
    #cb-close {
      background: none;
      border: none;
      color: #fff;
      font-size: 20px;
      cursor: pointer;
      line-height: 1;
      padding: 0;
      opacity: 0.85;
      transition: opacity 0.15s;
    }
    #cb-close:hover { opacity: 1; }

    #cb-messages {
      flex: 1;
      overflow-y: auto;
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
      word-break: break-word;
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
    }
    .cb-msg--assistant {
      background: #eef2f7;
      color: #1e293b;
      align-self: flex-start;
      ${panelCornerRadius}
    }

    /* Typing indicator */
    #cb-typing {
      display: none;
      align-self: flex-start;
      background: #eef2f7;
      padding: 12px 16px;
      border-radius: 14px;
      ${panelCornerRadius}
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
      padding: 12px 16px;
      border-top: 1px solid #e2e8f0;
      display: flex;
      flex-direction: column;
      gap: 8px;
      background: #fff;
    }
    #cb-lead-hint {
      font-size: 12px;
      color: #64748b;
      line-height: 1.4;
    }
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
    #cb-lead-form input {
      padding: 8px 12px;
      border: 1px solid #cbd5e1;
      border-radius: 8px;
      font-size: 13px;
      font-family: inherit;
      outline: none;
      transition: border-color 0.15s;
    }
    #cb-lead-form input:focus { border-color: var(--cb-theme); }
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
    }
    #cb-input {
      flex: 1;
      padding: 9px 12px;
      border: 1px solid #cbd5e1;
      border-radius: 8px;
      font-size: 14px;
      font-family: inherit;
      outline: none;
      transition: border-color 0.15s;
    }
    #cb-input:focus { border-color: var(--cb-theme); }
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

    @media (max-width: 480px) {
      #cb-panel {
        width: calc(100vw - 24px);
        ${position === "bottom-left" ? "left: 12px;" : "right: 12px;"}
        bottom: 84px;
      }
    }
  `;
  document.head.appendChild(style);

  // Custom CSS goes after the base styles so it can override anything
  if (config.custom_css && typeof config.custom_css === "string" && config.custom_css.trim()) {
    const custom = document.createElement("style");
    custom.setAttribute("data-cb-custom", "1");
    custom.textContent = config.custom_css;
    document.head.appendChild(custom);
  }
}
