#!/usr/bin/env bash
# nginx -t for the configuration proposed for the SERVER's nginx (bot.zehnox.com.conf and its two snippets),
# exactly as written, minus the certificate lines (those files exist only on the server).
#   nginx/check.sh <any nginx image>
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IMAGE="${1:?usage: check.sh <nginx image>}"
work="$(mktemp -d)"; trap 'rm -rf "$work"; docker rm -f zehnbot-nginx-check >/dev/null 2>&1 || true' EXIT
sed -E -e '/ssl_certificate|letsencrypt|ssl_dhparam|listen .*443 ssl/d' -e 's#/etc/nginx/snippets/#/etc/nginx/zb-snippets/#' "$HERE/bot.zehnox.com.conf" \
  | sed -e '0,/server_name bot.zehnox.com;/s//server_name bot.zehnox.com;\n    listen 8443;/' > "$work/site.conf"
docker rm -f zehnbot-nginx-check >/dev/null 2>&1 || true
docker create --name zehnbot-nginx-check "$IMAGE" nginx -t >/dev/null
docker cp "$work/site.conf" zehnbot-nginx-check:/etc/nginx/conf.d/default.conf
docker cp "$HERE/." zehnbot-nginx-check:/etc/nginx/zb-snippets/
docker start -a zehnbot-nginx-check
