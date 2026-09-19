"""The two home screens: the platform operator's, and each customer workspace's."""
import uuid
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.config import PLANS, settings
from app.dependencies import get_current_user, get_db, require_superadmin
from app.models.enquiry import Enquiry
from app.models.client import Client
from app.models.conversation import Conversation, Message
from app.models.knowledge import KnowledgeChunk
from app.models.lead import Lead
from app.models.tenant import Tenant, UsageCounter
from app.models.user import User
from app.services import embedding_service
from app.services.providers import get_provider
from app.services.usage_service import current_period

router = APIRouter()


# ---------- shared ----------

def _window(days: int):
    today = datetime.now(timezone.utc).date()
    first_day = today - timedelta(days=days - 1)
    since = datetime.combine(first_day, datetime.min.time(), tzinfo=timezone.utc)
    return first_day, since


def _per_day(query, day_column) -> Dict[str, int]:
    day = func.date(day_column)
    return {str(d): n for d, n in query.with_entities(day, func.count()).group_by(day).all()}


def _series(first_day, days: int, **counts: Dict[str, int]) -> List[dict]:
    rows = []
    for offset in range(days):
        key = (first_day + timedelta(days=offset)).isoformat()
        rows.append({"date": key, **{name: values.get(key, 0) for name, values in counts.items()}})
    return rows


# ---------- platform (super admin) ----------

class PlatformTotals(BaseModel):
    tenants: int
    active_tenants: int
    suspended_tenants: int
    bots: int
    active_bots: int
    users: int
    tenants_near_quota: int
    new_enquiries: int


class PlatformPeriod(BaseModel):
    new_tenants: int
    conversations: int
    visitor_messages: int
    leads: int


class PlatformMonth(BaseModel):
    messages: int
    platform_messages: int
    tokens: int


class PlatformDay(BaseModel):
    date: str
    signups: int
    conversations: int
    visitor_messages: int
    leads: int


class PlanCount(BaseModel):
    plan: str
    tenants: int


class TenantUsageRow(BaseModel):
    id: uuid.UUID
    name: str
    plan: str
    is_active: bool
    bots: int
    messages_this_month: int
    platform_messages_this_month: int
    monthly_message_quota: int


class RecentTenant(BaseModel):
    id: uuid.UUID
    name: str
    plan: str
    is_active: bool
    owner_email: Optional[str]
    created_at: datetime


class SystemStatus(BaseModel):
    environment: str
    platform_provider: str
    platform_model: Optional[str]
    platform_key_set: bool
    semantic_search: bool
    signup_open: bool
    signup_wanted: bool              # ALLOW_SIGNUP is on (it may still be closed for want of a mail server)
    email_verification: bool
    unverified_signup_allowed: bool
    google_sign_in: bool
    custom_endpoints_allowed: bool


class PlatformOverview(BaseModel):
    days: int
    totals: PlatformTotals
    period: PlatformPeriod
    month: PlatformMonth
    daily: List[PlatformDay]
    plans: List[PlanCount]
    top_tenants: List[TenantUsageRow]
    recent_tenants: List[RecentTenant]
    system: SystemStatus


