import hmac
import uuid

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.models.client import Client
from app.models.user import User
from app.services.auth_service import decode_token, password_fingerprint

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> User:
    exc = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = decode_token(token)
        user_id = uuid.UUID(payload["sub"])
    except Exception:
        raise exc

    user = db.query(User).filter(User.id == user_id).first()
    if not user or not user.is_active:
        raise exc
    # Tokens issued before the last password change are dead
    if not hmac.compare_digest(str(payload.get("pwd", "")), password_fingerprint(user.hashed_password)):
        raise exc
    # A suspended tenant locks out all of its users
    if not user.is_superadmin and (user.tenant is None or not user.tenant.is_active):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="This account is suspended.")
    return user


def require_superadmin(user: User = Depends(get_current_user)) -> User:
    if not user.is_superadmin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Super admin only")
    return user


def get_owned_client(
    client_uuid: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Client:
    """The bot in the URL, but only if the caller may touch it. Every tenant-scoped route goes
    through here. Another tenant's bot answers 404, not 403, so ids cannot be probed."""
    query = db.query(Client).filter(Client.id == client_uuid)
    if not user.is_superadmin:
        query = query.filter(Client.tenant_id == user.tenant_id)
    client = query.first()
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    return client
