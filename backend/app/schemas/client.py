from pydantic import BaseModel
from typing import Optional
from datetime import datetime
import uuid


class ClientCreate(BaseModel):
    name: str
    domain: str
    client_id: str
    bot_name: str = "Assistant"
    system_prompt: str = ""
    welcome_message: str = "Hi! How can I help you?"
    theme_color: str = "#2563eb"
    widget_position: str = "bottom-right"
    font_family: Optional[str] = None
    custom_css: Optional[str] = None
    ai_provider: str = "openai"
    ai_model: Optional[str] = None
    ai_api_key: Optional[str] = None


class ClientUpdate(BaseModel):
    name: Optional[str] = None
    domain: Optional[str] = None
    bot_name: Optional[str] = None
    system_prompt: Optional[str] = None
    welcome_message: Optional[str] = None
    theme_color: Optional[str] = None
    widget_position: Optional[str] = None
    font_family: Optional[str] = None
    custom_css: Optional[str] = None
    ai_provider: Optional[str] = None
    ai_model: Optional[str] = None
    ai_api_key: Optional[str] = None
    is_active: Optional[bool] = None


class ClientResponse(BaseModel):
    id: uuid.UUID
    name: str
    domain: str
    client_id: str
    bot_name: str
    system_prompt: str
    welcome_message: str
    theme_color: str
    widget_position: str
    font_family: Optional[str] = None
    custom_css: Optional[str] = None
    ai_provider: str
    ai_model: Optional[str] = None
    ai_api_key: Optional[str] = None
    is_active: bool
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class ClientListItem(BaseModel):
    id: uuid.UUID
    name: str
    domain: str
    client_id: str
    bot_name: str
    is_active: bool
    created_at: datetime

    model_config = {"from_attributes": True}
