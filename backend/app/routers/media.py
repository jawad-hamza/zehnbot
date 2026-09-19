"""Launcher pictures: uploaded by the bot's owner, served publicly (they appear on the owner's website)."""
from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile
from sqlalchemy.orm import Session

from app.dependencies import get_db, get_owned_client
from app.models.client import Client
from app.models.media import LAUNCHER_SLOTS, BotMedia
from app.schemas.client import ClientResponse
from app.services import media_service
from app.services.client_service import require_active_client

admin_router = APIRouter()
public_router = APIRouter()


def _slot(slot: str) -> str:
    if slot not in LAUNCHER_SLOTS:
        raise HTTPException(status_code=404, detail="Unknown picture slot")
    return slot


@admin_router.put("/clients/{client_uuid}/launcher/{slot}", response_model=ClientResponse)
async def upload_launcher_image(
    slot: str,
    file: UploadFile = File(...),
    client: Client = Depends(get_owned_client),
    db: Session = Depends(get_db),
):
    slot = _slot(slot)
    data = await file.read(media_service.MAX_BYTES + 1)
    content_type = media_service.sniff(data)
    media = next((m for m in client.media if m.slot == slot), None)
    if media is None:
        media = BotMedia(client_id=client.id, slot=slot)
        client.media.append(media)
    media.content_type, media.data, media.sha256 = content_type, data, media_service.digest(data)
    db.commit()
    db.refresh(client)
    return ClientResponse.from_model(client)


@admin_router.delete("/clients/{client_uuid}/launcher/{slot}", response_model=ClientResponse)
def delete_launcher_image(slot: str, client: Client = Depends(get_owned_client), db: Session = Depends(get_db)):
    slot = _slot(slot)
    for media in [m for m in client.media if m.slot == slot]:
        client.media.remove(media)
    db.commit()
    db.refresh(client)
    return ClientResponse.from_model(client)


@public_router.get("/media/{client_id}/{slot}")
def launcher_image(client_id: str, slot: str, db: Session = Depends(get_db)):
    slot = _slot(slot)
    client = require_active_client(client_id[:64], db)
    media = db.query(BotMedia).filter(BotMedia.client_id == client.id, BotMedia.slot == slot).first()
    if media is None:
        raise HTTPException(status_code=404, detail="No picture")
    return Response(
        content=media.data,
        media_type=media.content_type,
        headers={
            # The URL carries a version (?v=...) that changes with the picture
            "Cache-Control": "public, max-age=31536000, immutable",
            # An SVG opened on its own, on our domain, still cannot run anything or load anything
            "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox",
            "Cross-Origin-Resource-Policy": "cross-origin",
            "Content-Disposition": "inline",
        },
    )
