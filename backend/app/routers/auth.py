import logging
import secrets
import uuid
from datetime import datetime, timezone
from typing import Optional
from urllib.parse import quote

from fastapi import APIRouter, BackgroundTasks, Cookie, Depends, HTTPException, Request, status
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session

from app.config import settings
from app.dependencies import get_db, get_current_user
from app.models.client import Client
from app.models.user import User
from app.schemas.auth import (
    AuthConfig,
    ChangeCredentialsRequest,
    LoginRequest,
    ResendVerificationRequest,
    SignupRequest,
    SignupResponse,
    TenantSummary,
    TokenResponse,
    UserInfo,
    VerifyEmailRequest,
)
from app.services import rate_limit
from app.services import google_service
from app.services.auth_service import (
    burn_password_check,
    create_access_token,
    create_email_verification_token,
    email_matches_token,
    has_usable_password,
    hash_password,
    read_email_verification_token,
    unusable_password,
    verify_password,
)
from app.services.email_service import send_verification_email
from app.services.tenant_service import create_tenant_with_owner, normalise_login
from app.services.usage_service import get_usage

router = APIRouter()
logger = logging.getLogger("app.auth")

UNVERIFIED = "Confirm your email address first. We sent you a link when you signed up."


def _needs_verification(user: User) -> bool:
    """Only enforced once the platform can actually send email; the operator is never locked out by it."""
    return settings.email_enabled and not user.is_superadmin and user.email_verified_at is None


def _send_verification(user: User, background: BackgroundTasks) -> None:
    token = create_email_verification_token(str(user.id), user.email)
    background.add_task(send_verification_email, user.email, f"{settings.public_base_url}/verify-email?token={quote(token)}")


def _marketing_url() -> Optional[str]:
    url = settings.MARKETING_URL.strip()
    return url if url.startswith(("https://", "http://")) else None     # never a javascript: link


@router.get("/config", response_model=AuthConfig)
def auth_config():
    return AuthConfig(
        allow_signup=settings.signup_open, demo_client_id=settings.LANDING_DEMO_BOT.strip() or None,
        google_enabled=settings.google_enabled, google_signup=settings.google_signup_open,
        email_verification=settings.email_enabled,
        marketing_url=_marketing_url(),
    )


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
    if _needs_verification(user):
        # only reachable with the right password, so this tells a stranger nothing
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=UNVERIFIED, headers={"X-Auth-Reason": "email-unverified"})
    return TokenResponse(access_token=create_access_token(str(user.id), user.hashed_password))


@router.post("/signup", response_model=SignupResponse, status_code=status.HTTP_201_CREATED)
def signup(body: SignupRequest, request: Request, background: BackgroundTasks, db: Session = Depends(get_db)):
    if not settings.signup_open:
        # also the case when sign-up is switched on but no mail server is configured: an account must
        # never be created for an address nobody has proven they own
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Sign-up is closed. Contact us for an account.")
    if body.website:
        # answered exactly like any other failed sign-up, so a bot learns nothing from it
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Could not create the account.")
    rate_limit.enforce(
        "signup-ip", rate_limit.client_ip(request), settings.RATE_SIGNUP_PER_IP_PER_HOUR, 3600,
        "Too many sign-ups from this address. Try again later.",
    )
    email = normalise_login(str(body.email))
    squatter = db.query(User).filter(User.email == email).first()
    if squatter is not None and _needs_verification(squatter) and squatter.tenant is not None:
        # Someone registered this address and never proved they own it. Whoever can open the inbox
        # wins: the new password replaces the old one, and only the emailed link activates it.
        squatter.hashed_password = hash_password(body.password)
        squatter.tenant.name = body.company_name.strip()
        db.commit()
        _send_verification(squatter, background)
        return SignupResponse(verification_required=True)

    _, user = create_tenant_with_owner(
        name=body.company_name,
        plan=settings.DEFAULT_SIGNUP_PLAN,
        owner_email=email,
        owner_password=body.password,
        db=db,
        verified=not settings.email_enabled,
    )
    if _needs_verification(user):
        _send_verification(user, background)
        return SignupResponse(verification_required=True)
    return SignupResponse(access_token=create_access_token(str(user.id), user.hashed_password))


@router.post("/verify-email", response_model=TokenResponse)
def verify_email(body: VerifyEmailRequest, request: Request, db: Session = Depends(get_db)):
    """The link in the email lands on the dashboard, which posts the token here. Confirms and signs in."""
    rate_limit.enforce("login-ip", rate_limit.client_ip(request), settings.RATE_LOGIN_PER_IP_PER_5MIN, 300)
    expired = HTTPException(status_code=400, detail="This link is not valid any more. Ask for a new one from the log in page.")
    try:
        payload = read_email_verification_token(body.token)
        user = db.query(User).filter(User.id == uuid.UUID(payload["sub"])).first()
    except Exception:
        raise expired
    if not user or not user.is_active or not email_matches_token(user.email, payload):
        raise expired
    if not user.is_superadmin and (user.tenant is None or not user.tenant.is_active):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="This account is suspended.")
    if user.email_verified_at is None:
        user.email_verified_at = datetime.now(timezone.utc)
        db.commit()
    return TokenResponse(access_token=create_access_token(str(user.id), user.hashed_password))


