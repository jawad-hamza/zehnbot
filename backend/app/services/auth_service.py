import hashlib
from datetime import datetime, timedelta, timezone
from functools import lru_cache

import bcrypt
import jwt

from app.config import settings

MIN_PASSWORD_LENGTH = 10
MAX_PASSWORD_BYTES = 72   # bcrypt ignores anything beyond this


def validate_new_password(plain: str) -> None:
    if len(plain) < MIN_PASSWORD_LENGTH:
        raise ValueError(f"Password must be at least {MIN_PASSWORD_LENGTH} characters")
    if len(plain.encode()) > MAX_PASSWORD_BYTES:
        raise ValueError(f"Password must be at most {MAX_PASSWORD_BYTES} bytes")


def hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode()[:MAX_PASSWORD_BYTES], bcrypt.gensalt(rounds=12)).decode()


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode()[:MAX_PASSWORD_BYTES], hashed.encode())
    except ValueError:
        return False


@lru_cache(maxsize=1)
def _dummy_hash() -> str:
    return hash_password("timing-equalisation-only")


def burn_password_check(plain: str) -> None:
    """Spend the same time as a real check so unknown usernames are not detectable by timing."""
    verify_password(plain, _dummy_hash())


def password_fingerprint(hashed_password: str) -> str:
    """Embedded in tokens so that changing the password invalidates every older token."""
    return hashlib.sha256(hashed_password.encode()).hexdigest()[:16]


def create_access_token(user_id: str, hashed_password: str) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": user_id,
        "pwd": password_fingerprint(hashed_password),
        "iat": now,
        "exp": now + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES),
    }
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def decode_token(token: str) -> dict:
    return jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM], options={"require": ["exp", "sub"]})
