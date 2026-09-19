# ZehnBot

A multi-tenant AI chatbot platform (product name: ZehnBot, by Zehnox). Customers (tenants) create bots, load them with knowledge,
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

**Production deployment** (bot.zehnox.com, GitHub Actions, rollback): see [DEPLOYMENT.md](DEPLOYMENT.md).

## Run it

```bash
cp .env.example .env        # then fill it in; the file explains each value
docker compose up -d --build
```

Open <http://localhost:3001>. Sign in with `ADMIN_SEED_EMAIL` / `ADMIN_SEED_PASSWORD`.
On start the backend applies migrations and creates the super admin if none exists.

### What is where

| Address          | What it is                                                                                  |
|------------------|---------------------------------------------------------------------------------------------|
| `/`              | The public landing page (light and dark). Its calls to action follow `ALLOW_SIGNUP`.        |
| `/signup`        | Self-service registration: creates a workspace on `DEFAULT_SIGNUP_PLAN` and logs the owner in. Closed (with a way to ask for access) when `ALLOW_SIGNUP=false`. |
| `/login`         | Customers sign in here (and sign up at `/signup`). Operator accounts are refused here with the same answer as a wrong password. |
| `/console`       | The super admin signs in here. Linked from nowhere public; customer accounts are refused.   |
| `/overview`      | Customers: their workspace (setup checklist, conversations, leads, open questions, quota). Super admin: the operator console (every workspace, sign-ups, usage against quota, system status). |
| `/bots`, `/settings` | Bots and their knowledge, conversations, leads and insights; workspace name, login and appearance. |
| `/tenants`       | Super admin only: create, suspend and delete workspaces, set plans and limits, reset logins. |
| `/enquiries`     | Super admin only: people who pressed **Talk to Zehnox** (the platform's own leads). Mark as contacted, close, export CSV. |
| `/verify-email`, `/auth/callback` | Where the confirmation email's link and Google sign-in land. Nobody navigates here by hand. |

**Chats on this site.** In the console, Settings > *Chats on this site* picks two of your bots: the
**support chat** in the lower-right corner of every page (each visitor gets `RATE_SUPPORT_BOT_PER_IP_PER_DAY`
messages a day, 50 by default), and the **live demo** on the landing page. For the demo, `LANDING_DEMO_BOT`
in `.env` still works when nothing is picked in Settings. The landing page then shows a real, streaming conversation with it
(that workspace's quota applies, and each visitor's IP address gets `RATE_LANDING_DEMO_PER_IP_PER_DAY` messages a day, 20 by default; the bot's own website is not affected by this allowance). Leave it empty and the page shows a screenshot instead.

**Talk to Zehnox.** Every "Talk to Zehnox" button (landing page, pricing, closed sign-up, a
customer's plan line in Settings) opens a short form: a name, an email or a phone number, what they
need. It is stored as an enquiry (`POST /api/contact`, rate limited per visitor, with a honeypot) and
shown to the super admin under **Enquiries**, with an alert on the operator overview while any are new.

**A new bot matches its website.** "Match my website's colours and font" is ticked by default on
the new-bot form. The backend reads the site's homepage and stylesheets through the same SSRF guard
as the crawler, ranks the colours and fonts the site really uses (brand variables, filled buttons,
the body font, resolving `var(--font)`), and lets the AI choose among them. The AI can only pick a
value that was found in the site's own CSS, so page content cannot steer it anywhere else; with no
AI key, or if the call fails, the ranking decides. An existing bot has a **Match my website** button.
The widget also picks readable text for any brand colour (dark text on a lime, white on a navy), and
with no font set it uses the font of the page it sits on.

### Email verification and Sign in with Google

Both are **off until configured**, so a fresh install works with nothing to set up.

**No mail server means no open password sign-up.** With `ALLOW_SIGNUP=true` but no SMTP settings, the sign-up
form stays closed and visitors are offered the contact form instead (it lands in Enquiries), because otherwise
anyone could register with an address that is not theirs. The operator overview says so, and tells you what to
set. Sign in with Google can still create accounts, since Google has confirmed the address. For local testing
only, `ALLOW_UNVERIFIED_SIGNUP=true` opens it anyway. Check your mail settings with
`docker compose exec backend python scripts/send_test_email.py you@example.com`.

| To switch on | Set in `.env` | What changes |
|---|---|---|
| Email verification | `SMTP_HOST`, `SMTP_FROM` (plus `SMTP_USERNAME` / `SMTP_PASSWORD`, and `PUBLIC_BASE_URL`) | A sign-up gets "check your inbox" instead of a session, and cannot log in until the emailed link (valid 24 hours) is opened. Logins created by the operator, and every login that existed before, count as verified. |
| Sign in with Google | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `PUBLIC_BASE_URL` | A "Continue with Google" button on log in and sign up. |

Any SMTP provider works (Gmail with an app password: `smtp.gmail.com`, port 587). For Google, create
an OAuth client of type *Web application* and add the redirect URI
`<PUBLIC_BASE_URL>/api/auth/google/callback` (for local testing: `http://localhost:3001/api/auth/google/callback`).

How it is built, because these are the parts that get attacked:
- Google uses the server-side authorisation-code flow. No Google script runs in the dashboard, so its
  Content-Security-Policy stays `script-src 'self'`. The ID token is verified against Google's signing
  keys (audience, issuer, expiry, `email_verified`), a state cookie blocks sign-ins started by another
  site, and the session comes back in the URL fragment, which never reaches a server or a log.
- Verification links are signed with a key derived separately from the session key: a link can never be
  used as a session, nor a session as a link. A link dies if the address changes.
- An address that was registered but never confirmed can be registered again by whoever owns the inbox
  (the new password replaces the old one). Signing in with Google to such an address discards the
  password that was set on it. Both close the "register the victim's email first, then wait" attack.
- "Send a new link" answers the same way whether or not the address has an account.

### Two landing pages

`https://bot.zehnox.com/` serves ZehnBot's own landing page ("Turn questions into leads"), to everyone, and never
redirects; signed-in users get "Open dashboard" on it. The ZEHNOX website also has a product page for ZehnBot
(`https://zehnox.com/zehnbot`, in the separate `zehnox-site` repository) whose "Start free" and "Log in" point here.

- `MARKETING_URL=https://zehnox.com/zehnbot` is only where the logo on the sign-in pages links. It does not
  change what `/` shows.
- **Prices are edited here, shown there.** Super admin > Settings > *Plans and pricing* sets the price, the one
  line under it, the currency and the recommended plan. `GET /api/public/plans` (no login, any origin, cached
  five minutes) combines them with the real limits from `PLANS` in `backend/app/config.py`; the landing page
  reads it and falls back to the prices in its own HTML when this app cannot be reached. Changing a price
  charges nobody: billing is still arranged by hand.
- "Talk to Zehnox" on the landing page is the ZEHNOX site's own consultation form. Inside the app (closed
  sign-up, a customer's plan line) it is the contact dialog that lands in **Enquiries**.

### Brand

Colours come from `Zehnox branding.pdf`, read as vectors: navy `#021b8c`, blue `#1a52d7`, grey `#767887`,
paper `#f2f4f5`, ink `#13101f`, lime `#cefd21`. Light theme: paper ground, navy working colour. Dark theme:
ink ground, lime working colour with ink text on it. All tokens live in `admin-dashboard/src/styles/theme.css`.
The ZehnBot mark is `logo-icon.png` (transparent), cut to sizes in `admin-dashboard/public/brand/`, next to the Zehnox
mark, lockup and wordmark as SVG (extracted from the PDF's own outlines, for light and dark grounds).

**Demo data.** `docker compose exec backend python scripts/seed_demo.py --yes` fills an EMPTY
installation with fictional workspaces, bots, conversations and leads. It refuses to run once any
workspace exists, so it can never touch real data. The landing page's screenshots
(`admin-dashboard/public/shots/`) were captured from exactly this data.

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
