import { setApiBase, fetchConfig, sendMessage, submitLead } from "./api.js";
import { injectStyles } from "./styles.js";
import { buildWidget } from "./ui.js";

(function () {
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
  try {
    setApiBase(new URL(srcUrl).origin + "/api");
  } catch {
    // fall through to default
  }

  // Per-tab session — cleared when tab closes, persists on refresh
  const storageKey = "cb_session_" + clientId;
  let sessionId = sessionStorage.getItem(storageKey);
  if (!sessionId) {
    sessionId = crypto.randomUUID();
    sessionStorage.setItem(storageKey, sessionId);
  }

  // Boot sequence
  fetchConfig(clientId)
    .then((config) => {
      injectStyles(config);
      const ui = buildWidget(config);
      attachHandlers(ui, clientId, sessionId, config);
    })
    .catch((err) => console.error("[ChatBot] Init failed:", err));
})();

function attachHandlers(ui, clientId, sessionId, config) {
  let history = [];
  let conversationId = null;
  let messageCount = 0;
  const LEAD_PROMPT_AFTER = 3; // show lead form after this many user messages

  // Add welcome message
  ui.appendMessage("assistant", config.welcome_message);

  // Send message
  ui.sendBtn.addEventListener("click", async () => {
    const text = ui.input.value.trim();
    if (!text) return;

    ui.appendMessage("user", text);
    ui.input.value = "";
    ui.setLoading(true);
    history.push({ role: "user", content: text });
    messageCount++;

    try {
      const data = await sendMessage(clientId, sessionId, text, history);
      conversationId = data.conversation_id;
      history.push({ role: "assistant", content: data.reply });
      ui.appendMessage("assistant", data.reply);

      // Show lead capture form after N user messages
      if (messageCount >= LEAD_PROMPT_AFTER && ui.leadForm.style.display === "none") {
        ui.leadForm.style.display = "flex";
      }
    } catch {
      ui.appendMessage("assistant", "Sorry, something went wrong. Please try again.");
    } finally {
      ui.setLoading(false);
    }
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
      (email ? ui.leadPhone : ui.leadEmail).focus();
      return;
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      ui.setLeadError("That email doesn't look right — please check it.");
      ui.leadEmail.focus();
      return;
    }
    ui.setLeadError("");

    ui.leadSubmit.disabled = true;
    ui.leadSubmit.textContent = "Sending…";

    let handled = false;
    const resetButton = () => {
      if (handled) return;
      handled = true;
      ui.leadSubmit.disabled = false;
      ui.leadSubmit.textContent = "Send my details";
    };

    // Safety: if the request somehow never resolves, recover after 8s
    const safetyTimer = setTimeout(resetButton, 8000);

    try {
      await submitLead(clientId, conversationId, name, email, phone);
      handled = true;
      clearTimeout(safetyTimer);
      ui.leadForm.style.display = "none";
      ui.leadSubmit.disabled = false;
      ui.leadSubmit.textContent = "Send my details";
      ui.leadName.value = "";
      ui.leadEmail.value = "";
      ui.leadPhone.value = "";
      ui.appendMessage("assistant", "Thanks! We'll be in touch soon.");
    } catch {
      clearTimeout(safetyTimer);
      resetButton();
      ui.appendMessage("assistant", "Couldn't send your details just now — please try again.");
    }
  });
}
