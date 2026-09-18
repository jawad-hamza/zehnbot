import { buildStyles } from "./styles.js";
import { renderRichText } from "./richtext.js";

const CHAT_ICON = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>`;

export function buildWidget(config) {
  // One host element on the page; everything else lives in its shadow root, so the customer's
  // CSS cannot break the widget and the widget's ids/classes cannot collide with the page's.
  const host = document.createElement("div");
  host.id = "cb-widget-root";
  const root = host.attachShadow({ mode: "open" });

  const style = document.createElement("style");
  style.textContent = buildStyles(config);
  root.appendChild(style);

  // Tenant's custom CSS goes after the base styles so it can override anything.
  // Selectors like #cb-launcher or .cb-msg--user keep working: they are matched inside the shadow root.
  if (typeof config.custom_css === "string" && config.custom_css.trim()) {
    const custom = document.createElement("style");
    custom.setAttribute("data-cb-custom", "1");
    custom.textContent = config.custom_css;
    root.appendChild(custom);
  }

  // The panel comes before the launcher in the DOM: the mobile rule `#cb-panel.cb-open ~ #cb-launcher` relies on it
  const panel = document.createElement("div");
  panel.id = "cb-panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", config.bot_name || "Chat");
  panel.innerHTML = `
    <div id="cb-header">
      <span id="cb-botname"></span>
      <button id="cb-close" type="button" aria-label="Close chat">&#x2715;</button>
    </div>
    <div id="cb-messages" role="log" aria-live="polite" aria-relevant="additions">
      <div id="cb-typing" role="status" aria-label="Assistant is typing"><span></span><span></span><span></span></div>
    </div>
    <div id="cb-lead-form" role="group" aria-label="Leave your contact details">
      <button id="cb-lead-dismiss" type="button" aria-label="Not now">&#x2715;</button>
      <div id="cb-lead-hint">Leave your email or phone so our team can follow up — both is even better.</div>
      <input id="cb-lead-name"  type="text"  placeholder="Your name"  aria-label="Your name"  autocomplete="name"  maxlength="255" />
      <input id="cb-lead-email" type="email" placeholder="Your email" aria-label="Your email" autocomplete="email" maxlength="255" />
      <input id="cb-lead-phone" type="tel"   placeholder="Your phone" aria-label="Your phone" autocomplete="tel"   maxlength="30" />
      <div id="cb-lead-error" role="alert"></div>
      <button id="cb-lead-submit" type="button">Send my details</button>
    </div>
    <div id="cb-input-row">
      <input id="cb-input" type="text" placeholder="Type a message…" aria-label="Type a message" autocomplete="off" maxlength="2000" enterkeyhint="send" />
      <button id="cb-send" type="button">Send</button>
    </div>
  `;
  root.appendChild(panel);

  const launcher = document.createElement("button");
  launcher.id = "cb-launcher";
  launcher.type = "button";
  launcher.setAttribute("aria-label", "Open chat");
  launcher.setAttribute("aria-expanded", "false");
  launcher.innerHTML = CHAT_ICON;
  root.appendChild(launcher);

  const $ = (id) => root.getElementById(id);
  $("cb-botname").textContent = config.bot_name || "Assistant";   // textContent: never parsed as HTML

  const messagesEl = $("cb-messages");
  const typingEl = $("cb-typing");
  const inputEl = $("cb-input");
  const sendBtn = $("cb-send");
  const leadForm = $("cb-lead-form");
  const openListeners = [];

  function setOpen(open, { focus = true } = {}) {
    panel.classList.toggle("cb-open", open);
    launcher.setAttribute("aria-expanded", String(open));
    launcher.setAttribute("aria-label", open ? "Close chat" : "Open chat");
    if (open) {
      scrollToEnd();
      if (focus) inputEl.focus({ preventScroll: true });
    } else if (focus) {
      launcher.focus({ preventScroll: true });
    }
    openListeners.forEach((fn) => fn(open));
  }

  function scrollToEnd() {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  // Keep following the reply while it streams in, unless the visitor has scrolled up to re-read
  function isNearEnd() {
    return messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 60;
  }

  launcher.addEventListener("click", () => setOpen(!panel.classList.contains("cb-open")));
  $("cb-close").addEventListener("click", () => setOpen(false));
  panel.addEventListener("keydown", (e) => {
    if (e.key === "Escape") setOpen(false);
  });
  // Typing in the chat must not fire the host page's keyboard shortcuts ("/" to search, "s" to star, ...)
  ["keydown", "keyup", "keypress"].forEach((type) => panel.addEventListener(type, (e) => e.stopPropagation()));
  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      sendBtn.click();
    }
  });

  /** Adds a bubble and returns a handle for updating it (used while a reply streams in). */
  function appendMessage(role, text, { error = false } = {}) {
    const div = document.createElement("div");
    div.className = `cb-msg cb-msg--${role}` + (error ? " cb-msg--error" : "");
    const render = (value) => {
      if (role === "assistant" && !error) renderRichText(div, value);
      else div.textContent = value;
    };
    render(text);
    messagesEl.insertBefore(div, typingEl);
    scrollToEnd();
    return {
      el: div,
      update(value) {
        const follow = isNearEnd();
        render(value);
        if (follow) scrollToEnd();
      },
      setStreaming(on) {
        // a busy region is announced once it settles, not on every token
        if (on) div.setAttribute("aria-busy", "true");
        else div.removeAttribute("aria-busy");
      },
    };
  }

  return {
    host,
    panel,
    input: inputEl,
    sendBtn,
    leadForm,
    leadName: $("cb-lead-name"),
    leadEmail: $("cb-lead-email"),
    leadPhone: $("cb-lead-phone"),
    leadSubmit: $("cb-lead-submit"),
    leadDismiss: $("cb-lead-dismiss"),
    setOpen,
    isOpen: () => panel.classList.contains("cb-open"),
    onOpenChange: (fn) => openListeners.push(fn),
    showLeadForm: (show) => {
      leadForm.classList.toggle("cb-open", show);
      if (show) scrollToEnd();
    },
    setLeadError: (text) => {
      const el = $("cb-lead-error");
      el.textContent = text || "";
      el.style.display = text ? "block" : "none";
    },
    appendMessage,
    setTyping: (on) => {
      typingEl.classList.toggle("cb-active", !!on);
      if (on) scrollToEnd();
    },
    setBusy: (on) => {
      sendBtn.disabled = on;
      inputEl.disabled = on;
      if (!on && panel.classList.contains("cb-open")) inputEl.focus({ preventScroll: true });
    },
  };
}
