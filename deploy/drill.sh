#!/usr/bin/env bash
# Rehearses whole release cycles with the real scripts, the real images and the production compose file,
# in a throwaway directory, with a stand-in for the server's nginx and a stream of visitors (GET and POST)
# going through it:
#
#   1 first deploy  2 deploy (visitors)  3 broken release: refused, production untouched
#   4 release that fails only in production: undone (visitors)  5 rollback onto a newer schema (visitors)
#   6 a change of the edge's configuration (visitors); a broken one is refused  7 the data is all still there
#
# CI runs it on every push, before any image is published or deployed.
#
#   drill.sh <registry-prefix> <release>        (images already built and tagged)
#
# Env: DRILL_ROOT (/tmp/zehnbot-drill); ZEHNBOT_PORT / _CANDIDATE_PORT / _DIRECT_PORT (3001/3002/3003);
#      ZEHNBOT_HEALTH_HOST (127.0.0.1); DRILL_FRONT_PORT (3903); DRILL_FRONT_NETWORK=host|bridge;
#      DRILL_KEEP=1 leaves everything running.
set -Eeuo pipefail
trap 'printf "  FAIL  drill.sh stopped at line %s: %s\n" "$LINENO" "$BASH_COMMAND" >&2' ERR

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REGISTRY="${1:?usage: drill.sh <registry-prefix> <release>}"
A="${2:?usage: drill.sh <registry-prefix> <release>}"
B="bbbbbbbbbbbb"; BAD="dddddddddddd"; LATE="eeeeeeeeeeee"; C="cccccccccccc"; BADEDGE="ffffffffffff"
export ZEHNBOT_ROOT="${DRILL_ROOT:-/tmp/zehnbot-drill}"
export ZEHNBOT_PORT="${ZEHNBOT_PORT:-3001}" ZEHNBOT_CANDIDATE_PORT="${ZEHNBOT_CANDIDATE_PORT:-3002}" ZEHNBOT_DIRECT_PORT="${ZEHNBOT_DIRECT_PORT:-3003}"
HEALTH_HOST="${ZEHNBOT_HEALTH_HOST:-127.0.0.1}"
ROOT="$ZEHNBOT_ROOT"
export ZEHNBOT_ENV_FILE="$ROOT/.env"
FRONT_PORT="${DRILL_FRONT_PORT:-3903}"
PASS=0

say()  { printf '\n\033[1m== %s\033[0m\n' "$*"; }
ok()   { printf '  PASS  %s\n' "$*"; PASS=$((PASS + 1)); }
fail() { printf '  FAIL  %s\n' "$*" >&2; exit 1; }
serving() { basename "$(readlink -f "$ROOT/current")"; }
previous() { basename "$(readlink -f "$ROOT/previous")"; }
running_tag() { docker inspect -f '{{.Config.Image}}' "zehnbot-$1-1" | sed 's/.*://'; }
healthy_edge() { "$HERE/healthcheck.sh" "http://$HEALTH_HOST:$ZEHNBOT_PORT" 10 >/dev/null; }
psql_db() { docker exec zehnbot-db-1 psql -At -U chatbot chatbotdb -c "$1"; }
ids() { docker inspect -f '{{.Id}}' zehnbot-backend-1 zehnbot-admin-1 zehnbot-edge-1 | tr '\n' ' '; }

cleanup() {
  rm -f "$ROOT/visiting" 2>/dev/null || true
  [[ "${DRILL_KEEP:-}" == 1 ]] && return
  docker rm -f zehnbot-drill-front >/dev/null 2>&1 || true
  RELEASE=x CANDIDATE_RELEASE=x docker compose -p zehnbot --project-directory "$ROOT" --env-file "$ROOT/.env" \
    -f "$HERE/compose.prod.yaml" --profile candidate down -v --remove-orphans >/dev/null 2>&1 || true
  for r in "$B" "$BAD" "$LATE" "$C" "$BADEDGE"; do docker rmi "$REGISTRY/zehnbot-backend:$r" "$REGISTRY/zehnbot-admin:$r" >/dev/null 2>&1 || true; done
  find "$ROOT" -mindepth 1 -delete 2>/dev/null || true      # (the directory itself may be a mount point)
}
trap cleanup EXIT

