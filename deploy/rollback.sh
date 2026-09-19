#!/usr/bin/env bash
# Put production back on an earlier release. Run by the "Rollback" GitHub workflow, or by hand:
#
#   /opt/zehnbot/current/rollback.sh              back to the previous release
#   /opt/zehnbot/current/rollback.sh <release>    to any release still in /opt/zehnbot/releases/
#
# A rollback IS a deploy of an older release, with exactly the same safety: the target is started in the
# candidate slot and checked first, visitors are never cut off, and if the target does not come up healthy
# production stays where it is. Its images are already on this server, so nothing needs downloading.
#
# The database is not touched: a rollback does not undo a migration. Migrations are additive and an older
# release starts on a newer schema. If a migration itself is what went wrong, restore the backup the deploy
# took (DEPLOYMENT.md, "Recovery").
set -Eeuo pipefail

ROOT="${ZEHNBOT_ROOT:-/opt/zehnbot}"
say() { printf '%s  %s\n' "$(date -u +%H:%M:%SZ)" "$*"; }
release_of() { [[ -L "$ROOT/$1" ]] && basename "$(readlink -f "$ROOT/$1")" || true; }

CURRENT="$(release_of current)"
TARGET="${1:-$(release_of previous)}"
available="$(find "$ROOT/releases" -mindepth 1 -maxdepth 1 -type d -printf '%f ' 2>/dev/null || true)"
[[ -n "$TARGET" ]] || { say "ERROR: there is no previous release to roll back to. On this server: $available" >&2; exit 1; }
[[ "$TARGET" =~ ^[0-9a-f]{7,40}$ ]] || { say "ERROR: a release is a git commit id, got '$TARGET'" >&2; exit 1; }
[[ "$TARGET" != "$CURRENT" ]] || { say "ERROR: $TARGET is already serving" >&2; exit 1; }
[[ -x "$ROOT/releases/$TARGET/deploy.sh" ]] || { say "ERROR: release $TARGET is not on this server. On this server: $available" >&2; exit 1; }

say "rolling back from ${CURRENT:-nothing} to $TARGET"
exec "$ROOT/releases/$TARGET/deploy.sh" "$TARGET"