@router.get("/overview/platform", response_model=PlatformOverview)
def platform_overview(
    days: int = Query(30, ge=7, le=365),
    db: Session = Depends(get_db),
    _: User = Depends(require_superadmin),
):
    first_day, since = _window(days)
    period = current_period()

    tenants = db.query(Tenant)
    bots = db.query(Client)
    new_tenants = tenants.filter(Tenant.created_at >= since)
    conversations = db.query(Conversation).filter(Conversation.started_at >= since)
    visitor_messages = db.query(Message).filter(Message.role == "user", Message.created_at >= since)
    leads = db.query(Lead).filter(Lead.captured_at >= since)

    usage_by_tenant = {u.tenant_id: u for u in db.query(UsageCounter).filter(UsageCounter.period == period).all()}
    bots_by_tenant = dict(db.query(Client.tenant_id, func.count(Client.id)).group_by(Client.tenant_id).all())

    rows, near_quota = [], 0
    for tenant in tenants.all():
        usage = usage_by_tenant.get(tenant.id)
        platform_used = usage.platform_messages if usage else 0
        if tenant.monthly_message_quota and platform_used >= 0.8 * tenant.monthly_message_quota:
            near_quota += 1
        rows.append(TenantUsageRow(
            id=tenant.id, name=tenant.name, plan=tenant.plan, is_active=tenant.is_active,
            bots=bots_by_tenant.get(tenant.id, 0),
            messages_this_month=usage.messages if usage else 0,
            platform_messages_this_month=platform_used,
            monthly_message_quota=tenant.monthly_message_quota,
        ))
    rows.sort(key=lambda r: (r.messages_this_month, r.bots), reverse=True)

    owners = {}
    for user in db.query(User).filter(User.tenant_id.isnot(None)).order_by(User.created_at).all():
        owners.setdefault(user.tenant_id, user.email)
    recent = [
        RecentTenant(id=t.id, name=t.name, plan=t.plan, is_active=t.is_active, owner_email=owners.get(t.id), created_at=t.created_at)
        for t in tenants.order_by(Tenant.created_at.desc()).limit(8).all()
    ]

    plan_counts = dict(db.query(Tenant.plan, func.count(Tenant.id)).group_by(Tenant.plan).all())
    plan_order = list(PLANS) + sorted(set(plan_counts) - set(PLANS))
    platform = get_provider(settings.platform_provider)

    probe = list(usage_by_tenant.values())
    return PlatformOverview(
        days=days,
        totals=PlatformTotals(
            tenants=tenants.count(),
            active_tenants=tenants.filter(Tenant.is_active.is_(True)).count(),
            suspended_tenants=tenants.filter(Tenant.is_active.is_(False)).count(),
            bots=bots.count(),
            active_bots=bots.filter(Client.is_active.is_(True)).count(),
            users=db.query(User).count(),
            tenants_near_quota=near_quota,
            new_enquiries=db.query(Enquiry).filter(Enquiry.status == "new").count(),
        ),
        period=PlatformPeriod(
            new_tenants=new_tenants.count(),
            conversations=conversations.count(),
            visitor_messages=visitor_messages.count(),
            leads=leads.count(),
        ),
        month=PlatformMonth(
            messages=sum(u.messages for u in probe),
            platform_messages=sum(u.platform_messages for u in probe),
            tokens=sum(u.tokens for u in probe),
        ),
        daily=_series(
            first_day, days,
            signups=_per_day(new_tenants, Tenant.created_at),
            conversations=_per_day(conversations, Conversation.started_at),
            visitor_messages=_per_day(visitor_messages, Message.created_at),
            leads=_per_day(leads, Lead.captured_at),
        ),
        plans=[PlanCount(plan=p, tenants=plan_counts.get(p, 0)) for p in plan_order],
        top_tenants=rows[:8],
        recent_tenants=recent,
        system=SystemStatus(
            environment=settings.ENVIRONMENT,
            platform_provider=platform.label if platform else settings.platform_provider,
            platform_model=settings.PLATFORM_AI_MODEL or (platform.default_model if platform else None),
            platform_key_set=bool(settings.platform_api_key),
            semantic_search=embedding_service.semantic_search_available(db),
            signup_open=settings.signup_open,
            signup_wanted=settings.ALLOW_SIGNUP,
            email_verification=settings.email_enabled,
            unverified_signup_allowed=settings.ALLOW_UNVERIFIED_SIGNUP,
            google_sign_in=settings.google_enabled,
            custom_endpoints_allowed=settings.ALLOW_CUSTOM_AI_ENDPOINTS,
        ),
    )


# ---------- workspace (a customer's own home) ----------

class WorkspaceSummary(BaseModel):
    id: uuid.UUID
    name: str
    plan: str
    monthly_message_quota: int
    platform_messages_this_month: int
    messages_this_month: int
    max_bots: int
    bots_used: int


class WorkspacePeriod(BaseModel):
    conversations: int
    visitor_messages: int
    leads: int
    unanswered: int
    answer_rate: float
    lead_conversion_rate: float


class WorkspaceDay(BaseModel):
    date: str
    conversations: int
    visitor_messages: int
    leads: int


class BotRow(BaseModel):
    id: uuid.UUID
    name: str
    client_id: str
    domain: str
    is_active: bool
    uses_own_key: bool
    knowledge_chunks: int
    conversations: int
    leads: int


class RecentLead(BaseModel):
    id: uuid.UUID
    name: Optional[str]
    email: Optional[str]
    phone: Optional[str]
    bot_id: uuid.UUID
    bot_name: str
    captured_at: datetime


class OpenQuestion(BaseModel):
    question: str
    bot_id: uuid.UUID
    bot_name: str
    asked_at: datetime


class Checklist(BaseModel):
    has_bot: bool
    has_knowledge: bool
    has_conversation: bool
    has_lead: bool


class WorkspaceOverview(BaseModel):
    days: int
    workspace: WorkspaceSummary
    period: WorkspacePeriod
    daily: List[WorkspaceDay]
    bots: List[BotRow]
    recent_leads: List[RecentLead]
    open_questions: List[OpenQuestion]
    checklist: Checklist


def _own_tenant(user: User) -> Tenant:
    if user.tenant is None:
        raise HTTPException(status_code=404, detail="This login does not belong to a workspace.")
    return user.tenant


