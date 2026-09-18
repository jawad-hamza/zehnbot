import uuid
from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, Field, field_validator

from app.services.auth_service import validate_new_password


def _check_password(v: str) -> str:
    validate_new_password(v)
    return v


class TenantCreate(BaseModel):
    name: str = Field(min_length=2, max_length=255)
    plan: str = "free"
    owner_email: str = Field(min_length=3, max_length=255)
    owner_password: str = Field(max_length=200)

    _pw = field_validator("owner_password")(_check_password)


class TenantUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=2, max_length=255)
    # Changing the plan resets quota and bot limit to that plan's defaults unless they are also sent
    plan: Optional[str] = None
    monthly_message_quota: Optional[int] = Field(default=None, ge=0, le=100_000_000)
    max_bots: Optional[int] = Field(default=None, ge=0, le=10_000)
    is_active: Optional[bool] = None


class TenantUserResponse(BaseModel):
    id: uuid.UUID
    email: str
    is_active: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class TenantUserCreate(BaseModel):
    email: str = Field(min_length=3, max_length=255)
    password: str = Field(max_length=200)

    _pw = field_validator("password")(_check_password)


class PasswordReset(BaseModel):
    new_password: str = Field(max_length=200)

    _pw = field_validator("new_password")(_check_password)


class TenantResponse(BaseModel):
    id: uuid.UUID
    name: str
    plan: str
    monthly_message_quota: int
    max_bots: int
    is_active: bool
    created_at: datetime
    bots_used: int
    messages_this_month: int
    platform_messages_this_month: int
    tokens_this_month: int
    users: List[TenantUserResponse]


class PlanInfo(BaseModel):
    name: str
    monthly_message_quota: int
    max_bots: int
