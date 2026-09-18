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
from app.services.chat_service import process_message
from app.services.crypto_service import encrypt_secret
from app.services.net_guard import UnsafeURLError, assert_public_url
from app.services.providers import CUSTOM, PROVIDERS, get_provider
from app.services.tenant_service import enforce_bot_limit

router = APIRouter()

# Optional columns a PUT may blank out by sending null
_CLEARABLE = {"ai_model", "ai_base_url", "font_family", "custom_css"}


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
            raise HTTPException(status_code=400, detail="Enter the base URL of your OpenAI-compatible endpoint, e.g. https://llm.example.com/v1")
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

    if db.query(Client.id).filter(Client.client_id == body.client_id).first():
        raise HTTPException(status_code=409, detail="client_id already exists")

    data = body.model_dump(exclude={"tenant_id", "ai_api_key"})
    client = Client(**data, tenant_id=tenant.id)
    if body.ai_api_key and body.ai_api_key.strip():
        client.ai_api_key = encrypt_secret(body.ai_api_key.strip())
    _check_ai_settings(client)
    db.add(client)
    db.commit()
    db.refresh(client)
    return ClientResponse.from_model(client)


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
