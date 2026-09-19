from typing import Optional

from pydantic import BaseModel, EmailStr, Field, field_validator

from app.services.auth_service import validate_new_password


class LoginRequest(BaseModel):
    # Called "email" for historical reasons; older accounts log in with a plain username.
    email: str = Field(min_length=1, max_length=255)
    password: str = Field(min_length=1, max_length=200)
    # True only from the operator console's own sign-in page
    console: bool = False


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class SignupResponse(BaseModel):
    """Either a session (no email verification configured) or "check your inbox"."""
    access_token: Optional[str] = None
    token_type: str = "bearer"
    verification_required: bool = False


class VerifyEmailRequest(BaseModel):
    token: str = Field(min_length=10, max_length=2000)


class ResendVerificationRequest(BaseModel):
    email: EmailStr


class SignupRequest(BaseModel):
    company_name: str = Field(min_length=2, max_length=255)
    email: EmailStr
    password: str = Field(max_length=200)
    # Honeypot: a field real people never see. Form-filling bots fill everything in.
    website: Optional[str] = Field(default=None, max_length=500)

    @field_validator("password")
    @classmethod
    def _strong_enough(cls, v: str) -> str:
        validate_new_password(v)
        return v


class ChangeCredentialsRequest(BaseModel):
    # Not needed by a login that has only ever used Google and is setting its first password
    current_password: Optional[str] = Field(default=None, max_length=200)
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
    has_password: bool = True
    google_linked: bool = False


class AuthConfig(BaseModel):
    allow_signup: bool
    demo_client_id: Optional[str] = None
    google_enabled: bool = False
    google_signup: bool = False          # may a Google sign-in create a new workspace
    email_verification: bool = False
    marketing_url: Optional[str] = None  # where the public landing page lives, when it is not this app
