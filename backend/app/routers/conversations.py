from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func
import uuid

from app.dependencies import get_db, get_current_admin
from app.models.client import Client
from app.models.conversation import Conversation, Message
from app.schemas.lead import ConversationListResponse, ConversationSummary, MessageResponse

router = APIRouter()


@router.get("/clients/{client_uuid}/conversations", response_model=ConversationListResponse)
def list_conversations(
    client_uuid: uuid.UUID,
    page: int = 1,
    page_size: int = 20,
    db: Session = Depends(get_db),
    _=Depends(get_current_admin),
):
    client = db.query(Client).filter(Client.id == client_uuid).first()
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")

    total = db.query(Conversation).filter(Conversation.client_id == client_uuid).count()
    convs = (
        db.query(Conversation)
        .filter(Conversation.client_id == client_uuid)
        .order_by(Conversation.last_message_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )

    items = []
    for c in convs:
        count = db.query(Message).filter(Message.conversation_id == c.id).count()
        items.append(
            ConversationSummary(
                id=c.id,
                session_id=c.session_id,
                started_at=c.started_at,
                last_message_at=c.last_message_at,
                message_count=count,
            )
        )
    return ConversationListResponse(total=total, page=page, items=items)


@router.get("/conversations/{conversation_id}/messages")
def get_messages(
    conversation_id: uuid.UUID,
    db: Session = Depends(get_db),
    _=Depends(get_current_admin),
):
    msgs = (
        db.query(Message)
        .filter(Message.conversation_id == conversation_id)
        .order_by(Message.created_at)
        .all()
    )
    return [MessageResponse.model_validate(m) for m in msgs]
