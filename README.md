# ChatBot SaaS

A multi-tenant AI chatbot platform. Customers (tenants) create bots, load them with knowledge,
and embed them on their websites with one script tag. You operate the platform as super admin.

```
visitor's browser ── widget.js ──┐
                                 ├─> Caddy (TLS) ─> nginx ─┬─> dashboard (React)
tenant / super admin ── dashboard┘                         └─> FastAPI ─> Postgres
                                                                    └──> Redis (rate limits)
```

| Folder             | What it is                                                              |
|--------------------|-------------------------------------------------------------------------|
| `backend/`         | FastAPI API, SQLAlchemy models, Alembic migrations, tests               |
| `admin-dashboard/` | React dashboard, served by nginx which also proxies `/api` and `/static` |
| `widget/`          | The embeddable chat widget (plain JS, bundled to `/static/widget.js`)   |

## How a conversation works

1. **The widget** (`widget/`) lives in a Shadow DOM, so a customer's CSS cannot break it and it cannot
   disturb their page. It keeps the transcript for the browser tab, so the chat survives page changes.
2. **Retrieval is hybrid.** The question is matched against the bot's knowledge two ways: Postgres
   full-text search (exact on names, codes, numbers) and pgvector embeddings (finds the passage when
   the visitor words it differently, or in another language). Reciprocal rank fusion merges the two.
   Without an embeddings key or without pgvector, it quietly stays keyword-only.
3. **The reply streams** token by token (`POST /api/chat/stream`, server-sent events). `/api/chat/message`
   is the same thing without streaming and is what older browsers fall back to.
4. **The model tags its own reply.** `[[LEAD_FORM]]` when it has just invited the visitor to leave
   contact details (the widget then opens its form), `[[UNANSWERED]]` when it could not answer. Tags
   are stripped server-side, also when they arrive split across stream chunks (`TagFilter`).
5. **Leads.** An email or phone number typed straight into the chat becomes a lead without the form
   (plain pattern matching in `lead_service.py`, no extra model call). Form and chat details merge
   into one lead per conversation. Owners export leads as CSV.
6. **Insights.** Per bot: conversations, leads and conversion, answer rate, daily activity, and the
   list of questions the bot could not answer, which is the to-do list for its knowledge base.

## Roles

| Role            | Can do                                                                                   |
|-----------------|------------------------------------------------------------------------------------------|
| **Super admin** | Everything: create/suspend/delete tenants, set plans and limits, reset logins, see all bots |
| **Tenant admin**| Only their own tenant: bots, knowledge, conversations, leads, their own credentials       |

Tenant isolation is enforced in one place, `get_owned_client` in `backend/app/dependencies.py`.
Every tenant-scoped route depends on it. Another tenant's bot answers `404`.

## Plans, quotas and AI keys

Plans live in `PLANS` in `backend/app/config.py` (`free`, `starter`, `pro`, `business`). A plan sets a
tenant's **monthly message quota** and **max bots**; the super admin can override both per tenant.

Each bot answers with one of two keys:

* **The tenant's own key** (entered on the bot form): uses the bot's provider and model, and is
  **not** limited by the quota, since the tenant pays the provider directly.
* **The platform's AI** (`PLATFORM_AI_*` in `.env`, **DeepSeek by default**): used when the bot has no
  key. Every message counts against the tenant's monthly quota; when it is used up the bot answers
  `429` until next month.

### AI providers

The catalogue lives in one file, `backend/app/services/providers.py`: DeepSeek, OpenRouter, OpenAI,
Anthropic, Gemini, Groq, Mistral, xAI Grok, Together, Fireworks, Cerebras, Perplexity, and **custom**
(any OpenAI-compatible endpoint by URL: LiteLLM, vLLM, a company gateway). Adding a provider is one
entry there; the dashboard's form is built from `GET /api/admin/providers` and the provider tests
pick it up automatically.

| You want                         | `.env`                                                                                   |
|----------------------------------|------------------------------------------------------------------------------------------|
| DeepSeek (default)               | `PLATFORM_AI_PROVIDER=deepseek`, `PLATFORM_AI_API_KEY=...` (model defaults to `deepseek-flash`) |
| OpenRouter                       | `PLATFORM_AI_PROVIDER=openrouter`, `PLATFORM_AI_API_KEY=...`, `PLATFORM_AI_MODEL=<vendor/model>` |
| Your own gateway / local model   | `PLATFORM_AI_PROVIDER=custom`, `PLATFORM_AI_BASE_URL=http://litellm:4000/v1`, `PLATFORM_AI_MODEL=...` |

Two rules worth knowing:

* **A key only ever goes to the provider it belongs to.** `OPENAI_API_KEY` is never used as the key
  for another provider, and tenants cannot change the URL of a named provider.
* **Tenant-supplied endpoints are untrusted.** A `custom` URL must be https and resolve to a public
  address (checked when saved and again on every call), and redirects are not followed, so it cannot
  be used to reach services inside your network. The operator's own `PLATFORM_AI_BASE_URL` is trusted
  and may be internal. Switch tenant endpoints off with `ALLOW_CUSTOM_AI_ENDPOINTS=false`.

