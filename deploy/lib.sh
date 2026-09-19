# shellcheck shell=bash
# Shared by deploy.sh (and the drill). Sourced, not run. Expects ROOT, ENV_FILE, HERE and REGISTRY.

log() { printf '%s  %s\n' "$(date -u +%H:%M:%SZ)" "$*"; }
die() { log "ERROR: $*" >&2; exit 1; }

# .env is read as data, never executed (SMTP_FROM=ZehnBot <no-reply@...> is not valid shell)
env_value() { grep -E "^$1=" "$ENV_FILE" | tail -1 | cut -d= -f2- | tr -d "\"' \r"; }

compose() { docker compose -p zehnbot --project-directory "$ROOT" --env-file "$ENV_FILE" -f "$@"; }

release_of() { [[ -L "$ROOT/$1" ]] && basename "$(readlink -f "$ROOT/$1")" || true; }

take_lock() {   # one deploy or rollback at a time on this server, whoever started it
  exec 9>"$ROOT/deploy.lock"
  flock -n 9 || die "another deploy or rollback is running (lock: $ROOT/deploy.lock)"
}

have_image() { docker image inspect "$1" >/dev/null 2>&1 || docker pull -q "$1" >/dev/null 2>&1; }

HEALTH_HOST="${ZEHNBOT_HEALTH_HOST:-127.0.0.1}"
EDGE_URL="http://$HEALTH_HOST:${ZEHNBOT_PORT:-3001}"
PRODUCTION_URL="http://$HEALTH_HOST:${ZEHNBOT_DIRECT_PORT:-3003}"
CANDIDATE_URL="http://$HEALTH_HOST:${ZEHNBOT_CANDIDATE_PORT:-3002}"

# diagnose <container>...: what a failed check needs, printed before the container is cleaned away
diagnose() {
  local c
  for c in "$@"; do
    docker inspect "$c" >/dev/null 2>&1 || continue
    log "$c: $(docker inspect -f '{{.State.Status}}, exit {{.State.ExitCode}}, restarts {{.RestartCount}}, health {{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$c")"
    docker inspect -f '{{if .State.Health}}{{range .State.Health.Log}}    check exit {{.ExitCode}}: {{.Output}}{{"\n"}}{{end}}{{end}}' "$c" | grep -v '^\s*$' | tail -3 || true
    docker logs --tail 25 "$c" 2>&1 | sed 's/^/    /' || true
  done
}

