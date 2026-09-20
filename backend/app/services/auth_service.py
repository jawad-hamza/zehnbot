import hashlib
import hmac
import secrets
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


# ---------- passwords that nobody knows ----------

UNUSABLE_PREFIX = "!"   # never a valid bcrypt hash, so no typed password can ever match it


def unusable_password() -> str:
    """For logins that only ever sign in with Google. Random, so the token fingerprint still differs per user."""
    return UNUSABLE_PREFIX + secrets.token_hex(32)


def has_usable_password(hashed: str) -> bool:
    return not hashed.startswith(UNUSABLE_PREFIX)


# ---------- email verification links ----------

VERIFY_EMAIL_HOURS = 24


def _verify_key() -> str:
    # A separate signing key: a verification link can never be replayed as a session token, or the reverse
    return hashlib.sha256((settings.SECRET_KEY + ":verify-email").encode()).hexdigest()


def create_email_verification_token(user_id: str, email: str) -> str:
    now = datetime.now(timezone.utc)
    payload = {"sub": user_id, "eml": hashlib.sha256(email.lower().encode()).hexdigest()[:16],
               "iat": now, "exp": now + timedelta(hours=VERIFY_EMAIL_HOURS)}
    return jwt.encode(payload, _verify_key(), algorithm="HS256")


def read_email_verification_token(token: str) -> dict:
    return jwt.decode(token, _verify_key(), algorithms=["HS256"], options={"require": ["exp", "sub", "eml"]})


RESET_PASSWORD_MINUTES = 60


def _reset_key() -> str:
    # Its own signing key, so a reset link can never be replayed as a session token, or the reverse
    return hashlib.sha256((settings.SECRET_KEY + ":reset-password").encode()).hexdigest()


def create_password_reset_token(user_id: str, hashed_password: str) -> str:
    """Single use by construction: the current password is fingerprinted into the link, so the link
    stops working the moment the password changes (including by using the link itself)."""
    now = datetime.now(timezone.utc)
    payload = {"sub": user_id, "pw": password_fingerprint(hashed_password),
               "iat": now, "exp": now + timedelta(minutes=RESET_PASSWORD_MINUTES)}
    return jwt.encode(payload, _reset_key(), algorithm="HS256")


def read_password_reset_token(token: str) -> dict:
    return jwt.decode(token, _reset_key(), algorithms=["HS256"], options={"require": ["exp", "sub", "pw"]})


def reset_token_matches(hashed_password: str, payload: dict) -> bool:
    return hmac.compare_digest(str(payload.get("pw", "")), password_fingerprint(hashed_password))


def email_matches_token(email: str, payload: dict) -> bool:
    return hmac.compare_digest(str(payload.get("eml", "")), hashlib.sha256(email.lower().encode()).hexdigest()[:16])
