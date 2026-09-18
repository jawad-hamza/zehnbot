import re
from typing import List, Optional
from urllib.parse import urlparse

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.config import settings
from app.models.client import Client
from app.models.tenant import Tenant


def get_client_by_slug(client_id: str, db: Session) -> Optional[Client]:
    """Public lookup used by the widget: the bot AND its tenant must both be active."""
    return (
        db.query(Client)
        .join(Tenant, Client.tenant_id == Tenant.id)
        .filter(Client.client_id == client_id, Client.is_active.is_(True), Tenant.is_active.is_(True))
        .first()
    )


def require_active_client(client_id: str, db: Session) -> Client:
    client = get_client_by_slug(client_id, db)
    if not client:
        raise HTTPException(status_code=404, detail="Unknown client")
    return client


def _host_of(value: str) -> str:
    value = value.strip().lower()
    if "://" not in value:
        value = "//" + value
    host = urlparse(value).hostname or ""
    return host[4:] if host.startswith("www.") else host


def allowed_hosts(client: Client) -> List[str]:
    """The `domain` field may hold several domains separated by commas or spaces."""
    return [h for h in (_host_of(part) for part in re.split(r"[,\s]+", client.domain or "")) if h]


def origin_allowed(origin: Optional[str], client: Client) -> bool:
    if not origin or origin == "null":
        return False
    host = _host_of(origin)
    return any(host == allowed or host.endswith("." + allowed) for allowed in allowed_hosts(client))


def enforce_widget_origin(origin: Optional[str], client: Client) -> None:
    """Stops other websites from embedding a tenant's bot and spending its quota.
    Browsers cannot forge Origin; scripted abuse is handled by the rate limits instead."""
    if settings.ENFORCE_WIDGET_ORIGIN and not origin_allowed(origin, client):
        raise HTTPException(status_code=403, detail="This site is not allowed to use this assistant.")
