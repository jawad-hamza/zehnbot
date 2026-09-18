#!/bin/sh
# Dump the database to ./backups and keep the newest 14 dumps.
#
#   ./scripts/backup.sh
#
# Nightly at 03:00 via cron:
#   0 3 * * * cd /path/to/chatbot && ./scripts/backup.sh >> backups/backup.log 2>&1
#
# Restore:
#   gunzip -c backups/chatbotdb-YYYYmmdd-HHMMSS.sql.gz | docker compose exec -T db psql -U chatbot -d chatbotdb
#
# The dump contains customer conversations and leads: store copies somewhere safe and OFF this
# server. Also keep a copy of ENCRYPTION_KEY from .env; stored AI keys are useless without it.
set -eu

cd "$(dirname "$0")/.."
mkdir -p backups
out="backups/chatbotdb-$(date +%Y%m%d-%H%M%S).sql.gz"

docker compose exec -T db pg_dump -U chatbot -d chatbotdb --no-owner | gzip > "$out"

# an empty or truncated dump must not silently pass for a backup
if [ "$(gzip -dc "$out" | head -c 200 | wc -c)" -lt 200 ]; then
  echo "Backup FAILED: $out is empty" >&2
  rm -f "$out"
  exit 1
fi

ls -1t backups/chatbotdb-*.sql.gz | tail -n +15 | xargs -r rm -f
echo "Backup written: $out"
