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


_ASKED_FOR_CONTACT = re.compile(r"\b(phone|number|whats\s?app|call|mobile|e-?mail|contact|details|reach you)\b", re.IGNORECASE)


def asked_for_contact(bot_line: Optional[str]) -> bool:
    return bool(bot_line and _ASKED_FOR_CONTACT.search(bot_line))


def extract_contact_details(message: str, bot_said_before: Optional[str] = None) -> ContactDetails:
    """Contact details a visitor typed straight into the chat ("sure, it's sam@acme.com").

    Plain pattern matching on purpose: free, instant and predictable, where a second model call
    per message would be none of those. A name alone is never a lead; it only decorates one.

    `bot_said_before` is the bot's previous line. Context decides the doubtful cases: the same
    "923450237013" is an order number out of the blue, and a phone number right after the bot
    asked for one."""
    found = ContactDetails()
    email = _EMAIL.search(message)
    if email:
        found.email = email.group(0).rstrip(".").lower()

    invited = asked_for_contact(bot_said_before)
    for match in _PHONE.finditer(message):
        candidate = match.group(1).strip()
        digits = re.sub(r"\D", "", candidate)
        if not 8 <= len(digits) <= 15:
            continue
        # A bare digit run could just as well be an order number or a price. Take it as a phone
        # number if it is written like one, the visitor is talking about calling, or it was asked for.
        looks_like_phone = candidate.startswith(("+", "0", "(")) or bool(re.search(r"[\s().\-]", candidate))
        if looks_like_phone or invited or _PHONE_WORDS.search(message):
            found.phone = candidate
            break

    if found:
        found.name = introduced_name(message) or _name_beside_contact(message, bot_said_before)
    return found


def _name_beside_contact(message: str, bot_said_before: Optional[str]) -> Optional[str]:
    """ "jawad hamza 923450237013": what is left once the email and the number are taken out."""
    rest = _PHONE.sub(" ", _EMAIL.sub(" ", message))
    rest = re.sub(r"\s+", " ", rest).strip(" ,;:-–/|")
    return bare_name_reply(rest, bot_said_before) if rest else None


def introduced_name(message: str) -> Optional[str]:
    """A name the visitor introduced themselves with: "my name is Priya Patel", "I'm Dana"."""
    match = _NAME.search(message)
    if match and match.group(1).split()[0] not in _NOT_NAMES:
        return match.group(1).strip()
    return None


# Short answers that are plainly not a name, in case the bot's previous line happened to mention "name"
_NOT_A_NAME_REPLY = {
    "yes", "no", "ok", "okay", "sure", "thanks", "thank you", "hello", "hi", "hey", "bye", "nope", "yep", "yeah",
    "maybe", "later", "none", "nothing", "not now", "no thanks", "why", "what", "skip", "please", "cool", "great",
}
_SENTENCE_WORDS = frozenset(
    "i i'm im we you it is are was am be do does did can could would will want need like have has get got "
    "the a an and or but for to of in on at with about from this that what why how when where who which "
    "please thanks hello hi hey yes no not just my me your our quote price pricing website site help".split()
)
_BARE_NAME = re.compile(r"^[^\W\d_][^\W\d_'’.\-]*(?:[ '’.\-]+[^\W\d_][^\W\d_'’.\-]*){0,5}\.?$")


def bare_name_reply(message: str, bot_said_before: Optional[str]) -> Optional[str]:
    """The visitor answering "and your name?" with just "Jawad Hamza".

    Only trusted when the bot had asked: a few words of letters only (any alphabet), right after
    a bot message that mentions a name. Without that context "Blue Widgets" would become a person."""
    if not bot_said_before or "name" not in bot_said_before.lower():
        return None
    text = message.strip()
    if not 2 <= len(text) <= 60 or text.lower().rstrip(".!") in _NOT_A_NAME_REPLY:
        return None
    if not _BARE_NAME.match(text):
        return None
    # "I want a quote for sites" is letters only too; words like these give a sentence away
    if any(word in _SENTENCE_WORDS for word in re.split(r"[ .\-]+", text.lower())):
        return None
    return text.rstrip(".")


def name_from_conversation(turns: list) -> Optional[str]:
    """The visitor's name from earlier in the chat. `turns` is [(role, content), ...] oldest first.
    People give their name and their email in separate messages more often than in one."""
    found = None
    previous_bot_line = None
    for role, content in turns:
        if role == "assistant":
            previous_bot_line = content
            continue
        found = introduced_name(content) or _name_beside_contact(content, previous_bot_line) or found
        previous_bot_line = None
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
