export function buildWidget(config) {
  // Launcher button
  const launcher = document.createElement("button");
  launcher.id = "cb-launcher";
  launcher.innerHTML = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>`;

  // Chat panel
  const panel = document.createElement("div");
  panel.id = "cb-panel";
  panel.innerHTML = `
    <div id="cb-header">
      <span id="cb-botname">${escapeHtml(config.bot_name)}</span>
      <button id="cb-close" aria-label="Close">&#x2715;</button>
    </div>
    <div id="cb-messages">
      <div id="cb-typing" aria-label="Typing"><span></span><span></span><span></span></div>
    </div>
    <div id="cb-lead-form" style="display:none">
      <div id="cb-lead-hint">Leave your email or phone so our team can follow up — both is even better.</div>
      <input id="cb-lead-name"  type="text"  placeholder="Your name" autocomplete="name" />
      <input id="cb-lead-email" type="email" placeholder="Your email"  autocomplete="email" />
      <input id="cb-lead-phone" type="tel"   placeholder="Your phone" autocomplete="tel" />
      <div id="cb-lead-error"></div>
      <button id="cb-lead-submit" type="button">Send my details</button>
    </div>
    <div id="cb-input-row">
      <input id="cb-input" type="text" placeholder="Type a message…" autocomplete="off" />
      <button id="cb-send">Send</button>
    </div>
  `;

  document.body.appendChild(launcher);
  document.body.appendChild(panel);

  launcher.addEventListener("click", () => panel.classList.toggle("cb-open"));
  document.getElementById("cb-close").addEventListener("click", () => panel.classList.remove("cb-open"));

  const inputEl = document.getElementById("cb-input");
  const sendBtn = document.getElementById("cb-send");
  const typingEl = document.getElementById("cb-typing");

  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendBtn.click();
    }
  });

  return {
    panel,
    input:      inputEl,
    sendBtn,
    leadForm:   document.getElementById("cb-lead-form"),
    leadName:   document.getElementById("cb-lead-name"),
    leadEmail:  document.getElementById("cb-lead-email"),
    leadPhone:  document.getElementById("cb-lead-phone"),
    leadSubmit: document.getElementById("cb-lead-submit"),
    setLeadError: (text) => {
      const el = document.getElementById("cb-lead-error");
      if (!el) return;
      el.textContent = text || "";
      el.style.display = text ? "block" : "none";
    },
    appendMessage,
    setLoading: (v) => {
      sendBtn.disabled = v;
      inputEl.disabled = v;
      typingEl.classList.toggle("cb-active", !!v);
      if (v) {
        const messages = document.getElementById("cb-messages");
        messages.scrollTop = messages.scrollHeight;
      }
    },
  };
}

function appendMessage(role, text) {
  const messages = document.getElementById("cb-messages");
  const typing = document.getElementById("cb-typing");
  const div = document.createElement("div");
  div.className = `cb-msg cb-msg--${role}`;
  div.textContent = text;
  messages.insertBefore(div, typing);
  messages.scrollTop = messages.scrollHeight;
}

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}
