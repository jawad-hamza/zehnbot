from fastapi import HTTPException
from sqlalchemy.orm import Session
from app.models.client import Client


def get_client_by_slug(client_id: str, db: Session) -> Client | None:
    return (
        db.query(Client)
        .filter(Client.client_id == client_id, Client.is_active == True)
        .first()
    )


def require_active_client(client_id: str, db: Session) -> Client:
    client = get_client_by_slug(client_id, db)
    if not client:
        raise HTTPException(status_code=404, detail="Unknown client")
    return client