variant() {   # variant <release> [Dockerfile CMD]: release A under another id, optionally with another start command.
  # docker commit, not docker build: in CI the images live only in the local image store, which a
  # separate BuildKit builder could not see.
  local cid
  if [[ -n "${2:-}" ]]; then
    cid="$(docker create "$REGISTRY/zehnbot-backend:$A")"
    docker commit --change "$2" "$cid" "$REGISTRY/zehnbot-backend:$1" >/dev/null
    docker rm "$cid" >/dev/null
  else
    docker tag "$REGISTRY/zehnbot-backend:$A" "$REGISTRY/zehnbot-backend:$1"
  fi
  docker tag "$REGISTRY/zehnbot-admin:$A" "$REGISTRY/zehnbot-admin:$1"
}

stage() {   # stage <release> [edge folder]: exactly what the workflow uploads to the server for a release
  mkdir -p "$ROOT/releases/$1/edge"
  cp "$HERE/compose.prod.yaml" "$ROOT/releases/$1/compose.yaml"
  cp "$HERE/deploy.sh" "$HERE/rollback.sh" "$HERE/healthcheck.sh" "$HERE/lib.sh" "$ROOT/releases/$1/"
  cp "${2:-$HERE/edge}"/* "$ROOT/releases/$1/edge/"
  chmod +x "$ROOT/releases/$1/"*.sh
}

# ---- a stand-in for the server's nginx (the real proxy snippet), and visitors going through it ----------
front_start() {
  local up net=()
  if [[ "${DRILL_FRONT_NETWORK:-host}" == host ]]; then      # Linux: the published ports are on this host's loopback
    up=127.0.0.1; net=(--network host); FRONT_URL="http://127.0.0.1:$FRONT_PORT"
  else                                                       # Docker Desktop: reach the host as one literal IPv4 address
    up="$(getent ahostsv4 host.docker.internal | awk 'NR==1{print $1}')"
    [[ -n "$up" ]] || fail "cannot resolve host.docker.internal to an IPv4 address"
    net=(-p "127.0.0.1:$FRONT_PORT:$FRONT_PORT"); FRONT_URL="http://$HEALTH_HOST:$FRONT_PORT"
  fi
  cat > "$ROOT/front.conf" <<EOF
server {
    listen $FRONT_PORT;
    location / { proxy_pass http://$up:$ZEHNBOT_PORT; include /etc/nginx/zehnbot-proxy.conf; }
}
EOF
  docker rm -f zehnbot-drill-front >/dev/null 2>&1 || true
  docker create --name zehnbot-drill-front "${net[@]}" "$REGISTRY/zehnbot-admin:$A" >/dev/null   # an nginx image already here
  docker cp "$ROOT/front.conf" zehnbot-drill-front:/etc/nginx/conf.d/default.conf
  docker cp "$HERE/nginx/zehnbot-proxy.conf" zehnbot-drill-front:/etc/nginx/zehnbot-proxy.conf
  docker start zehnbot-drill-front >/dev/null
  for _ in $(seq 1 30); do curl -fsS -m 3 -o /dev/null "$FRONT_URL/api/auth/config" && return 0; sleep 1; done
  fail "the stand-in nginx did not start"
}

visitors_start() {   # a GET and a POST, back to back, until visitors_stop
  : > "$ROOT/visits"; touch "$ROOT/visiting"
  ( while [[ -f "$ROOT/visiting" ]]; do
      printf '%s %s GET\n' "$(date -u +%T)" "$(curl -s -o /dev/null -m 20 -w '%{http_code}' "$FRONT_URL/api/auth/config")" >> "$ROOT/visits"
      printf '%s %s POST\n' "$(date -u +%T)" "$(curl -s -o /dev/null -m 20 -w '%{http_code}' -X POST -H 'Content-Type: application/json' \
        -d '{"email":"visitor@example.com","password":"not-the-password"}' "$FRONT_URL/api/auth/login")" >> "$ROOT/visits"
    done ) &
  VISITORS=$!
}

visitors_stop() {   # visitors_stop <what was happening>: every answer must be a real one (200 GET, 401 POST)
  rm -f "$ROOT/visiting"; wait "$VISITORS" 2>/dev/null || true
  local total bad
  total=$(wc -l < "$ROOT/visits"); bad=$(grep -cvE ' (200 GET|401 POST)$' "$ROOT/visits" || true)
  [[ "$total" -ge 20 ]] || fail "too few requests during $1 to prove anything ($total)"
  if [[ "$bad" -eq 0 ]]; then ok "no visitor saw an error during $1 ($total requests, GET and POST)"; return; fi
  echo "  failures (first, last):"; grep -vE ' (200 GET|401 POST)$' "$ROOT/visits" | sed -n '1,4p;$p' | sed 's/^/    /'
  echo "  edge log:"; docker logs zehnbot-edge-1 2>&1 | grep -iE "\[error\]" | tail -6 | cut -c1-220 | sed 's/^/    /'
  fail "$bad of $total requests failed during $1: $(grep -vE ' (200 GET|401 POST)$' "$ROOT/visits" | cut -d' ' -f2- | sort | uniq -c | tr '\n' ' ')"
}

# ---------------------------------------------------------------------------------------------------------
say "setting up $ROOT"
mkdir -p "$ROOT"; find "$ROOT" -mindepth 1 -delete
rnd() { head -c 48 /dev/urandom | base64 | tr -d '/+=\n' | cut -c1-40; }
( umask 077; cat > "$ROOT/.env" <<EOF
ZEHNBOT_REGISTRY=$REGISTRY
DB_PASSWORD=$(rnd)
SECRET_KEY=$(rnd)
ENCRYPTION_KEY=$(head -c 32 /dev/urandom | base64 | tr '/+' '_-')
ADMIN_SEED_EMAIL=drill@example.com
ADMIN_SEED_PASSWORD=$(rnd)
PUBLIC_BASE_URL=https://bot.example.com
MARKETING_URL=https://example.com/zehnbot
ALLOW_SIGNUP=true
SMTP_FROM=ZehnBot <no-reply@example.com>
PLATFORM_AI_PROVIDER=deepseek
ENABLE_EMBEDDINGS=false
RATE_LOGIN_PER_IP_PER_5MIN=1000000
RATE_LOGIN_PER_ACCOUNT_PER_5MIN=1000000
EOF
)
# Each release is staged right before its own deploy, as the workflow does: a deploy prunes every
# release other than the current and the previous one.

say "1. first deploy of $A"
stage "$A"
"$ROOT/releases/$A/deploy.sh" "$A"
[[ "$(serving)" == "$A" && "$(running_tag backend)" == "$A" ]] && ok "serving $A" || fail "not serving $A"
healthy_edge && ok "answers end to end through the edge" || fail "unhealthy"
psql_db "INSERT INTO enquiries (id, name, email, source, status, created_at) VALUES (gen_random_uuid(), 'drill', 'drill@example.com', 'drill', 'new', now())" >/dev/null
ok "wrote a marker row"
if docker ps --format '{{.Names}} {{.Ports}}' | grep '^zehnbot-' | grep -E '0\.0\.0\.0|\[::\]|:::' ; then fail "a port is published beyond 127.0.0.1"; fi
ok "nothing is published beyond 127.0.0.1"
front_start

say "2. deploy of $B, with visitors arriving the whole time"
variant "$B"; stage "$B"
EDGE_BEFORE="$(docker inspect -f '{{.Id}}' zehnbot-edge-1)"
visitors_start
"$ROOT/releases/$B/deploy.sh" "$B"
visitors_stop "a normal deploy"
[[ "$(serving)" == "$B" && "$(running_tag backend)" == "$B" && "$(running_tag admin)" == "$B" ]] && ok "serving $B" || fail "not serving $B"
[[ "$(previous)" == "$A" ]] && ok "$A kept as previous" || fail "previous is not $A"
[[ "$(docker inspect -f '{{.Id}}' zehnbot-edge-1)" == "$EDGE_BEFORE" ]] && ok "the edge was not restarted" || fail "the edge was restarted"
[[ -z "$(docker ps -aq -f name=candidate)" ]] && ok "candidate removed" || fail "candidate left behind"
compgen -G "$ROOT/backups/pre-$B-*.sql.gz" >/dev/null && ok "database backed up before the deploy" || fail "no backup taken"

say "3. a broken release must be refused and change nothing"
variant "$BAD" 'CMD ["sh", "-c", "echo this release is broken on purpose; exit 1"]'; stage "$BAD"
BEFORE="$(ids)"
"$ROOT/releases/$BAD/deploy.sh" "$BAD" 2>&1 | tee "$ROOT/bad.log" || true
grep -q "failed its checks in the candidate slot" "$ROOT/bad.log" && ok "stopped in the candidate slot" || fail "got past the candidate slot"
[[ "$BEFORE" == "$(ids)" ]] && ok "no production container was touched" || fail "production containers were recreated"
[[ "$(serving)" == "$B" ]] && healthy_edge && ok "still serving $B, healthy" || fail "production changed"
[[ -z "$(docker ps -aq -f name=candidate)" ]] && ok "failed candidate removed" || fail "failed candidate left behind"

say "4. a release that passes the candidate but fails in production must be undone"
# starts only with one worker: true in the candidate slot, false in production (two workers)
variant "$LATE" 'CMD ["sh", "-c", "[ \"$WEB_CONCURRENCY\" = 1 ] && exec ./entrypoint.sh; echo fails in production on purpose; exit 1"]'
stage "$LATE"
visitors_start
"$ROOT/releases/$LATE/deploy.sh" "$LATE" 2>&1 | tee "$ROOT/late.log" || true
visitors_stop "a failed switch and its automatic undo"
grep -q "candidate $LATE is healthy" "$ROOT/late.log" && ok "it passed the candidate slot (as designed)" || fail "it never reached production"
grep -q "Production is back on $B and healthy" "$ROOT/late.log" && ok "production was put back on $B" || fail "production was not restored"
[[ "$(serving)" == "$B" && "$(running_tag backend)" == "$B" ]] && healthy_edge && ok "serving $B, healthy" || fail "not serving $B"
for r in "$BAD" "$LATE"; do rm -rf "$ROOT/releases/$r"; docker rmi "$REGISTRY/zehnbot-backend:$r" "$REGISTRY/zehnbot-admin:$r" >/dev/null 2>&1 || true; done

say "5. rollback, onto a database a newer release has migrated"
REAL_REVISION="$(psql_db 'SELECT version_num FROM alembic_version')"
psql_db "UPDATE alembic_version SET version_num = '0999_from_the_future'" >/dev/null
visitors_start
"$ROOT/current/rollback.sh"
visitors_stop "a rollback"
[[ "$(serving)" == "$A" && "$(running_tag backend)" == "$A" ]] && ok "rolled back to $A" || fail "rollback did not reach $A"
healthy_edge && ok "answers after the rollback" || fail "unhealthy after rollback"
[[ "$(previous)" == "$B" ]] && ok "$B kept as previous (it can be rolled forward)" || fail "previous is not $B"
# (captured first: under pipefail, "docker logs | grep -q" fails whenever grep finds its match early)
BACKEND_LOG="$(docker logs zehnbot-backend-1 2>&1)"
[[ "$BACKEND_LOG" == *"This is a rollback"* ]] && ok "the older release started on the newer schema without migrating" || fail "no rollback notice from migrate"
psql_db "UPDATE alembic_version SET version_num = '$REAL_REVISION'" >/dev/null

say "6. a change of the edge's configuration, with visitors; then a broken one"
mkdir -p "$ROOT/edge-c" && cp "$HERE/edge/"* "$ROOT/edge-c/"
printf '\n# changed by the drill\n' >> "$ROOT/edge-c/zehnbot-edge.conf"
variant "$C"; stage "$C" "$ROOT/edge-c"
EDGE_BEFORE="$(docker inspect -f '{{.Id}}' zehnbot-edge-1)"
visitors_start
"$ROOT/releases/$C/deploy.sh" "$C"
visitors_stop "an edge configuration change"
[[ "$(serving)" == "$C" ]] && healthy_edge && ok "serving $C" || fail "not serving $C"
grep -q "changed by the drill" "$ROOT/edge/zehnbot-edge.conf" && ok "the edge runs the new configuration" || fail "edge configuration not updated"
[[ "$(docker inspect -f '{{.Id}}' zehnbot-edge-1)" == "$EDGE_BEFORE" ]] && ok "applied by a reload: the edge container was not replaced" || fail "the edge container was replaced"

mkdir -p "$ROOT/edge-bad" && cp "$HERE/edge/"* "$ROOT/edge-bad/"
printf '\nthis is not nginx configuration;\n' >> "$ROOT/edge-bad/zehnbot-edge.conf"
variant "$BADEDGE"; stage "$BADEDGE" "$ROOT/edge-bad"
BEFORE="$(ids)"
"$ROOT/releases/$BADEDGE/deploy.sh" "$BADEDGE" 2>&1 | tee "$ROOT/badedge.log" || true
grep -q "nginx rejects this release's edge configuration" "$ROOT/badedge.log" && ok "a broken edge configuration is refused up front" || fail "the broken edge configuration was not refused"
[[ "$BEFORE" == "$(ids)" && "$(serving)" == "$C" ]] && ok "nothing was touched" || fail "something changed"
grep -q "changed by the drill" "$ROOT/edge/zehnbot-edge.conf" && healthy_edge && ok "the edge keeps its working configuration" || fail "edge configuration damaged"

say "7. data"
[[ "$(psql_db "SELECT count(*) FROM enquiries WHERE source='drill'")" == 1 ]] \
  && ok "the marker row survived every deploy, failure and rollback" || fail "data was lost"

printf '\n%d checks passed\n' "$PASS"
