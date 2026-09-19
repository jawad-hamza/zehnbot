#!/usr/bin/env bash
# Deploy one ZehnBot release on the VPS. Run by GitHub Actions, by the rollback script, or by hand:
#
#   /opt/zehnbot/releases/<release>/deploy.sh <release>        <release> = the git commit the images are tagged with
#
# The release that is serving is never stopped until its replacement has already proven itself, and
# visitors are never cut off:
#
#   1. images here, this release's edge configuration accepted by nginx -t     production untouched
#   2. back up the database                                                    production untouched
#   3. start the new release in the CANDIDATE slot and check it end to end
#        fails -> the candidate is removed; production never noticed. Exit 1.
#   4. switch production to the new release: the edge first prefers the candidate (same new release),
#      production is drained and restarted, checked on its own, and preferred again.
#        fails -> production is switched back to the release it was on (images still here). Exit 1.
#   5. the edge takes this release's configuration (graceful reload), and the whole path through it is checked
#   6. record current + previous, remove the candidate, delete anything older than those two
#
# Migrations run when an API container starts, so step 3 applies them while the old release still serves.
# They must be additive (add; never rename or drop in the same release as the code that stops using the
# old shape). An older release starts on a newer schema without migrating (see backend/scripts/migrate.py).
# The backup from step 2 is the way back from a migration that went wrong.
set -Eeuo pipefail
# never exit silently: name the line that failed
trap 'printf "%s  ERROR: deploy.sh stopped at line %s: %s\n" "$(date -u +%H:%M:%SZ)" "$LINENO" "$BASH_COMMAND" >&2' ERR

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${ZEHNBOT_ROOT:-/opt/zehnbot}"
ENV_FILE="$ROOT/.env"
NEW="${1:?usage: deploy.sh <release>}"
NEW_DIR="$ROOT/releases/$NEW"
export ZEHNBOT_ENV_FILE="$ENV_FILE"
KEEP_BACKUPS="${ZEHNBOT_KEEP_BACKUPS:-10}"
# shellcheck source=lib.sh
. "$HERE/lib.sh"

[[ "$NEW" =~ ^[0-9a-f]{7,40}$ ]] || die "a release is a git commit id, got '$NEW'"
[[ -f "$NEW_DIR/compose.yaml" && -f "$NEW_DIR/edge/zehnbot-edge.conf" ]] || die "$NEW_DIR is incomplete (the workflow uploads compose.yaml and edge/ there)"
[[ -f "$ENV_FILE" ]] || die "$ENV_FILE is missing: create it from env.production.example (DEPLOYMENT.md, first deployment)"
[[ "$(stat -c %a "$ENV_FILE")" == "600" ]] || die "$ENV_FILE must be readable by its owner only: chmod 600 $ENV_FILE"
take_lock

REGISTRY="$(env_value ZEHNBOT_REGISTRY)"
[[ -n "$REGISTRY" ]] || die "set ZEHNBOT_REGISTRY in $ENV_FILE (ghcr.io/jawad-hamza)"

CURRENT="$(release_of current)"
PREVIOUS="$(release_of previous)"
# Production is always addressed with the release that is SERVING, the candidate with the new one.
# (Two separate names on purpose: in  A=x B=$A cmd  bash hands cmd the NEW value of A.)
SERVING="${CURRENT:-$NEW}"
log "deploying $NEW (serving now: ${CURRENT:-nothing}, kept for rollback: ${PREVIOUS:-nothing})"

candidate() { RELEASE="$SERVING" CANDIDATE_RELEASE="$NEW" compose "$NEW_DIR/compose.yaml" --profile candidate "$@"; }
# The edge prefers production again (whatever happened), then the candidate's web container stops
# gracefully (it finishes what it is serving), then the API behind it goes.
remove_candidate() {
  edge_route production >/dev/null 2>&1 || true
  candidate stop -t 130 admin-candidate >/dev/null 2>&1 || true
  candidate rm -sf backend-candidate admin-candidate >/dev/null 2>&1 || true
}
trap remove_candidate EXIT

# ---- 1. images and edge configuration ---------------------------------------------------------------
for image in "zehnbot-backend:$NEW" "zehnbot-admin:$NEW" "zehnbot-db:pg16"; do
  have_image "$REGISTRY/$image" || die "cannot pull $REGISTRY/$image. Nothing was changed."
done
for image in redis:7-alpine nginx:1.30-alpine; do
  have_image "$image" || die "cannot pull $image. Nothing was changed."
done
edge_check_config "$NEW_DIR/edge" || die "nginx rejects this release's edge configuration (above). Nothing was changed."
log "images ready, edge configuration valid"

