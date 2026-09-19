// Runs the REAL built widget bundle in jsdom against a fake server:  npm test
// Covers what unit tests cannot: Shadow DOM isolation, streamed rendering, XSS safety of bot
// replies, the lead form, and transcript restore across page loads.
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const BUNDLE = fs.readFileSync(process.argv[2] || path.join(__dirname, "../../backend/static/widget.js"), "utf8");
const results = [];
const check = (name, ok, detail) => {
  results.push(ok);
  console.log(`  [${ok ? "PASS" : "FAIL"}] ${name}${!ok && detail !== undefined ? "   -> " + JSON.stringify(detail) : ""}`);
};
const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));

const CONFIG = { bot_name: "Acme <b>Bot</b>", welcome_message: "Hi! How can I help?", theme_color: "#0f766e", widget_position: "bottom-right", font_family: null, custom_css: "#cb-launcher { border-radius: 12px; }" };

// A reply that tries everything: markdown, a link, an XSS payload, a javascript: link, and a control tag
const REPLY = "We have **two plans**:\n- Basic\n- Pro\n\nSee https://acme.com/pricing. <img src=x onerror=alert(1)> [click](javascript:alert(1)) and [docs](https://acme.com/docs)";

function sse(events) {
  return events.map((e) => "data: " + JSON.stringify(e) + "\n\n").join("");
}

function streamingResponse(text, chunkSize) {
  const bytes = new TextEncoder().encode(text);
  let at = 0;
  return new Response(new ReadableStream({
    async pull(controller) {
      if (at >= bytes.length) return controller.close();
      await tick(2);
      controller.enqueue(bytes.slice(at, at + chunkSize));   // cuts events (and UTF-8 sequences) in the middle
      at += chunkSize;
    },
  }), { status: 200, headers: { "content-type": "text/event-stream" } });
}

function makeServer(log, behaviour) {
  return async (url, options = {}) => {
    const path = new URL(url).pathname;
    const body = options.body ? JSON.parse(options.body) : null;
    log.push({ path, body });
    if (path === "/api/widget/config") {
      if (behaviour.config === "forbidden") return new Response(JSON.stringify({ detail: "not allowed" }), { status: 403 });
      return new Response(JSON.stringify({ ...CONFIG, ...(behaviour.configOverride || {}) }), { status: 200 });
    }
    if (path === "/api/chat/stream" && behaviour.chat === "forbidden") return new Response("{}", { status: 403 });
    if (path === "/api/chat/stream") {
      if (behaviour.chat === "limited") return new Response("{}", { status: 429 });
      const pieces = REPLY.match(/[\s\S]{1,9}/g).map((text) => ({ type: "delta", text }));
      if (behaviour.chat === "breaks") return streamingResponse(sse([...pieces.slice(0, 3), { type: "error", detail: "unavailable" }]), 7);
      return streamingResponse(sse([...pieces, { type: "done", conversation_id: "11111111-2222-3333-4444-555555555555", show_lead_form: true, lead_captured: false }]), 7);
    }
    if (path === "/api/leads/capture") return new Response(JSON.stringify({ lead_id: "x" }), { status: 201 });
    return new Response("{}", { status: 404 });
  };
}

