#!/bin/sh
set -e

echo "[entrypoint] Applying database migrations..."
python scripts/migrate.py

echo "[entrypoint] Seeding super admin if missing..."
python scripts/seed_admin.py

echo "[entrypoint] Starting uvicorn with ${WEB_CONCURRENCY:-2} worker(s)..."
# --proxy-headers: trust X-Forwarded-* from nginx so rate limits see the real visitor address.
# The backend port is never published to the internet, only nginx can reach it.
exec uvicorn app.main:app \
  --host 0.0.0.0 --port 8000 \
  --workers "${WEB_CONCURRENCY:-2}" \
  --proxy-headers --forwarded-allow-ips="*" \
  --no-server-header --no-access-log
