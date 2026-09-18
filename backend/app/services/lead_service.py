from sqlalchemy.orm import Session
from app.models.lead import Lead
from app.models.client import Client
import uuid


def save_lead(
    client: Client,
    conversation_id: str | None,
    name: str | None,
    email: str | None,
    phone: str | None,
    raw_context: str | None,
    db: Session,
) -> Lead:
    conv_uuid = uuid.UUID(conversation_id) if conversation_id else None
    lead = Lead(
        client_id=client.id,
        conversation_id=conv_uuid,
        name=name,
        email=email,
        phone=phone,
        raw_context=raw_context,
    )
    db.add(lead)
    db.commit()
    db.refresh(lead)
    return lead
