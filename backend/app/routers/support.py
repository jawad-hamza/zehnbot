"""ZehnBot's own customer-support chat: one of the platform's bots, shown in the corner of bot.zehnox.com.
The super admin picks which bot (or none) in Settings; the pages ask here which one to load."""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.dependencies import get_db, require_superadmin
from app.models.client import Client
from app.models.setting import PlatformSetting
from app.models.user import User
from app.services.client_service import get_client_by_slug

public_router = APIRouter()
admin_router = APIRouter()

KEY = "support_bot"


class SupportBot(BaseModel):
    client_id: Optional[str] = Field(default=None, max_length=64)


def support_client_id(db: Session) -> Optional[str]:
    """The support bot's public id, if one is chosen and it (and its workspace) are active."""
    row = db.get(PlatformSetting, KEY)
    client_id = row.value.get("client_id") if row and isinstance(row.value, dict) else None
    return client_id if client_id and get_client_by_slug(client_id, db) else None


@public_router.get("/support-bot", response_model=SupportBot)
def public_support_bot(response: Response, db: Session = Depends(get_db)):
    response.headers["Cache-Control"] = "public, max-age=60"
    return SupportBot(client_id=support_client_id(db))


@admin_router.get("/support-bot", response_model=SupportBot)
def get_support_bot(db: Session = Depends(get_db), _: User = Depends(require_superadmin)):
    row = db.get(PlatformSetting, KEY)
    return SupportBot(**row.value) if row else SupportBot()


@admin_router.put("/support-bot", response_model=SupportBot)
def set_support_bot(body: SupportBot, db: Session = Depends(get_db), _: User = Depends(require_superadmin)):
    client_id = (body.client_id or "").strip() or None
    if client_id and not db.query(Client.id).filter(Client.client_id == client_id).first():
        raise HTTPException(status_code=404, detail="No bot has that id.")
    row = db.get(PlatformSetting, KEY)
    if row:
        row.value = {"client_id": client_id}
    else:
        db.add(PlatformSetting(key=KEY, value={"client_id": client_id}))
    db.commit()
    return SupportBot(client_id=client_id)