@router.post("/resend-verification")
def resend_verification(body: ResendVerificationRequest, request: Request, background: BackgroundTasks, db: Session = Depends(get_db)):
    email = normalise_login(str(body.email))
    rate_limit.enforce("verify-ip", rate_limit.client_ip(request), settings.RATE_LOGIN_PER_IP_PER_5MIN, 300)
    rate_limit.enforce("verify-addr", email, settings.RATE_VERIFY_EMAIL_PER_ADDRESS_PER_HOUR, 3600,
                       "A link was sent a moment ago. Check your inbox and spam folder.")
    user = db.query(User).filter(User.email == email).first()
    if user is not None and user.is_active and _needs_verification(user):
        _send_verification(user, background)
    # the same answer either way: this must not reveal who has an account
    return {"detail": "If that address is waiting to be confirmed, a new link is on its way."}


# ---------- Sign in with Google ----------

_STATE_COOKIE = "zb_g_state"


def _back_to_login(reason: str) -> RedirectResponse:
    response = RedirectResponse(f"/login?google={reason}", status_code=status.HTTP_303_SEE_OTHER)
    response.delete_cookie(_STATE_COOKIE, path="/api/auth/google")
    return response


@router.get("/google/start")
def google_start():
    if not settings.google_enabled:
        raise HTTPException(status_code=404, detail="Google sign-in is not set up.")
    state = secrets.token_urlsafe(32)
    response = RedirectResponse(google_service.authorization_url(state), status_code=status.HTTP_303_SEE_OTHER)
    # The state comes back from Google and must match this cookie: nobody else can start a sign-in for this browser
    response.set_cookie(_STATE_COOKIE, state, max_age=600, httponly=True, samesite="lax",
                        secure=settings.public_base_url.startswith("https://"), path="/api/auth/google")
    return response


@router.get("/google/callback")
def google_callback(
    code: Optional[str] = None,
    state: Optional[str] = None,
    error: Optional[str] = None,
    saved_state: Optional[str] = Cookie(default=None, alias=_STATE_COOKIE),
    db: Session = Depends(get_db),
):
    if not settings.google_enabled:
        raise HTTPException(status_code=404, detail="Google sign-in is not set up.")
    if error or not code:
        return _back_to_login("cancelled")
    if not state or not saved_state or not secrets.compare_digest(state, saved_state):
        return _back_to_login("failed")
    try:
        identity = google_service.exchange_code(code)
    except google_service.GoogleSignInError as exc:
        logger.info("Google sign-in refused: %s", exc)
        return _back_to_login("failed")

    user = db.query(User).filter(User.google_sub == identity.sub).first()
    if user is None:
        user = db.query(User).filter(User.email == identity.email).first()
        if user is not None:
            if user.email_verified_at is None:
                # This address was registered with a password but never confirmed. Google has now proven
                # who owns it, so whatever password was typed by whoever registered it stops working.
                user.hashed_password = unusable_password()
                user.email_verified_at = datetime.now(timezone.utc)
            user.google_sub = identity.sub
            db.commit()
    if user is None:
        if not settings.ALLOW_SIGNUP:
            return _back_to_login("no-account")
        workspace = (identity.name or identity.email.split("@")[0]).strip()[:255]
        _, user = create_tenant_with_owner(
            name=workspace if len(workspace) >= 2 else "My workspace", plan=settings.DEFAULT_SIGNUP_PLAN,
            owner_email=identity.email, owner_password=secrets.token_urlsafe(32), db=db, verified=True,
        )
        user.hashed_password = unusable_password()
        user.google_sub = identity.sub
        db.commit()

    if not user.is_active or (not user.is_superadmin and (user.tenant is None or not user.tenant.is_active)):
        return _back_to_login("suspended")
    # In the URL fragment: never sent to a server, never written to an access log
    token = create_access_token(str(user.id), user.hashed_password)
    response = RedirectResponse(f"/auth/callback#token={token}", status_code=status.HTTP_303_SEE_OTHER)
    response.delete_cookie(_STATE_COOKIE, path="/api/auth/google")
    return response


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
    return UserInfo(id=str(user.id), email=user.email, role=user.role, tenant=summary,
                    has_password=has_usable_password(user.hashed_password), google_linked=bool(user.google_sub))


@router.post("/change-credentials")
def change_credentials(
    body: ChangeCredentialsRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    # A login that has only ever used Google has no password to confirm; it is setting its first one
    if has_usable_password(user.hashed_password) and not verify_password(body.current_password or "", user.hashed_password):
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