# ---- database and cache: created on the first deploy, never recreated by a later one ----------------
RELEASE="$SERVING" CANDIDATE_RELEASE="$NEW" compose "$NEW_DIR/compose.yaml" up -d --no-recreate db redis >/dev/null 2>&1
wait_healthy zehnbot-db-1 120 || die "the database is not healthy. Nothing was changed."

# ---- 2. backup, before the new release runs its migrations ------------------------------------------
if [[ -n "$CURRENT" ]]; then
  mkdir -p "$ROOT/backups"
  BACKUP="$ROOT/backups/pre-$NEW-$(date -u +%Y%m%dT%H%M%SZ).sql.gz"
  if ! ( umask 077; docker exec zehnbot-db-1 pg_dump -U chatbot chatbotdb | gzip > "$BACKUP.part" ); then
    rm -f "$BACKUP.part"; die "database backup failed. Nothing was changed."
  fi
  mv "$BACKUP.part" "$BACKUP"
  log "database backed up: $BACKUP ($(du -h "$BACKUP" | cut -f1))"
  find "$ROOT/backups" -maxdepth 1 -name 'pre-*.sql.gz' -printf '%T@ %p\n' | sort -rn | tail -n +$((KEEP_BACKUPS + 1)) | cut -d' ' -f2- | xargs -r rm -f
fi

# ---- 3. candidate ------------------------------------------------------------------------------------
log "starting $NEW in the candidate slot"
if ! { candidate up -d --no-deps backend-candidate >/dev/null 2>&1 &&
       wait_healthy zehnbot-backend-candidate-1 180 &&
       candidate up -d --no-deps admin-candidate >/dev/null 2>&1 &&
       wait_healthy zehnbot-admin-candidate-1 60 &&
       "$HERE/healthcheck.sh" "$CANDIDATE_URL" 60; }; then
  diagnose zehnbot-backend-candidate-1 zehnbot-admin-candidate-1
  die "release $NEW failed its checks in the candidate slot. Production was not touched (still serving ${CURRENT:-nothing})."
fi
[[ "$(docker inspect -f '{{.Config.Image}}' zehnbot-backend-candidate-1)" == "$REGISTRY/zehnbot-backend:$NEW" ]] \
  || die "the candidate is not running $NEW. Production was not touched."
log "candidate $NEW is healthy"

# ---- 4. production -----------------------------------------------------------------------------------
log "switching production to $NEW; visitors are served by the candidate meanwhile"
if ! switch_production "$NEW"; then
  log "production did not come up healthy on $NEW:"
  diagnose zehnbot-backend-1 zehnbot-admin-1
  [[ -n "$CURRENT" ]] || die "first deploy failed: nothing is serving."
  log "restoring $CURRENT"
  switch_production "$CURRENT" && die "deploy of $NEW failed. Production is back on $CURRENT and healthy."
  die "deploy of $NEW failed AND $CURRENT did not come back healthy. See DEPLOYMENT.md, 'Recovery'."
fi

# ---- 5. edge -----------------------------------------------------------------------------------------
edge_install_config "$NEW_DIR/edge" \
  || die "$NEW is serving, but the edge would not take its new configuration; it keeps the previous one."
if ! ensure_edge "$NEW" || ! "$HERE/healthcheck.sh" "$EDGE_URL" 60; then
  diagnose zehnbot-edge-1
  die "$NEW is serving on 127.0.0.1:${ZEHNBOT_DIRECT_PORT:-3003}, but the edge on 127.0.0.1:${ZEHNBOT_PORT:-3001} is not healthy. See DEPLOYMENT.md, 'Recovery'."
fi

# ---- 6. record and tidy ------------------------------------------------------------------------------
if [[ -n "$CURRENT" && "$CURRENT" != "$NEW" ]]; then
  ln -sfn "$ROOT/releases/$CURRENT" "$ROOT/previous"
  PREVIOUS="$CURRENT"
fi
ln -sfn "$NEW_DIR" "$ROOT/current"
printf '%s  deployed %s  previous %s\n' "$(date -u +%FT%TZ)" "$NEW" "${PREVIOUS:-none}" >> "$ROOT/deploy.log"
remove_candidate

KEEP=" $NEW ${PREVIOUS:-} "
for repo in zehnbot-backend zehnbot-admin; do
  docker images --format '{{.Tag}}' "$REGISTRY/$repo" | while read -r tag; do
    [[ "$KEEP" == *" $tag "* ]] || docker rmi "$REGISTRY/$repo:$tag" >/dev/null 2>&1 || true
  done
done
for dir in "$ROOT"/releases/*/; do
  [[ -d "$dir" ]] || continue
  [[ "$KEEP" == *" $(basename "$dir") "* ]] || rm -rf "$dir"
done

log "done. Serving $NEW; kept for rollback: ${PREVIOUS:-nothing}"
