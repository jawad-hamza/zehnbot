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


_LOOPBACK_HOSTS = {"localhost", "127.0.0.1", "::1"}


def origin_allowed(origin: Optional[str], client: Client, platform_host: Optional[str] = None) -> bool:
    # "null" is what file:// pages send, but also what any website can produce with a sandboxed
    # iframe, so it can never be let through.
    if not origin or origin == "null":
        return False
    host = _host_of(origin)
    # The platform's own pages: the dashboard's "Preview" opens a page on this very host with the
    # real widget in it. Only a page served by us can carry our host as its origin.
    if platform_host and host == _host_of(platform_host):
        return True
    # A page on the owner's own computer, while they build their site. Nobody can put this origin
    # in front of other people's visitors, so it opens nothing the rate limits do not already cover.
    if settings.ALLOW_LOCALHOST_WIDGET and host in _LOOPBACK_HOSTS:
        return True
    return any(host == allowed or host.endswith("." + allowed) for allowed in allowed_hosts(client))


def is_platform_origin(origin: Optional[str], request) -> bool:
    """True when the calling page is one of our own (landing page, preview), not a customer's website."""
    if not origin or origin == "null" or request is None or not request.url.hostname:
        return False
    return _host_of(origin) == _host_of(request.url.hostname)


def enforce_widget_origin(origin: Optional[str], client: Client, request=None) -> None:
    """Stops other websites from embedding a tenant's bot and spending its quota.
    Browsers cannot forge Origin; scripted abuse is handled by the rate limits instead."""
    platform_host = request.url.hostname if request is not None else None
    if settings.ENFORCE_WIDGET_ORIGIN and not origin_allowed(origin, client, platform_host):
        raise HTTPException(status_code=403, detail="This site is not allowed to use this assistant.")
