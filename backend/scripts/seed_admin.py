"""
Creates the first super admin (the platform operator) if no super admin exists yet.

  # From the backend/ directory (local):
  python scripts/seed_admin.py

  # Inside Docker:
  docker compose exec backend python scripts/seed_admin.py
"""
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import app.models  # noqa: F401 — registers all models with Base.metadata
from app.database import SessionLocal
from app.models.user import User, ROLE_SUPERADMIN
from app.services.auth_service import hash_password, validate_new_password
from app.config import settings


def seed():
    db = SessionLocal()
    try:
        if db.query(User).filter(User.role == ROLE_SUPERADMIN).first():
            print("Super admin already exists; nothing to seed.")
            return
        if db.query(User).filter(User.email == settings.ADMIN_SEED_EMAIL).first():
            print(f"A user named {settings.ADMIN_SEED_EMAIL} exists but is not a super admin; not touching it.")
            return
        try:
            validate_new_password(settings.ADMIN_SEED_PASSWORD)
        except ValueError as e:
            if settings.is_production or settings.ADMIN_SEED_PASSWORD == "changeme":
                sys.exit(f"Refusing to create the super admin: ADMIN_SEED_PASSWORD is too weak ({e}).")
            print(f"WARNING: weak ADMIN_SEED_PASSWORD ({e}). Fine for local development only.")
        db.add(User(
            email=settings.ADMIN_SEED_EMAIL,
            hashed_password=hash_password(settings.ADMIN_SEED_PASSWORD),
            role=ROLE_SUPERADMIN,
        ))
        db.commit()
        print(f"Super admin created: {settings.ADMIN_SEED_EMAIL}")
    finally:
        db.close()


if __name__ == "__main__":
    seed()