@router.get("/overview/workspace", response_model=WorkspaceOverview)
def workspace_overview(
    days: int = Query(30, ge=7, le=365),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    tenant = _own_tenant(user)
    first_day, since = _window(days)

    bots = db.query(Client).filter(Client.tenant_id == tenant.id).order_by(Client.created_at).all()
    bot_ids = [b.id for b in bots]
    names = {b.id: b.name for b in bots}

    # Every query below is confined to this tenant's bots: nothing here may ever see another tenant
    conversations = db.query(Conversation).filter(Conversation.client_id.in_(bot_ids), Conversation.started_at >= since)
    messages = (
        db.query(Message).join(Conversation, Message.conversation_id == Conversation.id)
        .filter(Conversation.client_id.in_(bot_ids), Message.created_at >= since)
    )
    visitor_messages = messages.filter(Message.role == "user")
    replies = messages.filter(Message.role == "assistant")
    unanswered = replies.filter(Message.unanswered.is_(True))
    leads = db.query(Lead).filter(Lead.client_id.in_(bot_ids), Lead.captured_at >= since)

    def grouped(column, query):
        return dict(query.with_entities(column, func.count()).group_by(column).all())

    chunks_by_bot = grouped(KnowledgeChunk.client_id, db.query(KnowledgeChunk).filter(KnowledgeChunk.client_id.in_(bot_ids)))
    conversations_by_bot = grouped(Conversation.client_id, conversations)
    leads_by_bot = grouped(Lead.client_id, leads)

    # The same question asked five times is one gap in the content, so it is listed once (its latest asking)
    open_questions, seen = [], set()
    for reply, bot_id in (
        unanswered.with_entities(Message, Conversation.client_id).order_by(Message.created_at.desc()).limit(60).all()
    ):
        asked = (
            db.query(Message)
            .filter(Message.conversation_id == reply.conversation_id, Message.role == "user", Message.created_at < reply.created_at)
            .order_by(Message.created_at.desc())
            .first()
        )
        key = (bot_id, " ".join(asked.content.lower().split())) if asked else None
        if key is None or key in seen:
            continue
        seen.add(key)
        open_questions.append(OpenQuestion(question=asked.content, bot_id=bot_id, bot_name=names.get(bot_id, ""), asked_at=asked.created_at))
        if len(open_questions) == 6:
            break

    usage = (
        db.query(UsageCounter)
        .filter(UsageCounter.tenant_id == tenant.id, UsageCounter.period == current_period())
        .first()
    )
    conversation_count, reply_count, unanswered_count, lead_count = (
        conversations.count(), replies.count(), unanswered.count(), leads.count(),
    )
    all_time_conversation = db.query(Conversation.id).filter(Conversation.client_id.in_(bot_ids)).first() is not None
    all_time_lead = db.query(Lead.id).filter(Lead.client_id.in_(bot_ids)).first() is not None

    return WorkspaceOverview(
        days=days,
        workspace=WorkspaceSummary(
            id=tenant.id, name=tenant.name, plan=tenant.plan,
            monthly_message_quota=tenant.monthly_message_quota,
            platform_messages_this_month=usage.platform_messages if usage else 0,
            messages_this_month=usage.messages if usage else 0,
            max_bots=tenant.max_bots, bots_used=len(bots),
        ),
        period=WorkspacePeriod(
            conversations=conversation_count,
            visitor_messages=visitor_messages.count(),
            leads=lead_count,
            unanswered=unanswered_count,
            answer_rate=round(1 - unanswered_count / reply_count, 4) if reply_count else 1.0,
            lead_conversion_rate=round(lead_count / conversation_count, 4) if conversation_count else 0.0,
        ),
        daily=_series(
            first_day, days,
            conversations=_per_day(conversations, Conversation.started_at),
            visitor_messages=_per_day(visitor_messages, Message.created_at),
            leads=_per_day(leads, Lead.captured_at),
        ),
        bots=[
            BotRow(
                id=b.id, name=b.name, client_id=b.client_id, domain=b.domain, is_active=b.is_active,
                uses_own_key=bool(b.ai_api_key), knowledge_chunks=chunks_by_bot.get(b.id, 0),
                conversations=conversations_by_bot.get(b.id, 0), leads=leads_by_bot.get(b.id, 0),
            )
            for b in bots
        ],
        recent_leads=[
            RecentLead(id=l.id, name=l.name, email=l.email, phone=l.phone, bot_id=l.client_id,
                       bot_name=names.get(l.client_id, ""), captured_at=l.captured_at)
            for l in db.query(Lead).filter(Lead.client_id.in_(bot_ids)).order_by(Lead.captured_at.desc()).limit(6).all()
        ],
        open_questions=open_questions,
        checklist=Checklist(
            has_bot=bool(bots), has_knowledge=bool(chunks_by_bot),
            has_conversation=all_time_conversation, has_lead=all_time_lead,
        ),
    )


class WorkspaceUpdate(BaseModel):
    name: str = Field(min_length=2, max_length=255)


@router.put("/workspace", response_model=WorkspaceSummary)
def rename_workspace(body: WorkspaceUpdate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """A customer may rename their own workspace. Plan and limits stay with the platform operator."""
    tenant = _own_tenant(user)
    name = body.name.strip()
    if len(name) < 2:
        raise HTTPException(status_code=422, detail="A workspace name needs at least two characters.")
    tenant.name = name
    db.commit()
    db.refresh(tenant)
    usage = db.query(UsageCounter).filter(UsageCounter.tenant_id == tenant.id, UsageCounter.period == current_period()).first()
    return WorkspaceSummary(
        id=tenant.id, name=tenant.name, plan=tenant.plan, monthly_message_quota=tenant.monthly_message_quota,
        platform_messages_this_month=usage.platform_messages if usage else 0,
        messages_this_month=usage.messages if usage else 0,
        max_bots=tenant.max_bots, bots_used=db.query(Client).filter(Client.tenant_id == tenant.id).count(),
    )
