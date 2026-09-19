"""Sign in with Google: the OAuth 2.0 authorisation-code flow, done on the server.

No Google script runs in the dashboard (its Content-Security-Policy stays `script-src 'self'`):
the browser is sent to Google and comes back to us with a one-time code, which the server swaps
for an ID token and then verifies against Google's published signing keys."""
from dataclasses import dataclass
from functools import lru_cache
from typing import Optional
from urllib.parse import urlencode

import jwt
import requests

from app.config import settings

AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"
JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs"
ISSUERS = ("https://accounts.google.com", "accounts.google.com")


class GoogleSignInError(Exception):
    pass


@dataclass
class GoogleIdentity:
    sub: str
    email: str
    name: Optional[str]


def redirect_uri() -> str:
    return f"{settings.public_base_url}/api/auth/google/callback"


def authorization_url(state: str) -> str:
    return AUTH_URL + "?" + urlencode({
        "client_id": settings.GOOGLE_CLIENT_ID.strip(),
        "redirect_uri": redirect_uri(),
        "response_type": "code",
        "scope": "openid email profile",
        "state": state,
        "prompt": "select_account",
    })


@lru_cache(maxsize=1)
def _jwks() -> jwt.PyJWKClient:
    return jwt.PyJWKClient(JWKS_URL, cache_keys=True, lifespan=3600)


def exchange_code(code: str) -> GoogleIdentity:
    try:
        res = requests.post(TOKEN_URL, timeout=10, data={
            "code": code,
            "client_id": settings.GOOGLE_CLIENT_ID.strip(),
            "client_secret": settings.GOOGLE_CLIENT_SECRET.strip(),
            "redirect_uri": redirect_uri(),
            "grant_type": "authorization_code",
        })
        id_token = res.json().get("id_token") if res.status_code == 200 else None
        if not id_token:
            raise GoogleSignInError("Google did not return an identity.")
        signing_key = _jwks().get_signing_key_from_jwt(id_token)
        claims = jwt.decode(id_token, signing_key.key, algorithms=["RS256"], audience=settings.GOOGLE_CLIENT_ID.strip(),
                            options={"require": ["exp", "iat", "sub", "aud", "iss"]})
    except GoogleSignInError:
        raise
    except Exception as exc:
        raise GoogleSignInError("Google sign-in could not be verified.") from exc

    if claims.get("iss") not in ISSUERS:
        raise GoogleSignInError("Google sign-in could not be verified.")
    email = (claims.get("email") or "").strip().lower()
    if not email or claims.get("email_verified") is not True:
        raise GoogleSignInError("That Google account has no verified email address.")
    return GoogleIdentity(sub=str(claims["sub"]), email=email, name=(claims.get("name") or None))
