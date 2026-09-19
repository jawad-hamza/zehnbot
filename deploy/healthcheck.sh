#!/bin/sh
# Is a ZehnBot slot really serving? Used by the deploy script, the CI smoke test and by hand:
#
#   healthcheck.sh http://127.0.0.1:3001 [seconds-to-keep-trying]
#
# It checks the whole path a visitor takes (nginx -> API -> database), not just "a port is open":
#   /nginx-health          the web server is up
#   /api/health/ready      the API is up AND the database answers
#   /api/auth/config       a real API route returns real JSON
#   /static/widget.js      the chat widget bundle customers embed is being served
#   /login                 the dashboard is being served
set -u
BASE="${1:?usage: healthcheck.sh <base-url> [timeout-seconds]}"
TIMEOUT="${2:-90}"
DEADLINE=$(( $(date +%s) + TIMEOUT ))

check() {   # check <path> <text the body must contain>
  body=$(curl -fsS -m 8 "$BASE$1" 2>/dev/null) || return 1
  case "$body" in *"$2"*) return 0 ;; *) return 1 ;; esac
}

all_ok() {
  check /nginx-health "" &&
  check /api/health/ready '"ready"' &&
  check /api/auth/config '"allow_signup"' &&
  check /static/widget.js "cb-widget-root" &&
  check /login "<div id=\"root\">"
}

while :; do
  if all_ok; then
    echo "healthy: $BASE"
    exit 0
  fi
  if [ "$(date +%s)" -ge "$DEADLINE" ]; then
    echo "NOT healthy after ${TIMEOUT}s: $BASE" >&2
    for path in /nginx-health /api/health/ready /api/auth/config /static/widget.js /login; do
      printf '  %-22s HTTP %s\n' "$path" "$(curl -s -o /dev/null -m 8 -w '%{http_code}' "$BASE$path" 2>/dev/null || echo '---')" >&2
    done
    exit 1
  fi
  sleep 3
done
