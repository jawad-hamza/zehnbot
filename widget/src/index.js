import { setApiBase, fetchConfig, sendMessage, streamMessage, canStream, submitLead } from "./api.js";
import { buildWidget } from "./ui.js";
import { primeAudio, playChirp } from "./sound.js";

const MAX_MESSAGE_CHARS = 2000; // keep in sync with the server's MAX_MESSAGE_CHARS
const MAX_STORED_MESSAGES = 60;

(function () {
  if (window.__cbWidgetLoaded) return; // the snippet was pasted twice
  window.__cbWidgetLoaded = true;

  // Read client_id from the script tag's src URL
  const scriptTag =
    document.currentScript ||
    document.querySelector('script[src*="widget.js"]');

  if (!scriptTag) {
    console.error("[ChatBot] Could not find script tag");
    return;
  }

  const srcUrl = scriptTag.src || "";
  const qIdx = srcUrl.indexOf("?");
  const params = new URLSearchParams(qIdx >= 0 ? srcUrl.slice(qIdx + 1) : "");
  const clientId = params.get("client_id");

  if (!clientId) {
    console.error("[ChatBot] Missing client_id parameter in script src");
    return;
  }

  // Derive API base from the script's own origin so the widget calls back to
  // the server that hosts it, regardless of the site it's embedded on.
  let serverOrigin = location.origin;
  try {
    serverOrigin = new URL(srcUrl).origin;
    setApiBase(serverOrigin + "/api");
  } catch {
    // fall through to default
  }

  const boot = () =>
    fetchConfig(clientId)
      .then((config) => {
        config.server_origin = serverOrigin;
        const ui = buildWidget(config);
        document.body.appendChild(ui.host);
        const events = attachHandlers(ui, clientId, config);
        runOwnerScript(config, ui, events, serverOrigin);
      })
      .catch((err) => {
        // Nothing is rendered: a chat that cannot work should not appear. The reason goes to the
        // console, where the site owner (not the visitor) will look.
        if (err && err.status === 403 && location.protocol === "file:") {
          // the most common first-test mistake, so it gets its own explanation
          console.warn(
            "[ChatBot] Not shown: this page was opened as a file (file://). Browsers then hide where the " +
            "page comes from, and the chat server refuses such requests. Open the page through a web " +
            "server instead, e.g. http://localhost:5500/ (python -m http.server 5500), or use the " +
            "Preview button in the dashboard."
          );
        } else if (err && err.status === 403) {
          console.warn(
            `[ChatBot] Not shown: "${location.hostname}" is not listed in this bot's Website setting. ` +
            "Add it in the dashboard (Bots → Edit → Website). localhost always works for testing."
          );
        } else if (err && err.status === 404) {
          console.warn(`[ChatBot] Not shown: no active bot has the client_id "${clientId}". Copy the embed code again from the dashboard.`);
        } else {
          console.error("[ChatBot] Init failed:", err);
        }
      });

  // Without `defer`, a script in <head> runs before <body> exists
  if (document.body) boot();
  else document.addEventListener("DOMContentLoaded", boot, { once: true });
})();

/**
 * The bot owner's own JavaScript (dashboard → Bots → Edit → Custom JavaScript). It gets one argument,
 * `zehnbot`: open(), close(), toggle(), isOpen(), on("open" | "close" | "message", fn), and `root`, the
 * widget's shadow root, for anything else. It runs on the owner's website only: the server does not send
 * it to the platform's own pages, and it is skipped here too if the page is on the widget's own server.
 */
function runOwnerScript(config, ui, events, serverOrigin) {
  const code = typeof config.custom_js === "string" ? config.custom_js.trim() : "";
  if (!code || location.origin === serverOrigin) return;
  const zehnbot = Object.freeze({
    root: ui.root,
    open: () => ui.setOpen(true),
    close: () => ui.setOpen(false),
    toggle: () => ui.setOpen(!ui.isOpen()),
    isOpen: () => ui.isOpen(),
    on: (name, fn) => events.on(name, fn),
  });
  try {
    new Function("zehnbot", code)(zehnbot);   // eslint-disable-line no-new-func
  } catch (err) {
    // A site whose Content-Security-Policy forbids it, or a bug in the owner's code: the chat keeps working
    console.warn("[ChatBot] The bot's custom JavaScript did not run:", err && err.message ? err.message : err);
  }
}

/** A tiny event emitter for the owner's script. A listener that throws never breaks the chat. */
function emitter() {
  const listeners = {};
  return {
    on(name, fn) {
      if (typeof fn === "function") (listeners[name] = listeners[name] || []).push(fn);
    },
    emit(name, detail) {
      (listeners[name] || []).forEach((fn) => {
        try {
          fn(detail);
        } catch (err) {
          console.warn(`[ChatBot] A custom "${name}" listener failed:`, err);
        }
      });
    },
  };
}

