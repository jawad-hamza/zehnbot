from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.config import PLANS
from app.models.client import Client
from app.models.tenant import Tenant
from app.models.user import User, ROLE_TENANT_ADMIN
from app.services.auth_service import hash_password


def normalise_login(value: str) -> str:
    """Email addresses are stored lower-cased; legacy free-form usernames are left alone."""
    value = value.strip()
    return value.lower() if "@" in value else value


def plan_defaults(plan: str) -> dict:
    if plan not in PLANS:
        raise HTTPException(status_code=400, detail=f"Unknown plan. Choose one of: {', '.join(PLANS)}")
    return PLANS[plan]


def create_tenant_with_owner(name: str, plan: str, owner_email: str, owner_password: str, db: Session, verified: bool = True) -> tuple[Tenant, User]:
    """Creates the tenant and its first login in one transaction. `verified=False` is for self-service
    sign-ups that still have to confirm their email address."""
    defaults = plan_defaults(plan)
    email = normalise_login(owner_email)
    if db.query(User.id).filter(User.email == email).first():
        raise HTTPException(status_code=409, detail="That email is already registered")

    tenant = Tenant(name=name.strip(), plan=plan, **defaults)
    db.add(tenant)
    db.flush()
    user = User(email=email, hashed_password=hash_password(owner_password), role=ROLE_TENANT_ADMIN, tenant_id=tenant.id,
                email_verified_at=datetime.now(timezone.utc) if verified else None)
    db.add(user)
    db.commit()
    db.refresh(tenant)
    db.refresh(user)
    return tenant, user


def enforce_bot_limit(tenant: Tenant, db: Session) -> None:
    count = db.query(Client).filter(Client.tenant_id == tenant.id).count()
    if count >= tenant.max_bots:
        raise HTTPException(
            status_code=403,
            detail=f"Your plan allows {tenant.max_bots} bot(s). Upgrade your plan to add more.",
        )
