from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.dependencies import get_db, get_owned_client
from app.models.client import Client
from app.models.conversation import Conversation, Message
from app.models.lead import Lead
from app.schemas.lead import AnalyticsResponse, DailyActivity, UnansweredQuestion

router = APIRouter()

UNANSWERED_SHOWN = 25


def _per_day(query, day_column) -> dict:
    """{'YYYY-MM-DD': count}. `func.date` exists on both Postgres and SQLite."""
    day = func.date(day_column)
    return {str(d): n for d, n in query.with_entities(day, func.count()).group_by(day).all()}


@router.get("/clients/{client_uuid}/analytics", response_model=AnalyticsResponse)
def bot_analytics(
    days: int = Query(30, ge=1, le=365),
    client: Client = Depends(get_owned_client),
    db: Session = Depends(get_db),
):
    """Activity for one bot over the last `days` days (UTC), plus the questions it could not
    answer, which is the owner's to-do list for the knowledge base."""
    today = datetime.now(timezone.utc).date()
    first_day = today - timedelta(days=days - 1)
    since = datetime.combine(first_day, datetime.min.time(), tzinfo=timezone.utc)

    conversations = db.query(Conversation).filter(Conversation.client_id == client.id, Conversation.started_at >= since)
    messages = (
        db.query(Message)
        .join(Conversation, Message.conversation_id == Conversation.id)
        .filter(Conversation.client_id == client.id, Message.created_at >= since)
    )
    visitor_messages = messages.filter(Message.role == "user")
    replies = messages.filter(Message.role == "assistant")
    unanswered = replies.filter(Message.unanswered.is_(True))
    leads = db.query(Lead).filter(Lead.client_id == client.id, Lead.captured_at >= since)

    by_day = {
        "conversations": _per_day(conversations, Conversation.started_at),
        "visitor_messages": _per_day(visitor_messages, Message.created_at),
        "leads": _per_day(leads, Lead.captured_at),
    }
    daily = []
    for offset in range(days):
        key = (first_day + timedelta(days=offset)).isoformat()
        daily.append(DailyActivity(date=key, **{name: counts.get(key, 0) for name, counts in by_day.items()}))

    questions = []
    for reply in unanswered.order_by(Message.created_at.desc()).limit(UNANSWERED_SHOWN).all():
        asked = (
            db.query(Message)
            .filter(
                Message.conversation_id == reply.conversation_id,
                Message.role == "user",
                Message.created_at < reply.created_at,
            )
            .order_by(Message.created_at.desc())
            .first()
        )
        if asked:
            questions.append(UnansweredQuestion(question=asked.content, asked_at=asked.created_at, conversation_id=asked.conversation_id))

    conversation_count, reply_count, unanswered_count, lead_count = (
        conversations.count(), replies.count(), unanswered.count(), leads.count(),
    )
    return AnalyticsResponse(
        days=days,
        conversations=conversation_count,
        visitor_messages=visitor_messages.count(),
        leads=lead_count,
        unanswered=unanswered_count,
        lead_conversion_rate=round(lead_count / conversation_count, 4) if conversation_count else 0.0,
        answer_rate=round(1 - unanswered_count / reply_count, 4) if reply_count else 1.0,
        daily=daily,
        unanswered_questions=questions,
    )
