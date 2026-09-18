let BASE = "/api";

export function setApiBase(url) {
  BASE = url;
}

export async function fetchConfig(clientId) {
  const res = await fetch(`${BASE}/widget/config?client_id=${encodeURIComponent(clientId)}`);
  if (!res.ok) throw new Error("Config fetch failed: " + res.status);
  return res.json();
}

export async function sendMessage(clientId, sessionId, message, history) {
  const res = await fetch(`${BASE}/chat/message`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: clientId, session_id: sessionId, message, history }),
  });
  if (!res.ok) throw new Error("Chat error: " + res.status);
  return res.json();
}

export async function submitLead(clientId, conversationId, name, email, phone) {
  const res = await fetch(`${BASE}/leads/capture`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept": "application/json" },
    body: JSON.stringify({ client_id: clientId, conversation_id: conversationId, name, email, phone }),
  });
  if (!res.ok) throw new Error("Lead capture failed: " + res.status);
  try { await res.json(); } catch { /* empty body is fine */ }
  return true;
}
