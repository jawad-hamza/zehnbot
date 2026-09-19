import { buildStyles } from "./styles.js";
import { renderRichText } from "./richtext.js";

const CHAT_ICON = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>`;

const ICON_ATTRS = `width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"`;
const SOUND_ON_ICON = `<svg ${ICON_ATTRS}><path d="M11 5 6 9H2v6h4l5 4V5z"></path><path d="M15.5 8.5a5 5 0 0 1 0 7"></path><path d="M18.5 5.5a9 9 0 0 1 0 13"></path></svg>`;
const SOUND_OFF_ICON = `<svg ${ICON_ATTRS}><path d="M11 5 6 9H2v6h4l5 4V5z"></path><path d="m22 9-6 6"></path><path d="m16 9 6 6"></path></svg>`;

/** Launcher picture URLs from the config, made absolute against the widget's own server. Only our media path is accepted. */
function launcherPictures(config) {
  const out = {};
  const given = config.launcher_images && typeof config.launcher_images === "object" ? config.launcher_images : {};
  for (const slot of ["normal", "hover", "open"]) {
    const path = given[slot];
    if (typeof path === "string" && path.startsWith("/api/public/media/")) {
      try {
        out[slot] = new URL(path, config.server_origin || location.origin).href;
      } catch {
        /* a malformed origin: no picture, the default icon shows */
      }
    }
  }
  return out;
}

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
      <span id="cb-header-actions">
        <button id="cb-mute" type="button" aria-pressed="false" aria-label="Mute message sound"></button>
        <button id="cb-close" type="button" aria-label="Close chat">&#x2715;</button>
      </span>
    </div>
    <div id="cb-messages" role="log" aria-live="polite" aria-relevant="additions">
      <div id="cb-typing" role="status" aria-label="Assistant is typing"><span></span><span></span><span></span></div>
    </div>
    <div id="cb-lead-form" role="group" aria-label="Leave your contact details">
      <button id="cb-lead-dismiss" type="button" aria-label="Not now">&#x2715;</button>
      <div id="cb-lead-hint">Leave your email or phone so our team can follow up. Both is even better.</div>
      <input id="cb-lead-name"  type="text"  placeholder="Your name"  aria-label="Your name"  autocomplete="name"  maxlength="255" />
      <input id="cb-lead-email" type="email" placeholder="Your email" aria-label="Your email" autocomplete="email" maxlength="255" />
      <input id="cb-lead-phone" type="tel"   placeholder="Your phone" aria-label="Your phone" autocomplete="tel"   maxlength="30" />
      <div id="cb-lead-error" role="alert"></div>
      <button id="cb-lead-submit" type="button">Send my details</button>
    </div>
    <div id="cb-input-row">
      <textarea id="cb-input" rows="1" placeholder="Type a message…" aria-label="Type a message. Enter sends, Shift+Enter starts a new line." autocomplete="off" maxlength="2000" enterkeyhint="send"></textarea>
      <button id="cb-send" type="button">Send</button>
    </div>
  `;
  root.appendChild(panel);

  const launcher = document.createElement("button");
  launcher.id = "cb-launcher";
  launcher.type = "button";
  launcher.setAttribute("aria-label", "Open chat");
  launcher.setAttribute("aria-expanded", "false");
  const pictures = launcherPictures(config);
  if (pictures.normal) {
    // The owner's own pictures (GIF, PNG or SVG): one at rest, optionally one on hover and one while open.
    // All are loaded up front so switching is instant; CSS decides which one shows.
    launcher.classList.add("cb-has-image");
    for (const slot of ["normal", "hover", "open"]) {
      if (!pictures[slot]) continue;
      if (slot !== "normal") launcher.classList.add("cb-has-" + slot);
      const img = document.createElement("img");
      img.className = "cb-img cb-img--" + slot;
      img.src = pictures[slot];
      img.alt = "";
      img.draggable = false;
      launcher.appendChild(img);
    }
  } else {
    launcher.innerHTML = CHAT_ICON;
  }
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
  // Enter sends; Shift+Enter is left alone, so the textarea does what it always does: a new line.
  // (isComposing: Enter that confirms an IME suggestion, e.g. in Japanese, must not send.)
  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      sendBtn.click();
    }
  });

  // The box grows with the message, up to a few lines, then scrolls
  const MAX_INPUT_HEIGHT = 112;
  function fitInput() {
    inputEl.style.height = "auto";
    inputEl.style.height = Math.min(inputEl.scrollHeight, MAX_INPUT_HEIGHT) + "px";
    inputEl.style.overflowY = inputEl.scrollHeight > MAX_INPUT_HEIGHT ? "auto" : "hidden";
  }
  inputEl.addEventListener("input", fitInput);

  // Sound: on unless the site owner switched it off for this bot; each visitor can mute it for themselves
  const muteBtn = $("cb-mute");
  const soundOffered = config.notification_sound !== false;
  let muted = false;
  try {
    muted = localStorage.getItem("cb_muted") === "1";
  } catch {
    /* storage blocked: the choice just won't be remembered */
  }
  function renderMute() {
    muteBtn.innerHTML = muted ? SOUND_OFF_ICON : SOUND_ON_ICON;
    muteBtn.setAttribute("aria-pressed", String(muted));
    muteBtn.setAttribute("aria-label", muted ? "Unmute message sound" : "Mute message sound");
    muteBtn.title = muted ? "Sound is off" : "Sound is on";
  }
  if (soundOffered) {
    renderMute();
    muteBtn.addEventListener("click", () => {
      muted = !muted;
      try {
        localStorage.setItem("cb_muted", muted ? "1" : "0");
      } catch {
        /* see above */
      }
      renderMute();
    });
  } else {
    muteBtn.remove();
  }

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
    root,
    launcher,
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
    soundOn: () => soundOffered && !muted,
    clearInput: () => {
      inputEl.value = "";
      fitInput();
    },
    onOpenChange: (fn) => openListeners.push(fn),
    /** Replies the visitor has not seen yet: a count on the launcher, also said by screen readers. */
    setUnread: (count) => {
      if (count > 0) {
        launcher.setAttribute("data-unread", count > 9 ? "9+" : String(count));
        launcher.setAttribute("aria-label", `Open chat, ${count} new ${count === 1 ? "message" : "messages"}`);
      } else {
        launcher.removeAttribute("data-unread");
        launcher.setAttribute("aria-label", panel.classList.contains("cb-open") ? "Close chat" : "Open chat");
      }
    },
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
