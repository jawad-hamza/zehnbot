import logging
import traceback
from datetime import datetime, timezone
from sqlalchemy.orm import Session
from fastapi import HTTPException

from app.models.conversation import Conversation, Message
from app.services.client_service import require_active_client
from app.services.knowledge_service import search_knowledge
from app.services.ai_service import chat_completion
from app.schemas.chat import ChatRequest, ChatResponse

logger = logging.getLogger(__name__)


BASE_PERSONA = """You are a professional, friendly customer service representative for {company}.

Your role:
- Greet warmly and speak conversationally, as a real person would. No robotic phrasing, no bullet lists unless the user asks for one, no repeating the user's question back to them.
- Keep answers short and direct — 1–3 sentences by default. Add detail only if the user asks.
- Be warm, confident, and helpful. Use contractions ("we're", "you'll"). Vary your openers — never start two replies the same way.
- If something isn't in the information you have, say so honestly and offer to have someone follow up.
- Never invent prices, policies, timelines, or availability. If the user asks for specifics you don't have, offer to connect them with the team.

Lead capture:
- When the user shows genuine interest (asking about pricing, booking, custom work, a quote, availability, getting started, or wanting to be contacted), naturally invite them to share their name and email or phone so the team can follow up. Don't ask more than once in a row. Don't ask on greetings or simple info questions.
- If they share contact info, thank them briefly and confirm someone will reach out.

Engagement:
- End some replies with a gentle, relevant follow-up question to keep the conversation moving — only when it fits naturally.
- If the user seems ready to take action, make the next step easy (e.g. "Want me to pass your details to the team?")."""


def process_message(req: ChatRequest, db: Session) -> ChatResponse:
    # Step 1 — validate client
    client = require_active_client(req.client_id, db)

    # Step 2 — get or create conversation
    conversation = (
        db.query(Conversation)
        .filter(
            Conversation.session_id == req.session_id,
            Conversation.client_id == client.id,
        )
        .first()
    )
    if not conversation:
        conversation = Conversation(client_id=client.id, session_id=req.session_id)
        db.add(conversation)
        db.flush()

    # Step 3 — save user message
    db.add(Message(conversation_id=conversation.id, role="user", content=req.message))

    # Step 4 — retrieve relevant knowledge
    chunks = search_knowledge(req.message, client.id, db, top_k=3)
    context_block = "\n\n".join(c.chunk_text for c in chunks)

    # Step 5 — layered system prompt: base persona + client specifics + knowledge
    parts = [BASE_PERSONA.format(company=client.name)]
    if client.system_prompt and client.system_prompt.strip():
        parts.append(f"Business-specific instructions:\n{client.system_prompt.strip()}")
    if context_block:
        parts.append(f"Relevant information you can draw on:\n{context_block}")
    else:
        parts.append("No specific knowledge has been loaded for this topic — answer based on general best practices for the company, and offer to have someone follow up if the user wants specifics.")
    system_content = "\n\n".join(parts)

    messages = [{"role": "system", "content": system_content}]
    for h in req.history[-6:]:
        messages.append({"role": h.role, "content": h.content})
    messages.append({"role": "user", "content": req.message})

    # Step 6 — call the configured AI provider using this client's API key
    try:
        reply_text, tokens = chat_completion(
            messages,
            provider=client.ai_provider,
            model=client.ai_model,
            api_key=client.ai_api_key,
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("AI provider error (%s): %s\n%s", client.ai_provider, exc, traceback.format_exc())
        raise HTTPException(status_code=503, detail=f"AI provider error: {type(exc).__name__}: {exc}")

    # Step 7 — save assistant reply
    db.add(Message(conversation_id=conversation.id, role="assistant", content=reply_text, tokens_used=tokens))

    # Step 8 — update conversation timestamp
    conversation.last_message_at = datetime.now(timezone.utc)
    db.commit()

    # Step 9 — return
    return ChatResponse(reply=reply_text, conversation_id=str(conversation.id), tokens_used=tokens)