// crypto.randomUUID only exists on secure origins (https, localhost); many small-business sites are
// still plain http, where getRandomValues is available and just as unguessable.
function newSessionId() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Per-tab memory: survives reloads and page-to-page navigation, gone when the tab closes. */
function tabStore(clientId) {
  const key = "cb_chat_" + clientId;
  let state;
  try {
    state = JSON.parse(sessionStorage.getItem(key) || "null");
  } catch {
    state = null; // storage blocked, or something else wrote garbage under our key
  }
  if (!state || typeof state.sessionId !== "string" || !Array.isArray(state.messages)) {
    state = { sessionId: newSessionId(), messages: [], conversationId: null, leadDone: false, leadDismissed: false, open: false };
  }
  const save = () => {
    try {
      state.messages = state.messages.slice(-MAX_STORED_MESSAGES);
      sessionStorage.setItem(key, JSON.stringify(state));
    } catch {
      /* private mode or quota: the chat still works, it just won't survive a reload */
    }
  };
  return { state, save };
}

function attachHandlers(ui, clientId, config) {
  const { state, save } = tabStore(clientId);
  const events = emitter();
  const LEAD_DONE_MESSAGE = "Thanks! We'll be in touch soon.";

  // Pick up where the visitor left off on the previous page
  if (state.messages.length) {
    state.messages.forEach((m) => ui.appendMessage(m.role, m.text));
  } else {
    ui.appendMessage("assistant", config.welcome_message);
    state.messages.push({ role: "assistant", text: config.welcome_message });
    save();
  }
  if (state.open) ui.setOpen(true, { focus: false });
  ui.onOpenChange((open) => {
    state.open = open;
    save();
    events.emit(open ? "open" : "close");
  });

  const remember = (role, text) => {
    state.messages.push({ role, text });
    save();
  };

  function applySummary(summary) {
    if (summary.conversation_id) state.conversationId = summary.conversation_id;
    if (summary.lead_captured) {
      // the visitor typed their details into the chat: never ask for them again
      state.leadDone = true;
      ui.showLeadForm(false);
    } else if (summary.show_lead_form && !state.leadDone && !state.leadDismissed) {
      ui.showLeadForm(true);
    }
    save();
  }

  const failureText = (err) => {
    const status = err && err.status;
    if (status === 429) return "We're getting a lot of messages right now. Please try again in a minute.";
    if (status === 403) {
      console.warn(`[ChatBot] Refused: "${location.hostname}" is not listed in this bot's Website setting (dashboard → Bots → Edit).`);
      return "This chat isn't available on this website.";
    }
    return "Sorry, something went wrong. Please try again.";
  };

  // Send message
  ui.sendBtn.addEventListener("click", async () => {
    const text = ui.input.value.trim().slice(0, MAX_MESSAGE_CHARS);
    if (!text) return;

    ui.appendMessage("user", text);
    remember("user", text);
    events.emit("message", { role: "user", text });
    ui.clearInput();
    ui.setBusy(true);
    if (ui.soundOn()) primeAudio(); // inside the click, so the browser lets the reply make a sound
    ui.setTyping(true);

    let bubble = null;
    let reply = "";
    try {
      let summary;
      if (canStream) {
        summary = await streamMessage(clientId, state.sessionId, text, (piece) => {
          reply += piece;
          if (!bubble) {
            ui.setTyping(false); // the first words replace the typing dots
            if (ui.soundOn()) playChirp();
            bubble = ui.appendMessage("assistant", reply);
            bubble.setStreaming(true);
          } else {
            bubble.update(reply);
          }
        });
      } else {
        summary = await sendMessage(clientId, state.sessionId, text);
        reply = summary.reply;
        if (ui.soundOn()) playChirp();
        ui.appendMessage("assistant", reply);
      }
      remember("assistant", reply.trim());
      events.emit("message", { role: "assistant", text: reply.trim() });
      applySummary(summary);
    } catch (err) {
      if (reply.trim()) remember("assistant", reply.trim()); // keep what did arrive
      ui.appendMessage("assistant", failureText(err), { error: true });
    } finally {
      if (bubble) bubble.setStreaming(false);
      ui.setTyping(false);
      ui.setBusy(false);
    }
  });

  ui.leadDismiss.addEventListener("click", () => {
    state.leadDismissed = true;
    save();
    ui.showLeadForm(false);
    ui.input.focus({ preventScroll: true });
  });

  // Lead form submission
  ui.leadSubmit.addEventListener("click", async (e) => {
    e.preventDefault();

    const name  = ui.leadName.value.trim() || null;
    const email = ui.leadEmail.value.trim() || null;
    const phone = ui.leadPhone.value.trim() || null;

    // Must have at least one way to contact the user
    if (!email && !phone) {
      ui.setLeadError("Please add your email or phone so we can reach you.");
      ui.leadEmail.focus();
      return;
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      ui.setLeadError("That email doesn't look right. Please check it.");
      ui.leadEmail.focus();
      return;
    }
    ui.setLeadError("");

    ui.leadSubmit.disabled = true;
    ui.leadSubmit.textContent = "Sending…";
    try {
      await submitLead(clientId, state.conversationId, name, email, phone);
      state.leadDone = true;
      ui.showLeadForm(false);
      ui.leadName.value = "";
      ui.leadEmail.value = "";
      ui.leadPhone.value = "";
      ui.appendMessage("assistant", LEAD_DONE_MESSAGE);
      remember("assistant", LEAD_DONE_MESSAGE);
    } catch (err) {
      ui.setLeadError(
        err && err.status === 422
          ? "Please check your email and phone number."
          : "Couldn't send your details just now. Please try again."
      );
    } finally {
      ui.leadSubmit.disabled = false;
      ui.leadSubmit.textContent = "Send my details";
    }
  });

  return events;
}
