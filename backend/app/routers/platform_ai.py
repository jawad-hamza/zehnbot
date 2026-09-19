"""The super admin's control over the platform AI: the key (and provider, model, endpoint) that answers for
every bot without a key of its own. Saved here, it overrides PLATFORM_AI_* in the server's .env; removed,
the .env applies again. The key itself is write-only: it is encrypted at rest and never returned."""
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.dependencies import get_db, require_superadmin
from app.models.setting import PlatformSetting
from app.models.user import User
from app.services import platform_ai
from app.services.ai_service import AIProviderError, Endpoint, chat_completion
from app.services.crypto_service import decrypt_secret, encrypt_secret, secret_hint
from app.services.net_guard import UnsafeURLError, assert_public_url
from app.services.providers import get_provider

logger = logging.getLogger("app.platform_ai")
router = APIRouter()


class PlatformAIStatus(BaseModel):
    source: str                      # which one is answering now: "dashboard" | "env" | "none"
    provider: str
    provider_label: str
    model: Optional[str]             # as entered; None = the provider's default
    effective_model: Optional[str]
    base_url: Optional[str]
    key_hint: Optional[str]          # "…abcd"; never the key
    dashboard_key_saved: bool
    env_key_set: bool
    env_provider: str


class PlatformAIUpdate(BaseModel):
    provider: str = Field(min_length=1, max_length=40)
    model: Optional[str] = Field(default=None, max_length=200)
    base_url: Optional[str] = Field(default=None, max_length=500)
    api_key: Optional[str] = Field(default=None, max_length=500)    # empty = keep the saved key


class TestResult(BaseModel):
    ok: bool
    detail: str


def _status(db: Session) -> PlatformAIStatus:
    current = platform_ai.load(db)
    env = platform_ai.from_env()
    stored = platform_ai.stored(db) or {}
    shown = current if current.source == "dashboard" else (
        # nothing working saved: show what was saved (if anything) so the form keeps it, else the .env values
        platform_ai.PlatformAI(provider=stored.get("provider") or env.provider, model=stored.get("model"),
                               api_key="", base_url=stored.get("base_url"), source=current.source, trusted=False)
        if stored else env
    )
    provider = get_provider(shown.provider)
    return PlatformAIStatus(
        source=current.source,
        provider=shown.provider,
        provider_label=provider.label if provider else shown.provider,
        model=shown.model,
        effective_model=shown.model or (provider.default_model if provider else None),
        base_url=shown.base_url,
        key_hint=secret_hint(stored["api_key"]) if current.source == "dashboard" else secret_hint(env.api_key),
        dashboard_key_saved=bool(stored.get("api_key")),
        env_key_set=bool(env.api_key),
        env_provider=env.provider,
    )


def _validated(body: PlatformAIUpdate) -> dict:
    provider = get_provider(body.provider.strip().lower())
    if provider is None:
        raise HTTPException(status_code=400, detail="Unknown AI provider.")
    model = (body.model or "").strip() or None
    base_url = (body.base_url or "").strip().rstrip("/") or None
    if not provider.needs_base_url:
        base_url = None
    else:
        if not base_url:
            raise HTTPException(status_code=400, detail="Enter the base URL of the OpenAI-compatible endpoint, e.g. llm.example.com/v1")
        if "://" not in base_url:
            base_url = "https://" + base_url
        if not base_url.lower().startswith("https://"):
            raise HTTPException(status_code=400, detail="The endpoint must use https:// (the key is sent to it).")
        try:
            assert_public_url(base_url)     # an internal gateway belongs in .env, not in a web form
        except UnsafeURLError as e:
            raise HTTPException(status_code=400, detail=f"That endpoint can't be used: {e}")
    if not (model or provider.default_model):
        raise HTTPException(status_code=400, detail=f"Enter a model name for {provider.label}. {provider.model_hint}")
    return {"provider": provider.id, "model": model, "base_url": base_url}


@router.get("/platform-ai", response_model=PlatformAIStatus)
def get_platform_ai(db: Session = Depends(get_db), _: User = Depends(require_superadmin)):
    return _status(db)


@router.put("/platform-ai", response_model=PlatformAIStatus)
def set_platform_ai(body: PlatformAIUpdate, db: Session = Depends(get_db), user: User = Depends(require_superadmin)):
    value = _validated(body)
    row = db.get(PlatformSetting, platform_ai.KEY)
    new_key = (body.api_key or "").strip()
    if new_key:
        value["api_key"] = encrypt_secret(new_key)
    elif row and isinstance(row.value, dict) and row.value.get("api_key"):
        value["api_key"] = row.value["api_key"]      # changing the model does not mean retyping the key
    else:
        raise HTTPException(status_code=400, detail="Paste the API key.")
    if row:
        row.value = value
    else:
        db.add(PlatformSetting(key=platform_ai.KEY, value=value))
    db.commit()
    logger.info("platform AI set from the dashboard by %s: provider=%s model=%s", user.id, value["provider"], value["model"])
    return _status(db)


@router.delete("/platform-ai", response_model=PlatformAIStatus)
def clear_platform_ai(db: Session = Depends(get_db), user: User = Depends(require_superadmin)):
    """Forget the dashboard key; the server's .env answers again (or nothing, if it has no key)."""
    row = db.get(PlatformSetting, platform_ai.KEY)
    if row:
        db.delete(row)
        db.commit()
        logger.info("platform AI dashboard key removed by %s", user.id)
    return _status(db)


@router.post("/platform-ai/test", response_model=TestResult)
def test_platform_ai(body: Optional[PlatformAIUpdate] = None, db: Session = Depends(get_db), _: User = Depends(require_superadmin)):
    """Sends one tiny message. With a body, tests those values (the saved key if none is typed) before saving;
    without one, tests what is answering now."""
    if body is None:
        current = platform_ai.load(db)
        if not current.configured:
            return TestResult(ok=False, detail="No platform AI key is set, here or in the server's .env.")
        endpoint = Endpoint(provider=current.provider, model=current.model, base_url=current.base_url, trusted=current.trusted)
        api_key = current.api_key
    else:
        value = _validated(body)
        api_key = (body.api_key or "").strip()
        if not api_key:
            stored = platform_ai.stored(db) or {}
            api_key = decrypt_secret(stored.get("api_key")) or ""
        if not api_key:
            return TestResult(ok=False, detail="Paste the API key to test it.")
        endpoint = Endpoint(provider=value["provider"], model=value["model"], base_url=value["base_url"], trusted=False)
    try:
        text, _tokens = chat_completion([{"role": "user", "content": "Reply with the single word: ready"}], endpoint, api_key)
    except AIProviderError as e:
        return TestResult(ok=False, detail=str(e) or "The provider refused the request.")
    except HTTPException as e:
        return TestResult(ok=False, detail=str(e.detail))
    except Exception:   # noqa: BLE001 - a network hiccup must not become a 500 with a stack trace
        logger.exception("platform AI test failed")
        return TestResult(ok=False, detail="Could not reach the provider.")
    return TestResult(ok=True, detail=f"Connected. The model replied: {(text or '').strip()[:60] or '(empty reply)'}")
