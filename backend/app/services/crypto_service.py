"""Encryption of tenant secrets (AI provider keys) at rest."""
from typing import Optional

from cryptography.fernet import Fernet, InvalidToken
from fastapi import HTTPException

from app.config import settings

_PREFIX = "enc:v1:"


def _fernet() -> Fernet:
    if not settings.ENCRYPTION_KEY:
        raise HTTPException(status_code=503, detail="Server is missing ENCRYPTION_KEY; API keys cannot be stored.")
    return Fernet(settings.ENCRYPTION_KEY.encode())


def is_encrypted(stored: Optional[str]) -> bool:
    return bool(stored) and stored.startswith(_PREFIX)


def encrypt_secret(plain: str) -> str:
    return _PREFIX + _fernet().encrypt(plain.encode()).decode()


def decrypt_secret(stored: Optional[str]) -> Optional[str]:
    if not stored:
        return None
    if not stored.startswith(_PREFIX):
        # Legacy plaintext row written before encryption existed. The 0002 migration
        # converts these; this branch only covers a row written in between.
        return stored
    try:
        return _fernet().decrypt(stored[len(_PREFIX):].encode()).decode()
    except InvalidToken:
        raise HTTPException(status_code=503, detail="Stored API key cannot be decrypted (ENCRYPTION_KEY changed?). Re-enter the key.")


def secret_hint(stored: Optional[str]) -> Optional[str]:
    """Last 4 characters, for display only."""
    try:
        plain = decrypt_secret(stored)
    except HTTPException:
        return "unreadable"
    if not plain:
        return None
    return "…" + plain[-4:] if len(plain) > 8 else "…"
