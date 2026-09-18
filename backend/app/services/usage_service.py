from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.tenant import Tenant, UsageCounter


def current_period() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m")


def get_usage(tenant_id, db: Session, period: Optional[str] = None) -> Optional[UsageCounter]:
    return (
        db.query(UsageCounter)
        .filter(UsageCounter.tenant_id == tenant_id, UsageCounter.period == (period or current_period()))
        .first()
    )


def platform_quota_exceeded(tenant: Tenant, db: Session) -> bool:
    usage = get_usage(tenant.id, db)
    used = usage.platform_messages if usage else 0
    return used >= tenant.monthly_message_quota   # a quota of 0 blocks from the first message


def record_usage(tenant_id, tokens: int, used_platform_key: bool, db: Session) -> None:
    """Atomically add one message to this month's counter. Caller commits."""
    period = current_period()
    increment = (
        update(UsageCounter)
        .where(UsageCounter.tenant_id == tenant_id, UsageCounter.period == period)
        .values(
            messages=UsageCounter.messages + 1,
            platform_messages=UsageCounter.platform_messages + (1 if used_platform_key else 0),
            tokens=UsageCounter.tokens + (tokens or 0),
        )
    )
    if db.execute(increment).rowcount:
        return
    try:
        with db.begin_nested():
            db.add(UsageCounter(
                tenant_id=tenant_id,
                period=period,
                messages=1,
                platform_messages=1 if used_platform_key else 0,
                tokens=tokens or 0,
            ))
    except IntegrityError:
        # another request created this month's row first
        db.execute(increment)
