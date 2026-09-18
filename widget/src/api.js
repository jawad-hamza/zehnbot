let BASE = "/api";

export function setApiBase(url) {
  BASE = url;
}

// fetch() has no timeout of its own: without one a stalled connection leaves the UI waiting forever
function timeoutSignal(ms) {
  const controller = new AbortController();
  let timer = setTimeout(() => controller.abort(), ms);
  return {
    signal: controller.signal,
    touch() { clearTimeout(timer); timer = setTimeout(() => controller.abort(), ms); },   // progress was made
    clear() { clearTimeout(timer); },
  };
}

async function fetchWithTimeout(url, options, ms) {
  const t = timeoutSignal(ms);
  try {
    return await fetch(url, { ...options, signal: t.signal });
  } finally {
    t.clear();
  }
}

function httpError(label, res) {
  const err = new Error(`${label}: ${res.status}`);
  err.status = res.status;
  return err;
}

export async function fetchConfig(clientId) {
  const res = await fetchWithTimeout(`${BASE}/widget/config?client_id=${encodeURIComponent(clientId)}`, {}, 15000);
  if (!res.ok) throw httpError("Config fetch failed", res);
  return res.json();
}

export const canStream =
  typeof ReadableStream !== "undefined" && typeof TextDecoder !== "undefined" && typeof Response !== "undefined" && "body" in Response.prototype;

// The server keeps the conversation history itself, keyed by sessionId.
export async function sendMessage(clientId, sessionId, message) {
  const res = await fetchWithTimeout(`${BASE}/chat/message`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: clientId, session_id: sessionId, message }),
  }, 100000);
  if (!res.ok) throw httpError("Chat error", res);
  return res.json();
}

/**
 * Same as sendMessage, but `onDelta(text)` is called with each piece of the reply as it is
 * written. Resolves with the closing summary ({conversation_id, show_lead_form, lead_captured}).
 * A failure after the reply has started rejects with `err.midStream = true`.
 */
export async function streamMessage(clientId, sessionId, message, onDelta) {
  // Not a total time limit (a long answer is fine) but an idle limit, reset whenever data arrives
  const idle = timeoutSignal(45000);
  let res;
  try {
    res = await fetch(`${BASE}/chat/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify({ client_id: clientId, session_id: sessionId, message }),
      signal: idle.signal,
    });
  } catch (err) {
    idle.clear();
    throw err;
  }
  if (!res.ok) {
    idle.clear();
    throw httpError("Chat error", res);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let started = false;
  let summary = null;

  const handle = (block) => {
    for (const line of block.split("\n")) {
      if (!line.startsWith("data:")) continue;
      const event = JSON.parse(line.slice(5).trim());
      if (event.type === "delta") {
        started = true;
        onDelta(event.text);
      } else if (event.type === "done") {
        summary = event;
      } else if (event.type === "error") {
        const err = new Error(event.detail || "Stream error");
        err.midStream = started;
        throw err;
      }
    }
  };

  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      idle.touch();
      buffer += decoder.decode(value, { stream: true });
      let end;
      while ((end = buffer.indexOf("\n\n")) !== -1) {
        handle(buffer.slice(0, end));
        buffer = buffer.slice(end + 2);
      }
    }
    if (buffer.trim()) handle(buffer);
  } catch (err) {
    if (err.midStream === undefined) err.midStream = started;   // connection dropped while reading
    throw err;
  } finally {
    idle.clear();
  }

  if (!summary) {
    const err = new Error("Stream ended early");
    err.midStream = started;
    throw err;
  }
  return summary;
}

export async function submitLead(clientId, conversationId, name, email, phone) {
  const res = await fetchWithTimeout(`${BASE}/leads/capture`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept": "application/json" },
    body: JSON.stringify({ client_id: clientId, conversation_id: conversationId, name, email, phone }),
  }, 15000);
  if (!res.ok) throw httpError("Lead capture failed", res);
  try { await res.json(); } catch { /* empty body is fine */ }
  return true;
}
