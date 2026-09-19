"""The platform's own AI: what answers for every bot whose workspace has no key of its own.

It can be set in two places. The super admin's Settings page wins when a key is saved there; otherwise the
server's .env (PLATFORM_AI_*) applies, as before. Removing the dashboard key falls back to .env.

A key saved in the dashboard is encrypted with ENCRYPTION_KEY (like tenants' own keys) and is never sent
back to a browser; only its last four characters are shown."""
import logging
from dataclasses import dataclass
from typing import Optional

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.config import settings
from app.models.setting import PlatformSetting
from app.services.crypto_service import decrypt_secret, secret_hint

logger = logging.getLogger("app.platform_ai")

KEY = "platform_ai"


@dataclass
class PlatformAI:
    provider: str
    model: Optional[str]
    api_key: str
    base_url: Optional[str]
    source: str              # "dashboard" | "env" | "none"
    trusted: bool            # an .env endpoint may be an internal gateway; a dashboard one must be public

    @property
    def configured(self) -> bool:
        return bool(self.api_key)


def stored(db: Session) -> Optional[dict]:
    row = db.get(PlatformSetting, KEY)
    return row.value if row and isinstance(row.value, dict) else None


def stored_hint(db: Session) -> Optional[str]:
    value = stored(db)
    return secret_hint(value.get("api_key")) if value and value.get("api_key") else None


def from_env() -> PlatformAI:
    return PlatformAI(
        provider=settings.platform_provider,
        model=settings.PLATFORM_AI_MODEL.strip() or None,
        api_key=settings.platform_api_key,
        base_url=settings.PLATFORM_AI_BASE_URL.strip() or None,
        source="env" if settings.platform_api_key else "none",
        trusted=True,
    )


def load(db: Optional[Session]) -> PlatformAI:
    """The platform AI in effect right now. One small read per message; always current, on every worker."""
    if db is not None:
        value = stored(db)
        if value and value.get("api_key"):
            try:
                key = decrypt_secret(value["api_key"])
            except HTTPException:
                key = None
                logger.error("The platform AI key saved in the dashboard cannot be decrypted (ENCRYPTION_KEY changed?); using .env instead")
            if key:
                return PlatformAI(
                    provider=value.get("provider") or "deepseek", model=value.get("model") or None, api_key=key,
                    base_url=value.get("base_url") or None, source="dashboard", trusted=False,
                )
    return from_env()
