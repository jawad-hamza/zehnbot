# Deploying ZehnBot

Production: **https://bot.zehnox.com**, on the Hostinger VPS (`ssh hostinger-vps`), in `/opt/zehnbot`.
Every push to `main` is tested, rehearsed and, once enabled, deployed by GitHub Actions. A deploy never
stops the release that is serving until its replacement has proven itself, visitors are never cut off,
and a failed deploy puts everything back by itself.

## Architecture

```
visitor ─► Cloudflare ─► server nginx (TLS, bot.zehnox.com) ─► 127.0.0.1:3001  edge (nginx, never restarted by a deploy)
                                                                   ├─► admin            production web + /api proxy ─► backend ─► db (Postgres + pgvector), redis
                                                                   └─► admin-candidate  only during a deploy          ─► backend-candidate
```

| Container (project `zehnbot`) | What it is | Reachable on |
|---|---|---|
| `zehnbot-edge-1` | stock `nginx:1.30-alpine`, config in `/opt/zehnbot/edge` | `127.0.0.1:3001` (the server's nginx points here) |
| `zehnbot-admin-1` | dashboard + proxy to the API | `127.0.0.1:3003` (direct, for checks) |
| `zehnbot-backend-1` | the API (FastAPI, 2 workers); runs migrations on start | ZehnBot's networks only |
| `zehnbot-db-1`, `zehnbot-redis-1` | Postgres 16 (+pgvector), Redis (rate limits only) | ZehnBot's networks only |
| `…-candidate-1` | the next release, only while a deploy runs | `127.0.0.1:3002` (direct, for checks) |

Every published port is bound to `127.0.0.1`. Networks `zehnbot` and `zehnbot-candidate`, volume `zehnbot_pgdata`:
all ZehnBot's own. Nothing of the ZEHNOX site, n8n, SearXNG or the mail server is used or touched.

**Resources** (measured): API ~190 MB, Postgres ~30 MB idle, the rest a few MB each. Limits are guard rails
only, so that a runaway can never starve the other apps on this 1 vCPU / 3.8 GB server: API 1 GB, database 1 GB,
candidate API 768 MB, web and redis 128 MB, edge 64 MB.

## How a deploy works

`deploy/deploy.sh <release>` (a release = the first 12 characters of the git commit):

1. The images are pulled, and the release's edge configuration must pass `nginx -t`. **Production untouched.**
2. The database is backed up to `/opt/zehnbot/backups/pre-<release>-<time>.sql.gz` (the last 10 are kept).
3. The new release starts in the **candidate** slot, against the same database (its migrations run here), and is
   checked end to end. **Fails → the candidate is removed; production never noticed.**
4. Production switches: the edge first prefers the candidate (a graceful nginx reload), production is drained
   (it finishes what it is serving; nothing new arrives), restarted on the new release, checked on its own, and
   preferred again. **Fails → production goes back to the release it was on.**
5. The edge takes the release's configuration (graceful reload) and the whole path through it is checked.
6. `current` → this release, `previous` → the one before. Older releases and images are deleted.

**Why no visitor sees an error:** the edge reaches the web containers over Docker's own network, where a
container that is stopping refuses connections cleanly (safe to retry, even for POSTs). It is told to prefer
the candidate *before* production is drained. Proven in CI on every push (below).

**Migrations must be additive** (add; never rename or drop in the same release as the code that stops using the
old shape), because the new release migrates while the old one still serves. An older release starts on a newer
schema without migrating (`backend/scripts/migrate.py`), which is what makes rollback work across migrations.

**Proof on every push.** Before any image is published, CI runs `deploy/drill.sh` with the real images, scripts
and compose file, with GET and POST visitors flowing through a stand-in for the server's nginx: a deploy, a
broken release (refused, production untouched), a release that fails only in production (undone), a rollback
onto a newer schema, an edge configuration change and a broken one, and a check that the data survived all of
it. Any visitor error fails the build. (31 checks; locally, zero failed requests out of about 2,000.)

## On the server

```
/opt/zehnbot/
  .env                   secrets and settings (mode 600, never in git or an image)
  current  -> releases/<release>     serving now
  previous -> releases/<release>     kept for rollback
  releases/<release>/    compose.yaml, deploy.sh, rollback.sh, healthcheck.sh, lib.sh, edge/   (uploaded per release)
  edge/                  the edge's live configuration (mounted into it read-only)
  backups/               pre-deploy database dumps
  deploy.log             one line per deploy / rollback
  deploy.lock            one deploy or rollback at a time
```

## GitHub setup (repository `jawad-hamza/zehnbot`)

**Secrets** (Settings → Secrets and variables → Actions → *Secrets*):

| Secret | Value |
|---|---|
| `VPS_HOST` | `187.53.134.192` (the IP: SSH does not pass through Cloudflare) |
| `VPS_USER` | `jawad` |
| `VPS_SSH_KEY` | the private deploy key (step 2 below) |
| `VPS_KNOWN_HOSTS` | the server's host key line (step 3 below) |
| `VPS_PORT` | optional; only if SSH is not on 22 |

**Variable** (same page → *Variables*): `ZEHNBOT_DEPLOY_ENABLED` = `true` once the one-time setup is done.
Until then every push is still tested, rehearsed and its images published, but nothing is deployed.

Images go to GitHub Container Registry (`ghcr.io/jawad-hamza/zehnbot-{backend,admin,db}`) using the workflow's
own token. The server logs in with a token that expires when the job ends, and logs out right after.

## First deployment (one time)

On the server (`ssh hostinger-vps`):

```bash
# 1. the folder
sudo install -d -o jawad -g jawad -m 750 /opt/zehnbot

# 2. a deploy key used only by GitHub Actions ("restrict": no forwarding, no terminal)
ssh-keygen -t ed25519 -N "" -C "github-actions zehnbot" -f ~/.ssh/github_actions_zehnbot
echo "restrict $(cat ~/.ssh/github_actions_zehnbot.pub)" >> ~/.ssh/authorized_keys
cat ~/.ssh/github_actions_zehnbot          # copy ALL of it into the VPS_SSH_KEY secret, then:
shred -u ~/.ssh/github_actions_zehnbot     # the server never needs the private half

# 3. the server's host key, for the VPS_KNOWN_HOSTS secret
echo "187.53.134.192 $(cut -d' ' -f1,2 /etc/ssh/ssh_host_ed25519_key.pub)"
```

From your computer, in this repository, copy the settings template to the server:

```bash
scp deploy/env.production.example hostinger-vps:/opt/zehnbot/.env
```

Back on the server, fill it in (`nano /opt/zehnbot/.env`), then `chmod 600 /opt/zehnbot/.env`. Generate the
secrets there:

```bash
openssl rand -base64 48 | tr -d '/+=\n' | cut -c1-48; echo       # DB_PASSWORD, and again for SECRET_KEY
python3 -c "import base64,os; print(base64.urlsafe_b64encode(os.urandom(32)).decode())"   # ENCRYPTION_KEY
```

Keep a copy of `ENCRYPTION_KEY` somewhere other than the server: without it, stored tenant API keys are lost.

**Email:** create a login on the server's mail system (Postfix at `mail.zehnox.com`, the same way the ZEHNOX
site's login was made) and put it in `SMTP_USERNAME` / `SMTP_PASSWORD`. Password sign-up stays closed until email
works (Sign in with Google does not need it). After the first deploy, test it:

```bash
docker exec zehnbot-backend-1 python scripts/send_test_email.py you@example.com
```

Then in GitHub: add the secrets, set `ZEHNBOT_DEPLOY_ENABLED` = `true`, and start **Actions → CI and deploy →
Run workflow** (or push to `main`). When it is green, check on the server:

```bash
curl -fsS http://127.0.0.1:3001/api/health/ready      # {"status":"ready"}
```

Log in with `ADMIN_SEED_EMAIL` / `ADMIN_SEED_PASSWORD` once bot.zehnox.com points here (next step), then change the password under Settings.

### Point bot.zehnox.com at ZehnBot (one time, once ZehnBot is healthy)

bot.zehnox.com already has HTTPS and a placeholder. The change is small and touches no other site. From your
computer, copy the two snippets up:

```bash
scp deploy/nginx/cloudflare-realip.conf deploy/nginx/zehnbot-proxy.conf hostinger-vps:/tmp/
```

On the server:

```bash
sudo mv /tmp/cloudflare-realip.conf /tmp/zehnbot-proxy.conf /etc/nginx/snippets/
sudo cp -a /etc/nginx/sites-available/bot.zehnox.com /root/bot.zehnox.com.placeholder     # the way back
sudo nano /etc/nginx/sites-available/bot.zehnox.com
```

In the first `server { … }` block, directly under `server_name bot.zehnox.com;`, add:

```nginx
    include /etc/nginx/snippets/cloudflare-realip.conf;
    client_max_body_size 16m;
```

and replace the placeholder

```nginx
    location / {
        return 200 "ZehnBot deployment ready\n";
        add_header Content-Type text/plain;
    }
```

with

```nginx
    location = /api/chat/stream {
        proxy_pass http://127.0.0.1:3001;
        include /etc/nginx/snippets/zehnbot-proxy.conf;
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 300s;
    }

    location / {
        proxy_pass http://127.0.0.1:3001;
        include /etc/nginx/snippets/zehnbot-proxy.conf;
        proxy_read_timeout 140s;
    }
```

Leave every `# managed by Certbot` line and the second (port 80) block exactly as they are. Then:

```bash
sudo nginx -t && sudo systemctl reload nginx
curl -fsS https://bot.zehnox.com/api/health/ready
```

The complete result is in `deploy/nginx/bot.zehnox.com.conf`, and CI runs `nginx -t` on it on every push.
To undo: `sudo cp -a /root/bot.zehnox.com.placeholder /etc/nginx/sites-available/bot.zehnox.com && sudo nginx -t && sudo systemctl reload nginx`.

The snippets restore each visitor's real address from Cloudflare (`CF-Connecting-IP`, trusted only from
Cloudflare's published ranges), which ZehnBot's per-visitor limits depend on. Cloudflare's SSL mode should be
**Full (strict)** (the server has a valid certificate).

### Moving the local data (optional)

Production starts empty (plus the super admin). To bring over what is on your computer instead, before real
users sign up: use the local `ENCRYPTION_KEY` in the server's `.env`, then

```bash
# on your computer
docker compose exec -T db pg_dump -U chatbot -Fc chatbotdb > zehnbot.dump
scp zehnbot.dump hostinger-vps:/opt/zehnbot/backups/
# on the server
docker stop zehnbot-admin-1 zehnbot-backend-1
docker exec -i zehnbot-db-1 pg_restore -U chatbot -d chatbotdb --clean --if-exists < /opt/zehnbot/backups/zehnbot.dump
docker start zehnbot-backend-1 zehnbot-admin-1
```

## Everyday use

- **Deploy:** push to `main`. Watch it under Actions. Two pushes in a row deploy one after the other, never at the
  same time; if an older build finishes after a newer commit exists, it steps aside so the newer one deploys.
- **Change a setting:** edit `/opt/zehnbot/.env`, then redeploy the release that is serving (same safety, no downtime):
  `/opt/zehnbot/current/deploy.sh "$(basename "$(readlink -f /opt/zehnbot/current)")"`
- **Health:** `https://bot.zehnox.com/api/health/ready` (API and database) is the URL for an uptime monitor.
  On the server: `/opt/zehnbot/current/healthcheck.sh http://127.0.0.1:3001`.
- **Logs:** `docker logs -f zehnbot-backend-1` (API), `zehnbot-admin-1`, `zehnbot-edge-1`, `zehnbot-db-1`;
  `cat /opt/zehnbot/deploy.log`; each run under GitHub → Actions. Container logs rotate at 5 × 10 MB.
- **What is running:** `docker ps --filter name=zehnbot`, `readlink /opt/zehnbot/current /opt/zehnbot/previous`.

## Rollback

- **GitHub:** Actions → **Rollback** → Run workflow. Empty = the previous release; or give a release listed in
  `/opt/zehnbot/releases`.
- **On the server:** `/opt/zehnbot/current/rollback.sh` (previous) or `/opt/zehnbot/current/rollback.sh <release>`.

A rollback is a deploy of the older release: candidate first, checked, no visitor cut off, and if the target is
not healthy production stays where it is. Its images are already on the server. The database is not touched.

## Recovery

- **A migration went wrong** (data, not code): stop the API, restore the backup the deploy took, roll back:
  ```bash
  docker stop zehnbot-admin-1 zehnbot-backend-1
  docker exec zehnbot-db-1 psql -q -U chatbot -d postgres -c "DROP DATABASE chatbotdb WITH (FORCE)" -c "CREATE DATABASE chatbotdb OWNER chatbot"
  gunzip -c /opt/zehnbot/backups/pre-<release>-<time>.sql.gz | docker exec -i zehnbot-db-1 psql -q -U chatbot chatbotdb
  /opt/zehnbot/current/rollback.sh
  ```
- **The edge is unhealthy:** `docker logs zehnbot-edge-1`; its config is in `/opt/zehnbot/edge` (the last good copy
  is in `/opt/zehnbot/edge/.previous`). Fix it, then `docker exec zehnbot-edge-1 nginx -t && docker exec zehnbot-edge-1 nginx -s reload`.
- **Everything is down:** `cd /opt/zehnbot && RELEASE=$(basename $(readlink -f current)) docker compose -p zehnbot --project-directory /opt/zehnbot --env-file .env -f current/compose.yaml up -d db redis backend admin edge`.
  Production answers directly on `127.0.0.1:3003` even without the edge.
- **Stuck lock** (only if no deploy is really running): `rm /opt/zehnbot/deploy.lock`.

## Deploying without GitHub Actions

The images of the serving and previous releases are always on the server, so **rollback never needs GitHub**.
To deploy a new commit by hand:

- **Registry available:** create a GitHub token with `read:packages`, then on the server
  `echo <token> | docker login ghcr.io -u jawad-hamza --password-stdin`, copy the release files (as the workflow does,
  into `/opt/zehnbot/releases/<release>/`, with `deploy/compose.prod.yaml` as `compose.yaml` and `deploy/edge/*` in
  `edge/`), run `/opt/zehnbot/releases/<release>/deploy.sh <release>`, then `docker logout ghcr.io`.
- **Registry unavailable too:** build on the server from a checkout of the commit (slow on one CPU, 10 to 15 min):
  ```bash
  git clone https://github.com/jawad-hamza/zehnbot.git /tmp/zb && cd /tmp/zb && git checkout <commit>
  R=$(git rev-parse --short=12 HEAD); REG=ghcr.io/jawad-hamza
  docker build -t $REG/zehnbot-backend:$R -f backend/Dockerfile . && docker build -t $REG/zehnbot-admin:$R admin-dashboard
  mkdir -p /opt/zehnbot/releases/$R/edge && cp deploy/compose.prod.yaml /opt/zehnbot/releases/$R/compose.yaml
  cp deploy/{deploy,rollback,healthcheck,lib}.sh /opt/zehnbot/releases/$R/ && cp deploy/edge/* /opt/zehnbot/releases/$R/edge/
  /opt/zehnbot/releases/$R/deploy.sh $R
  ```
  The deploy finds the images locally and never tries the registry.

## Security notes

- Secrets live only in `/opt/zehnbot/.env` (mode 600) and GitHub secrets. CI fails if a secret-bearing file is
  tracked, and scans the whole history with gitleaks on every push.
- The deploy key can do what the `jawad` account can, and that account is in the `docker` group, which on any server
  is as powerful as root. Keep the key only in GitHub; to revoke it, delete its line from `~/.ssh/authorized_keys`.
- Optionally protect the `production` environment (Settings → Environments) with required reviewers, so a deploy
  waits for your approval.
