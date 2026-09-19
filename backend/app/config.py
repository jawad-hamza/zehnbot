import json
import logging
from typing import Dict, List

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

logger = logging.getLogger(__name__)

# Plan defaults applied when a tenant is created or moved to a plan.
# The super admin can override both numbers per tenant afterwards.
PLANS: Dict[str, Dict[str, int]] = {
    "free":     {"monthly_message_quota": 200,    "max_bots": 1},
    "starter":  {"monthly_message_quota": 2_000,  "max_bots": 3},
    "pro":      {"monthly_message_quota": 10_000, "max_bots": 10},
    "business": {"monthly_message_quota": 50_000, "max_bots": 50},
}

_WEAK_SECRETS = {"", "changeme", "secret", "your-secret-key", "supersecret"}


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    ENVIRONMENT: str = "development"   # "production" turns the checks below into hard failures

    DATABASE_URL: str
    DB_POOL_SIZE: int = 10
    DB_MAX_OVERFLOW: int = 20

    SECRET_KEY: str
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 8

    # Fernet key used to encrypt tenant AI provider keys at rest.
    # Generate with: python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
    ENCRYPTION_KEY: str = ""

    # Cross-origin access to the ADMIN api. The dashboard is served same-origin,
    # so this is normally empty. Public widget endpoints are always open to any origin.
    ALLOWED_ORIGINS: str = ""

    ADMIN_SEED_EMAIL: str = "admin@example.com"
    ADMIN_SEED_PASSWORD: str = "changeme"

    # Multi-tenancy
    ALLOW_SIGNUP: bool = False
    # client_id of a bot to run live on the public landing page ("talk to it before you sign up").
    # Its Website setting needs no entry for the platform's own domain: our own pages are always allowed.
    LANDING_DEMO_BOT: str = ""
    # The marketing page when it lives on another website (e.g. https://zehnox.com/zehnbot). Set, the app's own
    # "/" stops showing a landing page and goes to log in; the logo on the sign-in pages links back there.
    MARKETING_URL: str = ""
    DEFAULT_SIGNUP_PLAN: str = "free"

    # Platform AI: answers for bots that have no key of their own, metered by the tenant's quota.
    # Any provider id from app/services/providers.py (deepseek, openrouter, openai, anthropic, ...).
    PLATFORM_AI_PROVIDER: str = "deepseek"
    PLATFORM_AI_MODEL: str = ""        # empty = the provider's default; required where it has none (openrouter, custom)
    PLATFORM_AI_API_KEY: str = ""
    # Optional endpoint override: required for `custom`, otherwise for a proxy or gateway in front of
    # the provider. Operator-configured, so it may point at an internal address (LiteLLM, vLLM, Ollama).
    PLATFORM_AI_BASE_URL: str = ""
    OPENAI_API_KEY: str = ""   # legacy name: the platform key when the provider is openai; also used for embeddings

    # May tenants point a bot at their own OpenAI-compatible endpoint (provider "custom")?
    # Such URLs must be https, resolve to a public address, and redirects are not followed.
    ALLOW_CUSTOM_AI_ENDPOINTS: bool = True

    AI_TIMEOUT_SECONDS: float = 30.0
    AI_MAX_OUTPUT_TOKENS: int = 600

    # Semantic search. Embeddings are a platform cost (tiny: about a cent per fully loaded bot),
    # because tenants' own keys may belong to providers that have no embeddings API.
    # Any OpenAI-compatible embeddings endpoint works. No key = keyword search only.
    ENABLE_EMBEDDINGS: bool = True
    EMBEDDING_API_KEY: str = ""        # defaults to the OpenAI platform key
    EMBEDDING_BASE_URL: str = ""
    EMBEDDING_MODEL: str = "text-embedding-3-small"
    EMBEDDING_DIMENSIONS: int = 1536   # must match the `embedding vector(N)` column

    # Abuse protection
    REDIS_URL: str = ""                    # empty = in-process limiter (single worker only)
    ENFORCE_WIDGET_ORIGIN: bool = True     # reject widget calls whose Origin does not match the bot's domain
    ALLOW_LOCALHOST_WIDGET: bool = True    # ...except from localhost, so owners can try the widget on their own machine
    MAX_MESSAGE_CHARS: int = 2000
    MAX_CHUNKS_PER_CLIENT: int = 5000
    RATE_CHAT_PER_IP_PER_MIN: int = 20
    RATE_CHAT_PER_SESSION_PER_MIN: int = 12
    RATE_CHAT_PER_BOT_PER_MIN: int = 300
    RATE_LEAD_PER_IP_PER_MIN: int = 5
    RATE_LOGIN_PER_IP_PER_5MIN: int = 15
    RATE_LOGIN_PER_ACCOUNT_PER_5MIN: int = 6
    RATE_SIGNUP_PER_IP_PER_HOUR: int = 3
    RATE_CONTACT_PER_IP_PER_HOUR: int = 5
    RATE_VERIFY_EMAIL_PER_ADDRESS_PER_HOUR: int = 4

    # Without a mail server nobody can prove an address is theirs, so password sign-up stays closed even when
    # ALLOW_SIGNUP is true. Set this to true ONLY for local testing: anyone can then register any address.
    ALLOW_UNVERIFIED_SIGNUP: bool = False

    # ---- outgoing email (any SMTP provider). Sign-up email verification switches on once this is filled in ----
    SMTP_HOST: str = ""
    SMTP_PORT: int = 587
    SMTP_USERNAME: str = ""
    SMTP_PASSWORD: str = ""
    SMTP_FROM: str = ""                 # e.g. ZehnBot <no-reply@yourdomain.com>
    SMTP_SECURITY: str = "starttls"     # starttls (port 587) | ssl (port 465) | none (a local relay only: nothing is encrypted)
    # Where links in emails and the Google sign-in redirect point. No trailing slash.
    PUBLIC_BASE_URL: str = "http://localhost:3001"

    # ---- Sign in with Google (OAuth web client). Both empty = the button is not shown ----
    GOOGLE_CLIENT_ID: str = ""
    GOOGLE_CLIENT_SECRET: str = ""
    RATE_STYLE_MATCH_PER_USER_PER_HOUR: int = 20
    # The landing page's live demo spends the demo bot owner's AI budget, so each visitor gets a daily allowance
    RATE_LANDING_DEMO_PER_IP_PER_DAY: int = 20

    LOG_LEVEL: str = "INFO"

    @property
    def is_production(self) -> bool:
        return self.ENVIRONMENT.lower() == "production"

    @property
    def allowed_origins_list(self) -> List[str]:
        raw = (self.ALLOWED_ORIGINS or "").strip()
        if not raw:
            return []
        try:
            parsed = json.loads(raw)
            items = parsed if isinstance(parsed, list) else [str(parsed)]
        except ValueError:
            items = raw.split(",")
        origins = [str(o).strip().rstrip("/") for o in items if str(o).strip()]
        if "*" in origins:
            # A wildcard is never honoured for the admin API. It is not needed: the
            # dashboard talks to the API same-origin through nginx.
            logger.warning("ALLOWED_ORIGINS contains '*'; ignoring it for the admin API.")
            origins = [o for o in origins if o != "*"]
        return origins

    @property
    def platform_provider(self) -> str:
        return self.PLATFORM_AI_PROVIDER.strip().lower()

    @property
    def signup_open(self) -> bool:
        """Password sign-up. Open only when a new address can be proven real (a mail server is configured),
        unless the operator has explicitly accepted unverified accounts."""
        return self.ALLOW_SIGNUP and (self.email_enabled or self.ALLOW_UNVERIFIED_SIGNUP)

    @property
    def google_signup_open(self) -> bool:
        """Google has already verified the address, so this needs no mail server."""
        return self.ALLOW_SIGNUP and self.google_enabled

    @property
    def email_enabled(self) -> bool:
        return bool(self.SMTP_HOST.strip() and self.SMTP_FROM.strip())

    @property
    def google_enabled(self) -> bool:
        return bool(self.GOOGLE_CLIENT_ID.strip() and self.GOOGLE_CLIENT_SECRET.strip())

    @property
    def public_base_url(self) -> str:
        return self.PUBLIC_BASE_URL.strip().rstrip("/")

    @property
    def platform_api_key(self) -> str:
        if self.PLATFORM_AI_API_KEY:
            return self.PLATFORM_AI_API_KEY
        # A key is only ever sent to the company that issued it: the OpenAI key must not end up
        # at DeepSeek just because the provider setting changed.
        return self.OPENAI_API_KEY if self.platform_provider == "openai" else ""

    @property
    def embedding_endpoint(self) -> tuple:
        """(api_key, base_url, model) for embeddings, or ("", "", "") when semantic search is off.

        Chat and embeddings are separate concerns: DeepSeek, Anthropic and most others have no
        embeddings API. So: an explicit EMBEDDING_* setting wins; else an OpenAI key; else, when the
        platform runs on OpenRouter, that same key (OpenRouter proxies OpenAI's embedding models)."""
        off = ("", "", "")
        if not self.ENABLE_EMBEDDINGS:
            return off
        if self.EMBEDDING_API_KEY:
            return self.EMBEDDING_API_KEY, self.EMBEDDING_BASE_URL, self.EMBEDDING_MODEL
        if self.EMBEDDING_BASE_URL:
            return off   # a custom endpoint must be given its own key, never somebody else's
        if self.OPENAI_API_KEY:
            return self.OPENAI_API_KEY, "", self.EMBEDDING_MODEL
        if self.PLATFORM_AI_API_KEY and self.platform_provider == "openai":
            return self.PLATFORM_AI_API_KEY, "", self.EMBEDDING_MODEL
        if self.PLATFORM_AI_API_KEY and self.platform_provider == "openrouter":
            model = self.EMBEDDING_MODEL if "/" in self.EMBEDDING_MODEL else f"openai/{self.EMBEDDING_MODEL}"
            return self.PLATFORM_AI_API_KEY, "https://openrouter.ai/api/v1", model
        return off

    @property
    def embedding_api_key(self) -> str:
        return self.embedding_endpoint[0]

    @model_validator(mode="after")
    def _check_secrets(self):
        problems = []
        if self.SECRET_KEY.lower() in _WEAK_SECRETS or len(self.SECRET_KEY) < 32:
            problems.append("SECRET_KEY must be a random string of at least 32 characters")
        if not self.ENCRYPTION_KEY:
            problems.append("ENCRYPTION_KEY is not set (tenant API keys cannot be stored)")
        else:
            from cryptography.fernet import Fernet
            try:
                Fernet(self.ENCRYPTION_KEY.encode())
            except ValueError:
                # wrong in every environment: a malformed key can never encrypt anything
                raise ValueError("ENCRYPTION_KEY is not a valid Fernet key (32 url-safe base64-encoded bytes)")
        if self.DEFAULT_SIGNUP_PLAN not in PLANS:
            raise ValueError(f"DEFAULT_SIGNUP_PLAN must be one of {sorted(PLANS)}")

        from app.services.providers import get_provider
        platform = get_provider(self.PLATFORM_AI_PROVIDER)
        if platform is None:
            raise ValueError(f"PLATFORM_AI_PROVIDER '{self.PLATFORM_AI_PROVIDER}' is not a known provider")
        if self.platform_api_key:   # only meaningful once a platform key is actually configured
            if not (self.PLATFORM_AI_MODEL or platform.default_model):
                problems.append(f"PLATFORM_AI_MODEL is required for provider '{platform.id}' (it has no default model)")
            if platform.needs_base_url and not self.PLATFORM_AI_BASE_URL:
                problems.append(f"PLATFORM_AI_BASE_URL is required for provider '{platform.id}'")
        if problems:
            if self.is_production:
                raise ValueError("Unsafe configuration: " + "; ".join(problems))
            for p in problems:
                logger.warning("Config warning (fatal in production): %s", p)
        return self


settings = Settings()