# wait_healthy <container> <seconds>. Uses Docker's own health check (the API's asks the database), and
# gives up at once on a container that exited, is restarting, or has already restarted: a release that
# crashes on start is reported in seconds, not after the whole timeout.
wait_healthy() {
  local deadline=$(( $(date +%s) + $2 )) run restarts health
  while :; do
    read -r run restarts health < <(docker inspect -f '{{.State.Status}} {{.RestartCount}} {{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$1" 2>/dev/null || echo "missing 0 none")
    [[ "$health" == healthy ]] && return 0
    if [[ "$run" =~ ^(exited|dead|restarting|missing)$ || "$restarts" -gt 0 || "$health" == unhealthy ]] || (( $(date +%s) >= deadline )); then
      log "$1: state=$run restarts=$restarts health=$health"
      return 1
    fi
    sleep 2
  done
}

# ---- the edge: stock nginx, configured by the files in $ROOT/edge (mounted read-only into it) ----------
EDGE_DIR="$ROOT/edge"

edge_running() { [[ "$(docker inspect -f '{{.State.Running}}' zehnbot-edge-1 2>/dev/null)" == true ]]; }

# edge_reload: nginx -t first; a graceful reload only if the configuration is valid. A graceful reload
# never drops a connection: new requests follow the new configuration, those under way finish as they were.
edge_reload() {
  edge_running || return 0
  docker exec zehnbot-edge-1 nginx -t -q && docker exec zehnbot-edge-1 nginx -s reload >/dev/null && sleep 2
}

upstream_file() {   # upstream_file <preferred> <fallback>
  printf 'upstream zehnbot_web {\n    zone zehnbot_web 64k;\n    server %s:80 resolve max_fails=0;\n    server %s:80 resolve backup max_fails=0;\n}\n' "$1" "$2"
}

# edge_route candidate|production: which web container the edge prefers (the other one is its fallback)
edge_route() {
  local first=admin second=admin-candidate
  if [[ "$1" == candidate ]]; then first=admin-candidate; second=admin; fi
  [[ -d "$EDGE_DIR" ]] || return 0                                   # the first deploy: no edge yet
  cp "$EDGE_DIR/zehnbot-upstream.inc" "$EDGE_DIR/.upstream.previous" 2>/dev/null || true
  upstream_file "$first" "$second" > "$EDGE_DIR/.upstream.new" && mv "$EDGE_DIR/.upstream.new" "$EDGE_DIR/zehnbot-upstream.inc"
  edge_reload || { mv "$EDGE_DIR/.upstream.previous" "$EDGE_DIR/zehnbot-upstream.inc"; edge_reload || true; return 1; }
}

# edge_check_config <dir>: would nginx accept this edge configuration? Checked in a throwaway container,
# before anything is changed.
edge_check_config() {
  local tmp; tmp="$(mktemp -d)"
  cp "$1"/* "$tmp/"; upstream_file admin admin-candidate > "$tmp/zehnbot-upstream.inc"
  local cid; cid="$(docker create nginx:1.30-alpine nginx -t)"
  docker cp "$tmp/." "$cid:/etc/nginx/conf.d/" >/dev/null
  local out; out="$(docker start -a "$cid" 2>&1)"; local rc=$?
  docker rm "$cid" >/dev/null; rm -rf "$tmp"
  [[ "$out" == *"test is successful"* ]] || { printf '%s\n' "$out" | sed 's/^/    /'; return 1; }
  return "$rc"
}

# edge_install_config <dir>: this release's edge configuration into $EDGE_DIR, and nginx reloaded if it
# changed. The routing file is kept as it is (the deploy manages it).
edge_install_config() {
  local src="$1" f changed=0
  mkdir -p "$EDGE_DIR/.previous"
  [[ -f "$EDGE_DIR/zehnbot-upstream.inc" ]] || upstream_file admin admin-candidate > "$EDGE_DIR/zehnbot-upstream.inc"
  for f in zehnbot-edge.conf zehnbot-edge-proxy.inc; do cmp -s "$src/$f" "$EDGE_DIR/$f" || changed=1; done
  (( changed )) || return 0
  for f in zehnbot-edge.conf zehnbot-edge-proxy.inc; do [[ -f "$EDGE_DIR/$f" ]] && cp "$EDGE_DIR/$f" "$EDGE_DIR/.previous/$f"; done
  for f in zehnbot-edge.conf zehnbot-edge-proxy.inc; do cp "$src/$f" "$EDGE_DIR/.$f.new" && mv "$EDGE_DIR/.$f.new" "$EDGE_DIR/$f"; done
  log "edge configuration updated"
  edge_reload && return 0
  for f in zehnbot-edge.conf zehnbot-edge-proxy.inc; do [[ -f "$EDGE_DIR/.previous/$f" ]] && cp "$EDGE_DIR/.previous/$f" "$EDGE_DIR/$f"; done
  edge_reload || true
  return 1
}

# ensure_edge <release>: the edge container running (created on the first deploy, replaced only when the
# nginx version in compose.yaml changes), and healthy.
ensure_edge() {
  local release="$1" want
  want="$(sed -n '/^  edge:/,/^  [a-z]/s/^ *image: *//p' "$ROOT/releases/$release/compose.yaml" | head -1)"
  if edge_running && [[ "$(docker inspect -f '{{.Config.Image}}' zehnbot-edge-1)" == "$want" ]]; then return 0; fi
  RELEASE="$release" CANDIDATE_RELEASE="$release" compose "$ROOT/releases/$release/compose.yaml" up -d --no-deps edge >/dev/null 2>&1 &&
  wait_healthy zehnbot-edge-1 60
}

# switch_production <release>: put production on <release>, using that release's own compose file.
#   1. the edge prefers the candidate (already running the new release), so no new visitor reaches production
#   2. production's web container is stopped gracefully: it finishes what it is serving (up to 130s, the
#      longest a request can take) and stops. Nothing new arrives meanwhile, so nothing is cut off.
#   3. the API (migrations run here), then the web container once the API is healthy
#   4. production is checked on its own direct port, then the edge prefers it again
switch_production() {
  local target="$1" file="$ROOT/releases/$1/compose.yaml"
  edge_route candidate || log "warning: could not point the edge at the candidate"
  docker stop -t 130 zehnbot-admin-1 >/dev/null 2>&1 || true
  RELEASE="$target" CANDIDATE_RELEASE="$target" compose "$file" up -d --no-deps backend >/dev/null 2>&1 &&
  wait_healthy zehnbot-backend-1 180 &&
  RELEASE="$target" CANDIDATE_RELEASE="$target" compose "$file" up -d --no-deps admin >/dev/null 2>&1 &&
  wait_healthy zehnbot-admin-1 60 &&
  "$HERE/healthcheck.sh" "$PRODUCTION_URL" 60 &&
  edge_route production
}
