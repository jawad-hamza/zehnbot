import re
import secrets
import uuid
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.config import settings
from app.dependencies import get_db, get_current_user, get_owned_client
from app.models.client import Client
from app.models.tenant import Tenant
from app.models.user import User
from app.schemas.chat import ChatResponse, OwnerChatRequest
from app.schemas.client import ClientCreate, ClientUpdate, ClientResponse, ClientListItem
from app.services import rate_limit
from app.services.ai_service import chat_completion
from app.services.chat_service import process_message, resolve_ai_credentials
from app.services.crypto_service import encrypt_secret
from app.services.net_guard import UnsafeURLError, assert_public_url
from app.services.providers import CUSTOM, PROVIDERS, get_provider
from app.services.style_service import StyleGuess, detect_site_style
from app.services.tenant_service import enforce_bot_limit

router = APIRouter()

# Optional columns a PUT may blank out by sending null
_CLEARABLE = {"ai_model", "ai_base_url", "font_family", "custom_css", "custom_js"}


class ProviderInfo(BaseModel):
    id: str
    label: str
    default_model: Optional[str]
    model_hint: str
    keys_url: str
    needs_base_url: bool


@router.get("/providers", response_model=List[ProviderInfo])
def list_providers(_: User = Depends(get_current_user)):
    """The AI providers a bot can use. The dashboard builds its form from this list."""
    return [
        ProviderInfo(id=p.id, label=p.label, default_model=p.default_model, model_hint=p.model_hint,
                     keys_url=p.keys_url, needs_base_url=p.needs_base_url)
        for p in PROVIDERS.values()
        if p.id != CUSTOM or settings.ALLOW_CUSTOM_AI_ENDPOINTS
    ]


def _new_client_id(name: str, db: Session) -> str:
    """The public id used in the embed snippet: readable, and not guessable from the company name
    alone ("zehnox-4f9c2a"), so bots cannot be enumerated by trying obvious slugs."""
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:40].strip("-") or "bot"
    for _ in range(10):
        candidate = f"{slug}-{secrets.token_hex(3)}"
        if not db.query(Client.id).filter(Client.client_id == candidate).first():
            return candidate
    return f"{slug}-{secrets.token_hex(8)}"


def _check_ai_settings(client: Client) -> None:
    """Runs before every save. Rejects combinations that could never produce a reply, so the owner
    finds out in the form rather than from a broken widget."""
    provider = get_provider(client.ai_provider)
    if provider is None:
        raise HTTPException(status_code=400, detail="Unknown AI provider.")
    client.ai_model = (client.ai_model or "").strip() or None
    client.ai_base_url = (client.ai_base_url or "").strip().rstrip("/") or None

    if not provider.needs_base_url:
        client.ai_base_url = None   # the catalogue decides where named providers live, not the tenant
    else:
        if not settings.ALLOW_CUSTOM_AI_ENDPOINTS:
            raise HTTPException(status_code=400, detail="Custom AI endpoints are not enabled on this platform.")
        if not client.ai_base_url:
            raise HTTPException(status_code=400, detail="Enter the base URL of your OpenAI-compatible endpoint, e.g. llm.example.com/v1")
        if "://" not in client.ai_base_url:
            client.ai_base_url = "https://" + client.ai_base_url   # "llm.example.com/v1" is enough
        if not client.ai_base_url.lower().startswith("https://"):
            raise HTTPException(status_code=400, detail="The endpoint must use https:// (your API key is sent to it).")
        try:
            # tenants must not be able to aim the server at internal addresses
            assert_public_url(client.ai_base_url)
        except UnsafeURLError as e:
            raise HTTPException(status_code=400, detail=f"That endpoint can't be used: {e}")

    # Without a key the platform's AI answers and these settings are not used at all
    if client.ai_api_key and not (client.ai_model or provider.default_model):
        raise HTTPException(status_code=400, detail=f"Enter a model name for {provider.label}. {provider.model_hint}")


