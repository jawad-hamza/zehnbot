from typing import Optional

from pydantic import BaseModel, Field, field_validator

from app.config import settings

SESSION_ID = r"^[A-Za-z0-9_-]{8,64}$"


class _MessageBody(BaseModel):
    session_id: str = Field(pattern=SESSION_ID)
    message: str = Field(min_length=1, max_length=settings.MAX_MESSAGE_CHARS)

    @field_validator("message")
    @classmethod
    def _not_blank(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Message is empty")
        return v


class ChatRequest(_MessageBody):
    """Sent by the public widget. Conversation history is NOT accepted from the browser;
    the server rebuilds it from its own records."""
    client_id: str = Field(min_length=1, max_length=64)


class OwnerChatRequest(_MessageBody):
    """Sent by the dashboard's authenticated test chat."""


class ChatResponse(BaseModel):
    reply: str
    conversation_id: str
    tokens_used: Optional[int] = None
    # The bot has just invited the visitor to leave contact details: the widget opens its form
    show_lead_form: bool = False
    # Contact details for this conversation are already on file: never ask again
    lead_captured: bool = False


class WidgetConfig(BaseModel):
    bot_name: str
    welcome_message: str
    theme_color: str
    widget_position: str = "bottom-right"
    font_family: Optional[str] = None
    custom_css: Optional[str] = None
