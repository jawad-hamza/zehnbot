from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from app.dependencies import get_db, get_current_admin
from app.models.admin import Admin
from app.schemas.auth import LoginRequest, TokenResponse, ChangeCredentialsRequest, AdminInfo
from app.services.auth_service import verify_password, create_access_token, hash_password

router = APIRouter()


@router.post("/login", response_model=TokenResponse)
def login(body: LoginRequest, db: Session = Depends(get_db)):
    admin = db.query(Admin).filter(Admin.email == body.email).first()
    if not admin or not verify_password(body.password, admin.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )
    token = create_access_token({"sub": str(admin.id)})
    return TokenResponse(access_token=token)


@router.get("/me", response_model=AdminInfo)
def me(admin: Admin = Depends(get_current_admin)):
    return AdminInfo(id=str(admin.id), email=admin.email)


@router.post("/change-credentials")
def change_credentials(
    body: ChangeCredentialsRequest,
    admin: Admin = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    if not verify_password(body.current_password, admin.hashed_password):
        raise HTTPException(status_code=401, detail="Current password is incorrect")

    if body.new_email and body.new_email != admin.email:
        taken = db.query(Admin).filter(Admin.email == body.new_email, Admin.id != admin.id).first()
        if taken:
            raise HTTPException(status_code=409, detail="Username already in use")
        admin.email = body.new_email

    if body.new_password:
        if len(body.new_password) < 4:
            raise HTTPException(status_code=400, detail="New password too short")
        admin.hashed_password = hash_password(body.new_password)

    db.commit()
    return {"success": True, "email": admin.email}
