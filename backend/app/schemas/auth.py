from typing import Optional

from pydantic import BaseModel, EmailStr, Field, field_validator

from app.services.auth_service import validate_new_password


class LoginRequest(BaseModel):
    # Called "email" for historical reasons; older accounts log in with a plain username.
    email: str = Field(min_length=1, max_length=255)
    password: str = Field(min_length=1, max_length=200)


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class SignupRequest(BaseModel):
    company_name: str = Field(min_length=2, max_length=255)
    email: EmailStr
    password: str = Field(max_length=200)

    @field_validator("password")
    @classmethod
    def _strong_enough(cls, v: str) -> str:
        validate_new_password(v)
        return v


class ChangeCredentialsRequest(BaseModel):
    current_password: str = Field(min_length=1, max_length=200)
    new_email: Optional[str] = Field(default=None, min_length=3, max_length=255)
    new_password: Optional[str] = Field(default=None, max_length=200)

    @field_validator("new_password")
    @classmethod
    def _strong_enough(cls, v: Optional[str]) -> Optional[str]:
        if v:
            validate_new_password(v)
        return v or None


class TenantSummary(BaseModel):
    id: str
    name: str
    plan: str
    monthly_message_quota: int
    max_bots: int
    bots_used: int
    messages_this_month: int
    platform_messages_this_month: int


class UserInfo(BaseModel):
    id: str
    email: str
    role: str
    tenant: Optional[TenantSummary] = None


class AuthConfig(BaseModel):
    allow_signup: bool