@router.get("/clients", response_model=List[ClientListItem])
def list_clients(
    tenant_id: Optional[uuid.UUID] = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    query = db.query(Client, Tenant.name).join(Tenant, Client.tenant_id == Tenant.id)
    if not user.is_superadmin:
        query = query.filter(Client.tenant_id == user.tenant_id)
    elif tenant_id:
        query = query.filter(Client.tenant_id == tenant_id)
    return [
        ClientListItem(
            id=c.id, tenant_id=c.tenant_id, tenant_name=tenant_name, name=c.name, domain=c.domain,
            client_id=c.client_id, bot_name=c.bot_name, is_active=c.is_active, created_at=c.created_at,
        )
        for c, tenant_name in query.order_by(Client.created_at.desc()).all()
    ]


@router.post("/clients", response_model=ClientResponse, status_code=status.HTTP_201_CREATED)
def create_client(body: ClientCreate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    if user.is_superadmin:
        if not body.tenant_id:
            raise HTTPException(status_code=400, detail="Choose which tenant this bot belongs to.")
        tenant = db.query(Tenant).filter(Tenant.id == body.tenant_id).first()
        if not tenant:
            raise HTTPException(status_code=404, detail="Tenant not found")
    else:
        tenant = user.tenant   # a tenant user can never create a bot anywhere else
        enforce_bot_limit(tenant, db)

    if body.client_id:
        if db.query(Client.id).filter(Client.client_id == body.client_id).first():
            raise HTTPException(status_code=409, detail="client_id already exists")
        public_id = body.client_id
    else:
        public_id = _new_client_id(body.name, db)

    data = body.model_dump(exclude={"tenant_id", "ai_api_key", "client_id", "match_website"})
    client = Client(**data, client_id=public_id, tenant_id=tenant.id)
    if body.ai_api_key and body.ai_api_key.strip():
        client.ai_api_key = encrypt_secret(body.ai_api_key.strip())
    _check_ai_settings(client)
    if body.match_website:
        rate_limit.enforce("style-match", str(user.id), settings.RATE_STYLE_MATCH_PER_USER_PER_HOUR, 3600)
        _apply_style(client, _match_style(client, db))   # best effort: a site that cannot be read keeps the defaults
    db.add(client)
    db.commit()
    db.refresh(client)
    return ClientResponse.from_model(client)


def _match_style(client: Client, db: Session) -> StyleGuess:
    """Looks at the bot's website and proposes a colour and font. The AI is optional help, never required."""
    complete = None
    try:
        endpoint, api_key, _ = resolve_ai_credentials(client, db)
        complete = lambda messages: chat_completion(messages, endpoint, api_key)[0]   # noqa: E731
    except HTTPException:
        pass
    return detect_site_style(client.domain, complete)


def _apply_style(client: Client, guess: StyleGuess) -> None:
    if guess.theme_color:
        client.theme_color = guess.theme_color
    if guess.font_family:
        client.font_family = guess.font_family[:200]


class StyleMatchResponse(BaseModel):
    applied: bool
    method: str                  # "ai" | "css" | "none"
    detail: str
    theme_color: str
    font_family: Optional[str]
    colors_found: List[str]
    fonts_found: List[str]


@router.post("/clients/{client_uuid}/match-style", response_model=StyleMatchResponse)
def match_style(client: Client = Depends(get_owned_client), db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Re-reads the bot's website and restyles the widget to match it."""
    rate_limit.enforce("style-match", str(user.id), settings.RATE_STYLE_MATCH_PER_USER_PER_HOUR, 3600)
    guess = _match_style(client, db)
    _apply_style(client, guess)
    db.commit()
    db.refresh(client)
    return StyleMatchResponse(
        applied=bool(guess.theme_color or guess.font_family), method=guess.method, detail=guess.detail,
        theme_color=client.theme_color, font_family=client.font_family, colors_found=guess.colors, fonts_found=guess.fonts,
    )


@router.get("/clients/{client_uuid}", response_model=ClientResponse)
def get_client(client: Client = Depends(get_owned_client)):
    return ClientResponse.from_model(client)


@router.put("/clients/{client_uuid}", response_model=ClientResponse)
def update_client(body: ClientUpdate, client: Client = Depends(get_owned_client), db: Session = Depends(get_db)):
    changes = body.model_dump(exclude_unset=True)
    if "ai_api_key" in changes:
        key = changes.pop("ai_api_key")
        if key is not None:   # null = leave as is, "" = remove, anything else = replace
            client.ai_api_key = encrypt_secret(key.strip()) if key.strip() else None
    for field, value in changes.items():
        if value is None and field not in _CLEARABLE:
            continue
        setattr(client, field, value)
    _check_ai_settings(client)
    db.commit()
    db.refresh(client)
    return ClientResponse.from_model(client)


@router.delete("/clients/{client_uuid}", status_code=status.HTTP_204_NO_CONTENT)
def delete_client(client: Client = Depends(get_owned_client), db: Session = Depends(get_db)):
    db.delete(client)
    db.commit()


@router.post("/clients/{client_uuid}/test-chat", response_model=ChatResponse)
def test_chat(
    body: OwnerChatRequest,
    client: Client = Depends(get_owned_client),
    db: Session = Depends(get_db),
):
    """The dashboard's test chat. Authenticated, so it skips the widget's origin check and may
    show provider errors, but it still counts against the tenant's quota."""
    rate_limit.enforce("test-chat", str(client.id), settings.RATE_CHAT_PER_BOT_PER_MIN, 60)
    return process_message(client, body.session_id, body.message, db, expose_errors=True)
