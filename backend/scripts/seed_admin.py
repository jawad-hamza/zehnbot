"""
Creates the initial admin user. Run once.

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
from app.models.admin import Admin
from app.services.auth_service import hash_password
from app.config import settings


def seed():
    db = SessionLocal()
    try:
        if db.query(Admin).filter(Admin.email == settings.ADMIN_SEED_EMAIL).first():
            print(f"Admin already exists: {settings.ADMIN_SEED_EMAIL}")
            return
        admin = Admin(
            email=settings.ADMIN_SEED_EMAIL,
            hashed_password=hash_password(settings.ADMIN_SEED_PASSWORD),
        )
        db.add(admin)
        db.commit()
        print(f"Admin created: {settings.ADMIN_SEED_EMAIL}")
    finally:
        db.close()


if __name__ == "__main__":
    seed()
