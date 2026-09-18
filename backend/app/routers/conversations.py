import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.dependencies import get_db, get_current_user, get_owned_client
from app.models.client import Client
from app.models.conversation import Conversation, Message
from app.models.user import User
from app.schemas.lead import ConversationListResponse, ConversationSummary, MessageResponse

router = APIRouter()


@router.get("/clients/{client_uuid}/conversations", response_model=ConversationListResponse)
def list_conversations(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    q: Optional[str] = Query(None, max_length=200, description="Only conversations containing this text"),
    client: Client = Depends(get_owned_client),
    db: Session = Depends(get_db),
):
    scope = [Conversation.client_id == client.id]
    if q and q.strip():
        # the visitor's words are data, not a pattern: escape LIKE wildcards
        needle = q.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        matching = select(Message.conversation_id).where(Message.content.ilike(f"%{needle}%", escape="\\"))
        scope.append(Conversation.id.in_(matching))

    total = db.query(Conversation).filter(*scope).count()
    rows = (
        db.query(Conversation, func.count(Message.id))
        .outerjoin(Message, Message.conversation_id == Conversation.id)
        .filter(*scope)
        .group_by(Conversation.id)
        .order_by(Conversation.last_message_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    items = [
        ConversationSummary(
            id=c.id,
            session_id=c.session_id,
            started_at=c.started_at,
            last_message_at=c.last_message_at,
            message_count=count,
        )
        for c, count in rows
    ]
    return ConversationListResponse(total=total, page=page, items=items)


@router.get("/conversations/{conversation_id}/messages")
def get_messages(
    conversation_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    query = db.query(Conversation.id).join(Client, Conversation.client_id == Client.id).filter(Conversation.id == conversation_id)
    if not user.is_superadmin:
        query = query.filter(Client.tenant_id == user.tenant_id)
    if not query.first():
        raise HTTPException(status_code=404, detail="Conversation not found")

    msgs = (
        db.query(Message)
        .filter(Message.conversation_id == conversation_id)
        .order_by(Message.created_at)
        .all()
    )
    return [MessageResponse.model_validate(m) for m in msgs]
