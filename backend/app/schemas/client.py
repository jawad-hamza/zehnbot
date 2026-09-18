import uuid
from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator

from app.services.crypto_service import secret_hint
from app.services.providers import PROVIDERS

Position = Literal["bottom-right", "bottom-left"]
HEX_COLOR = r"^#[0-9A-Fa-f]{6}$"


def _known_provider(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    value = value.strip().lower()
    if value not in PROVIDERS:
        raise ValueError(f"Unknown AI provider. Choose one of: {', '.join(PROVIDERS)}")
    return value


class ClientCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    domain: str = Field(min_length=1, max_length=255)
    client_id: str = Field(pattern=r"^[a-z0-9-]{2,64}$")
    bot_name: str = Field(default="Assistant", min_length=1, max_length=100)
    system_prompt: str = Field(default="", max_length=8000)
    welcome_message: str = Field(default="Hi! How can I help you?", max_length=1000)
    theme_color: str = Field(default="#2563eb", pattern=HEX_COLOR)
    widget_position: Position = "bottom-right"
    font_family: Optional[str] = Field(default=None, max_length=200)
    custom_css: Optional[str] = Field(default=None, max_length=20000)
    ai_provider: str = "deepseek"
    ai_model: Optional[str] = Field(default=None, max_length=100)
    ai_base_url: Optional[str] = Field(default=None, max_length=500)   # provider "custom" only
    ai_api_key: Optional[str] = Field(default=None, max_length=500)

    _provider = field_validator("ai_provider")(_known_provider)

    # Super admin only: which tenant the bot belongs to. Tenant users always get their own.
    tenant_id: Optional[uuid.UUID] = None


class ClientUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=255)
    domain: Optional[str] = Field(default=None, min_length=1, max_length=255)
    bot_name: Optional[str] = Field(default=None, min_length=1, max_length=100)
    system_prompt: Optional[str] = Field(default=None, max_length=8000)
    welcome_message: Optional[str] = Field(default=None, max_length=1000)
    theme_color: Optional[str] = Field(default=None, pattern=HEX_COLOR)
    widget_position: Optional[Position] = None
    font_family: Optional[str] = Field(default=None, max_length=200)
    custom_css: Optional[str] = Field(default=None, max_length=20000)
    ai_provider: Optional[str] = None
    ai_model: Optional[str] = Field(default=None, max_length=100)
    ai_base_url: Optional[str] = Field(default=None, max_length=500)
    # Omitted = keep the stored key, "" = remove it, anything else = replace it
    ai_api_key: Optional[str] = Field(default=None, max_length=500)
    is_active: Optional[bool] = None

    _provider = field_validator("ai_provider")(_known_provider)


class ClientResponse(BaseModel):
    id: uuid.UUID
    tenant_id: uuid.UUID
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
    ai_base_url: Optional[str] = None
    # The key itself never leaves the server
    ai_api_key_set: bool
    ai_api_key_hint: Optional[str] = None
    is_active: bool
    created_at: datetime
    updated_at: datetime

    @classmethod
    def from_model(cls, client) -> "ClientResponse":
        return cls(
            id=client.id,
            tenant_id=client.tenant_id,
            name=client.name,
            domain=client.domain,
            client_id=client.client_id,
            bot_name=client.bot_name,
            system_prompt=client.system_prompt,
            welcome_message=client.welcome_message,
            theme_color=client.theme_color,
            widget_position=client.widget_position,
            font_family=client.font_family,
            custom_css=client.custom_css,
            ai_provider=client.ai_provider,
            ai_model=client.ai_model,
            ai_base_url=client.ai_base_url,
            ai_api_key_set=bool(client.ai_api_key),
            ai_api_key_hint=secret_hint(client.ai_api_key),
            is_active=client.is_active,
            created_at=client.created_at,
            updated_at=client.updated_at,
        )


class ClientListItem(BaseModel):
    id: uuid.UUID
    tenant_id: uuid.UUID
    tenant_name: Optional[str] = None
    name: str
    domain: str
    client_id: str
    bot_name: str
    is_active: bool
    created_at: datetime
