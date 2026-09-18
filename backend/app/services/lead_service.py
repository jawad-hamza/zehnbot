import re
import uuid
from dataclasses import dataclass
from typing import Optional

from sqlalchemy.orm import Session

from app.models.client import Client
from app.models.conversation import Conversation
from app.models.lead import Lead

_EMAIL = re.compile(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9\-]+(?:\.[A-Za-z0-9\-]+)*\.[A-Za-z]{2,}")
_PHONE = re.compile(r"(?<![\w@.])(\+?\(?\d[\d\s().\-]{6,18}\d)(?![\w@])")
_PHONE_WORDS = re.compile(r"\b(phone|call|mobile|cell|whats\s?app|tel|telephone|text me|ring me|my number|reach me)\b", re.IGNORECASE)
# The introduction may be typed in any case, but the name itself must be capitalised, and must not
# be the start of an email address ("it's Sam.Jones@example.com").
_NAME = re.compile(r"\b(?i:my name is|my name's|i am|i'm|this is)\s+([A-Z][a-zA-Z'\-]+(?:\s+[A-Z][a-zA-Z'\-]+){0,2})(?![\w.]*@)")
_NOT_NAMES = {"Interested", "Looking", "Trying", "Here", "Just", "Not", "Sorry", "Sure", "Happy", "Ready", "Still", "Also", "Based", "From"}


@dataclass
class ContactDetails:
    email: Optional[str] = None
    phone: Optional[str] = None
    name: Optional[str] = None

    def __bool__(self) -> bool:
        return bool(self.email or self.phone)


def extract_contact_details(message: str) -> ContactDetails:
    """Contact details a visitor typed straight into the chat ("sure, it's sam@acme.com").

    Plain pattern matching on purpose: free, instant and predictable, where a second model call
    per message would be none of those. A name alone is never a lead; it only decorates one."""
    found = ContactDetails()
    email = _EMAIL.search(message)
    if email:
        found.email = email.group(0).rstrip(".").lower()

    for match in _PHONE.finditer(message):
        candidate = match.group(1).strip()
        digits = re.sub(r"\D", "", candidate)
        if not 8 <= len(digits) <= 15:
            continue
        # A bare digit run could just as well be an order number or a price. Take it as a phone
        # number only if it is written like one, or the visitor is talking about calling.
        looks_like_phone = candidate.startswith(("+", "0", "(")) or bool(re.search(r"[\s().\-]", candidate))
        if looks_like_phone or _PHONE_WORDS.search(message):
            found.phone = candidate
            break

    if found:
        name = _NAME.search(message)
        if name and name.group(1).split()[0] not in _NOT_NAMES:
            found.name = name.group(1).strip()
    return found


def lead_for_conversation(conversation_id, db: Session) -> Optional[Lead]:
    return (
        db.query(Lead)
        .filter(Lead.conversation_id == conversation_id)
        .order_by(Lead.captured_at)
        .first()
    )


def save_lead(
    client: Client,
    conversation_id: Optional[uuid.UUID],
    name: Optional[str],
    email: Optional[str],
    phone: Optional[str],
    raw_context: Optional[str],
    db: Session,
    source: str = "form",
    commit: bool = True,
) -> Lead:
    """One lead per conversation: details arriving later (typed in chat, then the form, or the
    other way round) are merged into it instead of creating duplicates."""
    # Only link a conversation that really belongs to this bot
    if conversation_id is not None:
        owned = (
            db.query(Conversation.id)
            .filter(Conversation.id == conversation_id, Conversation.client_id == client.id)
            .first()
        )
        if not owned:
            conversation_id = None

    lead = lead_for_conversation(conversation_id, db) if conversation_id is not None else None
    if lead is None:
        lead = Lead(client_id=client.id, conversation_id=conversation_id, source=source)
        db.add(lead)

    # Newer details win; a blank never erases something already known
    lead.name = name or lead.name
    lead.email = email or lead.email
    lead.phone = phone or lead.phone
    lead.raw_context = raw_context or lead.raw_context

    if commit:
        db.commit()
        db.refresh(lead)
    else:
        db.flush()
    return lead
