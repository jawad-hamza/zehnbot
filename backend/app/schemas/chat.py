from pydantic import BaseModel
from typing import List, Optional
import uuid


class HistoryItem(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    client_id: str
    session_id: str
    message: str
    history: List[HistoryItem] = []


class ChatResponse(BaseModel):
    reply: str
    conversation_id: str
    tokens_used: Optional[int] = None


class WidgetConfig(BaseModel):
    bot_name: str
    welcome_message: str
    theme_color: str
    widget_position: str = "bottom-right"
    font_family: Optional[str] = None
    custom_css: Optional[str] = None
