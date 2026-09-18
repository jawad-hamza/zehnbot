from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime
import uuid


class LeadCapture(BaseModel):
    client_id: str
    conversation_id: Optional[str] = None
    name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None


class LeadResponse(BaseModel):
    id: uuid.UUID
    name: Optional[str]
    email: Optional[str]
    phone: Optional[str]
    captured_at: datetime

    model_config = {"from_attributes": True}


class LeadListResponse(BaseModel):
    total: int
    items: List[LeadResponse]


class ConversationSummary(BaseModel):
    id: uuid.UUID
    session_id: str
    started_at: datetime
    last_message_at: datetime
    message_count: int

    model_config = {"from_attributes": True}


class ConversationListResponse(BaseModel):
    total: int
    page: int
    items: List[ConversationSummary]


class MessageResponse(BaseModel):
    id: uuid.UUID
    role: str
    content: str
    tokens_used: Optional[int]
    created_at: datetime

    model_config = {"from_attributes": True}
