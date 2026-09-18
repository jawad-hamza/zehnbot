import re
import uuid
from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, EmailStr, Field, field_validator, model_validator

_PHONE = re.compile(r"^[0-9+()\-.\s]{5,30}$")


class LeadCapture(BaseModel):
    client_id: str = Field(min_length=1, max_length=64)
    conversation_id: Optional[uuid.UUID] = None
    name: Optional[str] = Field(default=None, max_length=255)
    email: Optional[EmailStr] = None
    phone: Optional[str] = Field(default=None, max_length=30)

    @field_validator("conversation_id", "name", "email", "phone", mode="before")
    @classmethod
    def _blank_to_none(cls, v):
        if isinstance(v, str):
            v = v.strip()
        return v or None

    @field_validator("phone")
    @classmethod
    def _phone_shape(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and not _PHONE.match(v):
            raise ValueError("That phone number doesn't look right")
        return v

    @model_validator(mode="after")
    def _contactable(self):
        if not self.email and not self.phone:
            raise ValueError("Provide an email or a phone number")
        return self


class LeadResponse(BaseModel):
    id: uuid.UUID
    name: Optional[str]
    email: Optional[str]
    phone: Optional[str]
    source: str = "form"            # "form" = widget form, "chat" = typed into the conversation
    conversation_id: Optional[uuid.UUID] = None
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


class ConversationListResponse(BaseModel):
    total: int
    page: int
    items: List[ConversationSummary]


class MessageResponse(BaseModel):
    id: uuid.UUID
    role: str
    content: str
    tokens_used: Optional[int]
    unanswered: bool = False
    created_at: datetime

    model_config = {"from_attributes": True}


class DailyActivity(BaseModel):
    date: str                 # YYYY-MM-DD (UTC)
    conversations: int
    visitor_messages: int
    leads: int


class UnansweredQuestion(BaseModel):
    question: str
    asked_at: datetime
    conversation_id: uuid.UUID


class AnalyticsResponse(BaseModel):
    days: int
    conversations: int
    visitor_messages: int
    leads: int
    unanswered: int
    lead_conversion_rate: float      # leads / conversations, 0..1
    answer_rate: float               # share of bot replies that did answer, 0..1
    daily: List[DailyActivity]
    unanswered_questions: List[UnansweredQuestion]