async function load(stored, behaviour = {}) {
  const dom = new JSDOM(`<!doctype html><html><head><style>div, button, input { display: none !important; color: red; } body { font-family: "Site Grotesk", Georgia, serif; }</style></head>
    <body><div id="cb-panel">the site's own element with a clashing id</div>
    <script src="https://chat.example/static/widget.js?client_id=acme-bot"></script></body></html>`,
    { url: "https://www.acme.com/pricing", runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window;
  const log = [];
  Object.assign(w, { fetch: makeServer(log, behaviour), Response, ReadableStream, TextDecoder, TextEncoder });

  // jsdom has no Web Audio. This stand-in only counts the notes the widget asks for.
  const notes = [];
  const param = () => ({ setValueAtTime() {}, exponentialRampToValueAtTime() {} });
  w.AudioContext = class {
    constructor() { this.state = "running"; this.currentTime = 0; this.destination = {}; }
    resume() {}
    createOscillator() { return { frequency: param(), connect: (x) => x, start: () => notes.push("note"), stop() {} }; }
    createGain() { return { gain: param(), connect: (x) => x }; }
  };
  if (behaviour.muted) w.localStorage.setItem("cb_muted", "1");
  w.HTMLElement.prototype.focus = function () {};
  if (stored) w.sessionStorage.setItem("cb_chat_acme-bot", stored);
  const errors = [];
  w.addEventListener("error", (e) => errors.push(String(e.error || e.message)));
  w.console.error = (...a) => errors.push(a.join(" "));
  const warnings = [];
  w.console.warn = (...a) => warnings.push(a.join(" "));
  w.eval(BUNDLE);
  await tick(60);
  const host = w.document.getElementById("cb-widget-root");
  return { w, log, errors, warnings, notes, host, root: host && host.shadowRoot, $: (id) => host.shadowRoot.getElementById(id) };
}

// Wait for the widget to finish (send button re-enabled), not for a guessed amount of time
async function send(page, text) {
  page.$("cb-input").value = text;
  page.$("cb-send").click();
  await tick(20);
  for (let i = 0; i < 400 && page.$("cb-send").disabled; i++) await tick(25);
  await tick(20);
}

(async () => {
  console.log("isolation");
  let page = await load();
  check("widget mounts without errors", !!page.root && page.errors.length === 0, page.errors);
  check("everything lives in a shadow root (nothing but the host is added to the page)", page.w.document.querySelectorAll("#cb-launcher, #cb-messages, .cb-msg").length === 0);
  check("a clashing id on the host page is left alone", page.w.document.getElementById("cb-panel").textContent.includes("site's own element"));
  check("styles are inside the shadow root, not in the page <head>", page.root.querySelectorAll("style").length === 2 && page.w.document.head.querySelectorAll("style").length === 1);
  check("tenant custom CSS is applied inside the shadow root", page.root.querySelector("style[data-cb-custom]").textContent.includes("border-radius: 12px"));
  check("bot name is text, not HTML", page.$("cb-botname").textContent === "Acme <b>Bot</b>" && page.$("cb-botname").children.length === 0);

  console.log("accessibility");
  const launcher = page.$("cb-launcher");
  check("launcher is labelled and reports its state", launcher.getAttribute("aria-label") === "Open chat" && launcher.getAttribute("aria-expanded") === "false");
  launcher.click();
  check("opening updates the state", page.$("cb-panel").classList.contains("cb-open") && launcher.getAttribute("aria-expanded") === "true");
  check("panel is a labelled dialog with a live message log", page.$("cb-panel").getAttribute("role") === "dialog" && page.$("cb-messages").getAttribute("aria-live") === "polite");
  page.$("cb-input").dispatchEvent(new page.w.KeyboardEvent("keydown", { key: "Escape", bubbles: true, composed: true }));
  check("Escape closes the chat", !page.$("cb-panel").classList.contains("cb-open"));
  let leaked = false;
  page.w.document.addEventListener("keydown", () => (leaked = true));
  page.$("cb-input").dispatchEvent(new page.w.KeyboardEvent("keydown", { key: "s", bubbles: true, composed: true }));
  check("keystrokes do not reach the host page's shortcut handlers", !leaked);
  launcher.click();

  console.log("streaming and rich text");
  await send(page, "what plans do you have?");
  const bubbles = () => [...page.root.querySelectorAll(".cb-msg")];
  const bot = bubbles()[2];
  check("visitor bubble, then one bot bubble", bubbles().length === 3 && bubbles()[1].textContent === "what plans do you have?", bubbles().map((b) => b.className));
  check("reply was reassembled from events split mid-way", bot && bot.textContent.includes("We have two plans:") && bot.textContent.includes("and docs"), bot && bot.textContent);
  check("no history is sent from the browser", page.log.find((r) => r.path === "/api/chat/stream").body.history === undefined);
  check("markdown: bold", bot.querySelector("strong") && bot.querySelector("strong").textContent === "two plans");
  check("markdown: bullet list", bot.querySelectorAll("ul > li").length === 2);
  const links = [...bot.querySelectorAll("a")];
  check("bare URL becomes a safe link without the trailing full stop", links[0] && links[0].href === "https://acme.com/pricing" && links[0].rel.includes("noopener") && links[0].target === "_blank", links.map((a) => a.href));
  check("XSS: HTML in a reply is shown as text, never parsed", bot.querySelectorAll("img, script").length === 0 && bot.textContent.includes("<img src=x onerror=alert(1)>"));
  check("XSS: javascript: links are not created", links.every((a) => a.protocol === "https:") && links.length === 2, links.map((a) => a.href));
  check("typing indicator and busy state are cleared", !page.$("cb-typing").classList.contains("cb-active") && !page.$("cb-send").disabled && !bot.hasAttribute("aria-busy"));

  console.log("lead form");
  check("form opens when the server says the bot asked for details", page.$("cb-lead-form").classList.contains("cb-open"));
  page.$("cb-lead-submit").click();
  await tick();
  check("empty form is rejected locally", page.$("cb-lead-error").textContent.includes("email or phone") && !page.log.some((r) => r.path === "/api/leads/capture"));
  page.$("cb-lead-email").value = "dana@example.com";
  page.$("cb-lead-submit").click();
  await tick(80);
  const leadCall = page.log.find((r) => r.path === "/api/leads/capture");
  check("lead is sent with the conversation id from the stream", leadCall && leadCall.body.conversation_id === "11111111-2222-3333-4444-555555555555" && leadCall.body.email === "dana@example.com", leadCall);
  check("form closes and the visitor is thanked", !page.$("cb-lead-form").classList.contains("cb-open") && bubbles().at(-1).textContent.includes("be in touch"));

  console.log("persistence across page loads");
  const stored = page.w.sessionStorage.getItem("cb_chat_acme-bot");
  const sessionId = JSON.parse(stored).sessionId;
  let next = await load(stored);
  const restored = [...next.root.querySelectorAll(".cb-msg")];
  check("transcript is restored on the next page", restored.length === 4 && restored[2].querySelector("strong") !== null, restored.length);
  check("chat stays open, same session continues", next.$("cb-panel").classList.contains("cb-open") && JSON.parse(next.w.sessionStorage.getItem("cb_chat_acme-bot")).sessionId === sessionId);
  await send(next, "one more question");
  check("the form is not shown again once details were given", !next.$("cb-lead-form").classList.contains("cb-open"));
  next = await load("{not json");
  check("corrupt storage is ignored, not fatal", next.errors.length === 0 && next.root.querySelectorAll(".cb-msg").length === 1);

  console.log("failures");
  page = await load(null, { chat: "limited" });
  await send(page, "hello");
  let last = [...page.root.querySelectorAll(".cb-msg")].at(-1);
  check("429 gives a friendly, specific message", last.classList.contains("cb-msg--error") && last.textContent.includes("lot of messages"), last.textContent);
  check("input is usable again after a failure", !page.$("cb-send").disabled && !page.$("cb-input").disabled);
  page = await load(null, { chat: "breaks" });
  await send(page, "hello");
  const after = [...page.root.querySelectorAll(".cb-msg")];
  check("a reply that breaks mid-stream keeps what arrived and says so", after.length === 4 && after[2].textContent.startsWith("We have") && after[3].classList.contains("cb-msg--error"), after.map((b) => b.textContent.slice(0, 30)));

  console.log("typing: Enter sends, Shift+Enter starts a new line");
  page = await load();
  const box = page.$("cb-input");
  check("the message box is multi-line", box.tagName === "TEXTAREA");
  box.value = "line one";
  const key = (opts) => box.dispatchEvent(new page.w.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true, composed: true, ...opts }));
  const shiftEnterLeftAlone = key({ shiftKey: true });      // dispatchEvent returns false when preventDefault() was called
  await tick(40);
  check("Shift+Enter does not send, and is not blocked (the browser inserts the new line)", shiftEnterLeftAlone === true && !page.log.some((r) => r.path === "/api/chat/stream"));
  box.value = "line one\nline two";
  const enterHandled = key({});
  check("Enter sends instead of adding a line", enterHandled === false);
  for (let i = 0; i < 400 && page.$("cb-send").disabled; i++) await tick(25);
  const sentBody = page.log.find((r) => r.path === "/api/chat/stream").body;
  check("both lines reach the server as one message", sentBody.message === "line one\nline two", sentBody.message);
  check("the visitor's bubble keeps the line break, and the box is emptied", [...page.root.querySelectorAll(".cb-msg--user")].at(-1).textContent === "line one\nline two" && box.value === "");

  console.log("message sound");
  check("a reply plays the two-note chirp once", page.notes.length === 2, page.notes.length);
  const mute = page.$("cb-mute");
  check("the visitor gets a labelled mute button", mute && mute.getAttribute("aria-label") === "Mute message sound" && mute.getAttribute("aria-pressed") === "false");
  mute.click();
  await send(page, "again");
  check("muted: no sound, and the choice is remembered", page.notes.length === 2 && mute.getAttribute("aria-pressed") === "true" && page.w.localStorage.getItem("cb_muted") === "1", page.notes.length);
  page = await load(null, { muted: true });
  await send(page, "hello");
  check("a visitor who muted it earlier stays muted on the next visit", page.notes.length === 0 && page.$("cb-mute").getAttribute("aria-pressed") === "true");
  page = await load(null, { configOverride: { notification_sound: false } });
  await send(page, "hello");
  check("the site owner can switch the sound off for the bot: silent, and no mute button", page.notes.length === 0 && page.$("cb-mute") === null);

  console.log("matching the website");
  const css = (pg) => [...pg.root.querySelectorAll("style")].map((el) => el.textContent).join(" ");
  page = await load(null);
  check("with no font chosen, the widget uses the website's own typeface", /--cb-font:\s*"?Site Grotesk/.test(css(page)), css(page).slice(0, 300));
  check("a deep brand colour gets white text", /--cb-on-theme:\s*#ffffff/.test(css(page)));
  page = await load(null, { configOverride: { theme_color: "#cefd21", font_family: '"Work Sans", sans-serif' } });
  check("a pale brand colour (lime) gets dark text instead of unreadable white", /--cb-on-theme:\s*#13101f/.test(css(page)), css(page).slice(0, 300));
  check("...and links on the white panel use a deepened version of it", !/--cb-theme-text:\s*#cefd21/.test(css(page)) && /--cb-theme-text:\s*#[0-9a-f]{6}/.test(css(page)));
  check("a font chosen in the dashboard wins over the page's", /--cb-font:\s*"Work Sans"/.test(css(page)));

  console.log("launcher pictures (normal, hover, open)");
  const media = (slot) => `/api/public/media/acme-bot/${slot}?v=abc123`;
  page = await load(null, { configOverride: { launcher_images: { normal: media("normal"), hover: media("hover"), open: media("open") } } });
  let pics = [...page.$("cb-launcher").querySelectorAll("img")];
  check("each picture is loaded from the widget's own server", pics.length === 3 && pics.every((img) => img.src.startsWith("https://chat.example/api/public/media/acme-bot/")), pics.map((i) => i.src));
  check("the pictures replace the default icon and are decorative (the button keeps its label)",
    page.$("cb-launcher").querySelector("svg") === null && pics.every((img) => img.alt === "") && page.$("cb-launcher").getAttribute("aria-label") === "Open chat");
  check("the launcher knows which states have a picture", ["cb-has-image", "cb-has-hover", "cb-has-open"].every((c) => page.$("cb-launcher").classList.contains(c)));
  check("CSS swaps them: hover picture on hover, open picture while the chat is open", /cb-has-hover:hover \.cb-img--hover/.test(css(page)) && /cb-has-open\[aria-expanded="true"\] \.cb-img--open/.test(css(page)));
  page = await load(null, { configOverride: { launcher_images: { hover: media("hover") } } });
  check("without a normal picture, the default icon stays", page.$("cb-launcher").querySelector("svg") !== null && !page.$("cb-launcher").querySelector("img"));
  page = await load(null, { configOverride: { launcher_images: { normal: "https://evil.example/track.gif", open: "javascript:alert(1)" } } });
  check("a picture from anywhere else is ignored", !page.$("cb-launcher").querySelector("img") && page.errors.length === 0);

  console.log("the bot owner's own JavaScript");
  const script = `
    window.__seen = [];
    zehnbot.on("open", () => window.__seen.push("open"));
    zehnbot.on("close", () => window.__seen.push("close"));
    zehnbot.on("message", (m) => window.__seen.push(m.role + ":" + m.text.slice(0, 7)));
    zehnbot.root.getElementById("cb-botname").dataset.touched = "yes";
    zehnbot.on("open", () => { throw new Error("owner bug"); });
  `;
  page = await load(null, { configOverride: { custom_js: script } });
  check("it runs, and can reach into the widget", page.$("cb-botname").dataset.touched === "yes", page.warnings);
  page.$("cb-launcher").click();
  await send(page, "hello there");
  page.$("cb-close").click();
  check("it hears open, each message, and close", JSON.stringify(page.w.__seen) === JSON.stringify(["open", "user:hello t", "assistant:We have", "close"]), page.w.__seen);
  check("a listener that throws does not break the chat", page.errors.length === 0 && page.warnings.some((t) => t.includes('custom "open" listener')));
  page = await load(null, { configOverride: { custom_js: "this is not javascript (" } });
  check("broken code: the chat still appears and the console says why", !!page.root && page.errors.length === 0 && page.warnings.some((t) => t.includes("custom JavaScript did not run")), page.warnings);
  page.$("cb-launcher").click();
  check("...and still opens", page.$("cb-panel").classList.contains("cb-open"));

  console.log("websites that are not allowed");
  page = await load(null, { config: "forbidden" });
  check("the widget does not appear at all on a website the bot is not set up for", page.host === null && page.errors.length === 0, page.errors);
  check("...and the console tells the site owner why, and how to fix it", page.warnings.some((t) => t.includes("www.acme.com") && t.includes("Website setting")), page.warnings);
  page = await load(null, { chat: "forbidden" });
  await send(page, "hello");
  last = [...page.root.querySelectorAll(".cb-msg")].at(-1);
  check("a refused chat says so, instead of 'something went wrong'", last.textContent.includes("isn't available on this website"), last.textContent);

  console.log(`\n${results.filter(Boolean).length}/${results.length} checks passed`);
  process.exit(results.every(Boolean) ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
