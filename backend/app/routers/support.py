"""The chats on the platform's own pages, both answered by bots the super admin picks in Settings:

- the support chat in the corner of every page (landing page, sign-up, log-in, customer dashboard);
- the live demo on the landing page ("Ask it something"). Without one picked here, LANDING_DEMO_BOT in
  .env still applies; with neither, the landing page shows a screenshot instead."""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.config import settings
from app.dependencies import get_db, require_superadmin
from app.models.client import Client
from app.models.setting import PlatformSetting
from app.models.user import User
from app.services.client_service import get_client_by_slug

public_router = APIRouter()
admin_router = APIRouter()

SUPPORT_KEY = "support_bot"
DEMO_KEY = "demo_bot"


class SupportBot(BaseModel):
    client_id: Optional[str] = Field(default=None, max_length=64)


class SiteChats(BaseModel):
    support_client_id: Optional[str] = Field(default=None, max_length=64)
    demo_client_id: Optional[str] = Field(default=None, max_length=64)
    demo_from_env: Optional[str] = None      # read-only: LANDING_DEMO_BOT, used when no demo bot is picked here


def _stored(db: Session, key: str) -> Optional[str]:
    row = db.get(PlatformSetting, key)
    return (row.value.get("client_id") or None) if row and isinstance(row.value, dict) else None


def _save(db: Session, key: str, client_id: Optional[str]) -> None:
    row = db.get(PlatformSetting, key)
    if row:
        row.value = {"client_id": client_id}
    else:
        db.add(PlatformSetting(key=key, value={"client_id": client_id}))


def support_client_id(db: Session) -> Optional[str]:
    """The support bot's public id, if one is chosen and it (and its workspace) are active."""
    client_id = _stored(db, SUPPORT_KEY)
    return client_id if client_id and get_client_by_slug(client_id, db) else None


def demo_client_id(db: Session) -> Optional[str]:
    """The landing page's live demo bot: picked in Settings, else LANDING_DEMO_BOT. None if it is not active."""
    client_id = _stored(db, DEMO_KEY) or settings.LANDING_DEMO_BOT.strip() or None
    return client_id if client_id and get_client_by_slug(client_id, db) else None


@public_router.get("/support-bot", response_model=SupportBot)
def public_support_bot(response: Response, db: Session = Depends(get_db)):
    response.headers["Cache-Control"] = "public, max-age=60"
    return SupportBot(client_id=support_client_id(db))


def _site_chats(db: Session) -> SiteChats:
    return SiteChats(
        support_client_id=_stored(db, SUPPORT_KEY), demo_client_id=_stored(db, DEMO_KEY),
        demo_from_env=settings.LANDING_DEMO_BOT.strip() or None,
    )


@admin_router.get("/site-chats", response_model=SiteChats)
def get_site_chats(db: Session = Depends(get_db), _: User = Depends(require_superadmin)):
    return _site_chats(db)


@admin_router.put("/site-chats", response_model=SiteChats)
def set_site_chats(body: SiteChats, db: Session = Depends(get_db), _: User = Depends(require_superadmin)):
    chosen = {SUPPORT_KEY: (body.support_client_id or "").strip() or None, DEMO_KEY: (body.demo_client_id or "").strip() or None}
    for client_id in filter(None, chosen.values()):
        if not db.query(Client.id).filter(Client.client_id == client_id).first():
            raise HTTPException(status_code=404, detail=f"No bot has the id {client_id}.")
    for key, client_id in chosen.items():
        _save(db, key, client_id)
    db.commit()
    return _site_chats(db)
