"""Super admin only: manage customer accounts (tenants), their plans, limits and logins."""
import uuid
from datetime import datetime, timezone
from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.config import PLANS
from app.dependencies import get_db, require_superadmin
from app.models.client import Client
from app.models.tenant import Tenant
from app.models.user import User, ROLE_TENANT_ADMIN
from app.schemas.tenant import (
    PasswordReset,
    PlanInfo,
    TenantCreate,
    TenantResponse,
    TenantUpdate,
    TenantUserCreate,
    TenantUserResponse,
)
from app.services.auth_service import hash_password
from app.services.tenant_service import create_tenant_with_owner, normalise_login, plan_defaults
from app.services.usage_service import get_usage

router = APIRouter(dependencies=[Depends(require_superadmin)])


def _get_tenant(tenant_id: uuid.UUID, db: Session) -> Tenant:
    tenant = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")
    return tenant


def _get_tenant_user(tenant_id: uuid.UUID, user_id: uuid.UUID, db: Session) -> User:
    user = db.query(User).filter(User.id == user_id, User.tenant_id == tenant_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user


def _to_response(tenant: Tenant, db: Session) -> TenantResponse:
    usage = get_usage(tenant.id, db)
    return TenantResponse(
        id=tenant.id,
        name=tenant.name,
        plan=tenant.plan,
        monthly_message_quota=tenant.monthly_message_quota,
        max_bots=tenant.max_bots,
        is_active=tenant.is_active,
        created_at=tenant.created_at,
        bots_used=db.query(Client).filter(Client.tenant_id == tenant.id).count(),
        messages_this_month=usage.messages if usage else 0,
        platform_messages_this_month=usage.platform_messages if usage else 0,
        tokens_this_month=usage.tokens if usage else 0,
        users=[TenantUserResponse.model_validate(u) for u in tenant.users],
    )


@router.get("/plans", response_model=List[PlanInfo])
def list_plans():
    return [PlanInfo(name=name, **limits) for name, limits in PLANS.items()]


@router.get("/tenants", response_model=List[TenantResponse])
def list_tenants(db: Session = Depends(get_db)):
    return [_to_response(t, db) for t in db.query(Tenant).order_by(Tenant.created_at.desc()).all()]


@router.post("/tenants", response_model=TenantResponse, status_code=status.HTTP_201_CREATED)
def create_tenant(body: TenantCreate, db: Session = Depends(get_db)):
    tenant, _ = create_tenant_with_owner(body.name, body.plan, body.owner_email, body.owner_password, db)
    return _to_response(tenant, db)


@router.get("/tenants/{tenant_id}", response_model=TenantResponse)
def get_tenant(tenant_id: uuid.UUID, db: Session = Depends(get_db)):
    return _to_response(_get_tenant(tenant_id, db), db)


@router.put("/tenants/{tenant_id}", response_model=TenantResponse)
def update_tenant(tenant_id: uuid.UUID, body: TenantUpdate, db: Session = Depends(get_db)):
    tenant = _get_tenant(tenant_id, db)
    changes = {k: v for k, v in body.model_dump(exclude_unset=True).items() if v is not None}
    if "plan" in changes and changes["plan"] != tenant.plan:
        # moving plan applies that plan's limits, unless explicit numbers came in the same request
        for field, value in plan_defaults(changes["plan"]).items():
            changes.setdefault(field, value)
    for field, value in changes.items():
        setattr(tenant, field, value)
    db.commit()
    db.refresh(tenant)
    return _to_response(tenant, db)


@router.delete("/tenants/{tenant_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_tenant(tenant_id: uuid.UUID, db: Session = Depends(get_db)):
    """Removes the tenant with all of its users, bots, knowledge, conversations and leads."""
    db.delete(_get_tenant(tenant_id, db))
    db.commit()


@router.post("/tenants/{tenant_id}/users", response_model=TenantUserResponse, status_code=status.HTTP_201_CREATED)
def add_tenant_user(tenant_id: uuid.UUID, body: TenantUserCreate, db: Session = Depends(get_db)):
    tenant = _get_tenant(tenant_id, db)
    email = normalise_login(body.email)
    if db.query(User.id).filter(User.email == email).first():
        raise HTTPException(status_code=409, detail="That email is already registered")
    user = User(email=email, hashed_password=hash_password(body.password), role=ROLE_TENANT_ADMIN, tenant_id=tenant.id,
                email_verified_at=datetime.now(timezone.utc))   # created by the operator: nothing to confirm
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@router.post("/tenants/{tenant_id}/users/{user_id}/reset-password", status_code=status.HTTP_204_NO_CONTENT)
def reset_user_password(tenant_id: uuid.UUID, user_id: uuid.UUID, body: PasswordReset, db: Session = Depends(get_db)):
    user = _get_tenant_user(tenant_id, user_id, db)
    user.hashed_password = hash_password(body.new_password)   # also invalidates the user's tokens
    db.commit()


@router.delete("/tenants/{tenant_id}/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_tenant_user(tenant_id: uuid.UUID, user_id: uuid.UUID, db: Session = Depends(get_db)):
    db.delete(_get_tenant_user(tenant_id, user_id, db))
    db.commit()
