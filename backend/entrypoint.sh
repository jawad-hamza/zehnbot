#!/bin/sh
set -e

echo "[entrypoint] Creating database tables if missing..."
python -c "from app.database import Base, engine; import app.models; Base.metadata.create_all(engine)"

echo "[entrypoint] Seeding admin user if missing..."
python scripts/seed_admin.py

echo "[entrypoint] Starting uvicorn..."
exec uvicorn app.main:app --host 0.0.0.0 --port 8000
