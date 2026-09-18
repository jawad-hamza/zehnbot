from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.config import settings
from app.dependencies import get_db, get_current_user
from app.models.client import Client
from app.models.user import User
from app.schemas.auth import (
    AuthConfig,
    ChangeCredentialsRequest,
    LoginRequest,
    SignupRequest,
    TenantSummary,
    TokenResponse,
    UserInfo,
)
from app.services import rate_limit
from app.services.auth_service import burn_password_check, create_access_token, hash_password, verify_password
from app.services.tenant_service import create_tenant_with_owner
from app.services.usage_service import get_usage

router = APIRouter()


@router.get("/config", response_model=AuthConfig)
def auth_config():
    return AuthConfig(allow_signup=settings.ALLOW_SIGNUP)


@router.post("/login", response_model=TokenResponse)
def login(body: LoginRequest, request: Request, db: Session = Depends(get_db)):
    detail = "Too many login attempts. Try again in a few minutes."
    rate_limit.enforce("login-ip", rate_limit.client_ip(request), settings.RATE_LOGIN_PER_IP_PER_5MIN, 300, detail)
    rate_limit.enforce("login-acct", body.email.strip().lower(), settings.RATE_LOGIN_PER_ACCOUNT_PER_5MIN, 300, detail)

    typed = body.email.strip()
    user = db.query(User).filter(User.email == typed).first()
    if not user and typed != typed.lower():
        user = db.query(User).filter(User.email == typed.lower()).first()
    if not user:
        burn_password_check(body.password)
    if not user or not verify_password(body.password, user.hashed_password) or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if not user.is_superadmin and (user.tenant is None or not user.tenant.is_active):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="This account is suspended.")
    return TokenResponse(access_token=create_access_token(str(user.id), user.hashed_password))


@router.post("/signup", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
def signup(body: SignupRequest, request: Request, db: Session = Depends(get_db)):
    if not settings.ALLOW_SIGNUP:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Sign-up is closed. Contact us for an account.")
    rate_limit.enforce(
        "signup-ip", rate_limit.client_ip(request), settings.RATE_SIGNUP_PER_IP_PER_HOUR, 3600,
        "Too many sign-ups from this address. Try again later.",
    )
    _, user = create_tenant_with_owner(
        name=body.company_name,
        plan=settings.DEFAULT_SIGNUP_PLAN,
        owner_email=str(body.email).lower(),
        owner_password=body.password,
        db=db,
    )
    return TokenResponse(access_token=create_access_token(str(user.id), user.hashed_password))


@router.get("/me", response_model=UserInfo)
def me(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    summary = None
    if user.tenant is not None:
        tenant = user.tenant
        usage = get_usage(tenant.id, db)
        summary = TenantSummary(
            id=str(tenant.id),
            name=tenant.name,
            plan=tenant.plan,
            monthly_message_quota=tenant.monthly_message_quota,
            max_bots=tenant.max_bots,
            bots_used=db.query(Client).filter(Client.tenant_id == tenant.id).count(),
            messages_this_month=usage.messages if usage else 0,
            platform_messages_this_month=usage.platform_messages if usage else 0,
        )
    return UserInfo(id=str(user.id), email=user.email, role=user.role, tenant=summary)


@router.post("/change-credentials")
def change_credentials(
    body: ChangeCredentialsRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not verify_password(body.current_password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Current password is incorrect")

    if body.new_email and body.new_email.strip() != user.email:
        new_email = body.new_email.strip()
        taken = db.query(User).filter(User.email == new_email, User.id != user.id).first()
        if taken:
            raise HTTPException(status_code=409, detail="Username already in use")
        user.email = new_email

    if body.new_password:
        user.hashed_password = hash_password(body.new_password)

    db.commit()
    db.refresh(user)
    # Changing the password kills every existing token, so hand back a fresh one
    return {
        "success": True,
        "email": user.email,
        "access_token": create_access_token(str(user.id), user.hashed_password),
    }