**Embeddings are a separate concern.** DeepSeek has no embeddings API. On OpenRouter the platform key
covers semantic search too. On DeepSeek, either add an `OPENAI_API_KEY`, or point `EMBEDDING_*` at
OpenRouter (see `.env.example`); otherwise bots use keyword search, which works without any of this.

There is no payment integration yet. Plans are assigned by hand. `tenants.plan`,
`monthly_message_quota` and `max_bots` are the fields a Stripe webhook would update.

## Run it

```bash
cp .env.example .env        # then fill it in; the file explains each value
docker compose up -d --build
```

Dashboard: <http://localhost:3001>. Sign in with `ADMIN_SEED_EMAIL` / `ADMIN_SEED_PASSWORD`.
On start the backend applies migrations and creates the super admin if none exists.

### Production (HTTPS)

1. Point your domain's DNS at the server and open ports 80 and 443.
2. In `.env` set `DOMAIN=chat.yourdomain.com`, keep `ENVIRONMENT=production` and `BIND_ADDR=127.0.0.1`.
3. `docker compose --profile tls up -d --build`

Caddy obtains and renews the certificate automatically. nginx and the backend are not reachable
from outside; only Caddy is. In production the backend **refuses to start** with a weak
`SECRET_KEY` or a missing `ENCRYPTION_KEY`.

Embed snippet (shown on each bot's edit page):

```html
<script src="https://chat.yourdomain.com/static/widget.js?client_id=acme-bot" defer></script>
```

The widget only works on the website(s) in the bot's **Domain** field. Add `localhost` there
while testing locally (e.g. with `test.html`).

### Upgrading an existing installation

Nothing to do by hand. On first start `scripts/migrate.py` detects a database created by the old
version and migrates it in place: existing admins become super admins, existing bots move into a
tenant called **Default**, stored AI keys are encrypted, duplicate conversations are merged.
**Back up first** (`./scripts/backup.sh`), and make sure `ENCRYPTION_KEY` is set.

## Operations

* **Backups:** `./scripts/backup.sh` (cron line inside). Keep copies off the server, together with
  a copy of `ENCRYPTION_KEY`. Losing that key makes every stored AI key unreadable.
* **Health:** `GET /health` (process up), `GET /health/ready` (database reachable).
* **Logs:** `docker compose logs -f backend`. Every response carries an `X-Request-ID` that also
  appears in the log line, so a user-reported error can be found.
* **Schema changes:** edit the models, then
  `docker compose exec backend alembic revision --autogenerate -m "what changed"`, review the file,
  commit it. It is applied on the next start.
* **Semantic search:** the `db` service is `postgres:16-alpine` plus pgvector (`db/Dockerfile`), on the
  same data volume as before. Embeddings are created when knowledge is uploaded. For knowledge that
  predates this, or after an embeddings outage, run
  `docker compose exec backend python scripts/embed_backfill.py` (safe to re-run). On a Postgres
  without pgvector the app logs that semantic search is off and carries on with keyword search.
* **Scaling:** raise `WEB_CONCURRENCY`. Rate limits are shared through Redis, so several workers
  or replicas are fine.

## Security model

| Threat                                           | Defence                                                                                   |
|--------------------------------------------------|-------------------------------------------------------------------------------------------|
| Tenant reads another tenant's data               | All routes scoped through `get_owned_client`; covered by `tests/test_tenancy.py`          |
| Leaked database exposes customers' AI keys       | Keys encrypted at rest (Fernet); the API never returns them, only a 4-character hint      |
| Someone burns a tenant's AI budget via the widget| Origin check against the bot's domain, per-IP / per-session / per-bot rate limits, quotas |
| Prompt injection through forged chat history     | History is rebuilt from the database; the browser cannot supply roles or earlier turns    |
| Server-side request forgery via URL ingest/crawl | Every hop must resolve to a public IP; redirects re-validated; downloads size-capped      |
| Password guessing                                | bcrypt, 10+ character passwords, per-IP and per-account login limits, constant-time miss  |
| Stolen session token                             | 8-hour expiry; changing the password revokes every existing token                         |
| Bot reply used to inject script into a customer's site | Replies are rendered with DOM nodes only, never `innerHTML`; links limited to http(s) |
| Malicious lead data runs as a formula in Excel   | CSV export neutralises cells starting with `= + - @`                                        |
| Provider error text leaks keys to visitors       | Visitors get a generic message; details go to the log and the owner's test chat only      |

Known limitations, deliberately left for later: no email verification on self-sign-up (keep
`ALLOW_SIGNUP=false` until you add it), no password-reset-by-email (the super admin resets
passwords), session tokens live in `localStorage` (mitigated by a strict Content-Security-Policy).

## Development

```bash
# backend tests (SQLite, no services needed)
cd backend
pip install -r requirements-dev.txt
pytest

# dashboard with hot reload (proxies /api to localhost:8000)
cd admin-dashboard && npm install && npm run dev

# widget
cd widget && npm install && npm run watch
npm test        # builds the bundle and drives it in jsdom: isolation, streaming, XSS safety, lead form
```

`backend/tests/test_ai_providers.py` runs the real OpenAI, Anthropic and Gemini SDKs against a fake
HTTP layer (plain and streaming). Run it after every SDK upgrade: it is what catches a provider
silently breaking because a parameter was renamed.
