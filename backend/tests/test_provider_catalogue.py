"""The provider catalogue, tenant-supplied ("custom") endpoints, and which key goes where."""
import importlib

import pytest
from cryptography.fernet import Fernet

from app.config import Settings, settings
from app.services.ai_service import AIProviderError, Endpoint, chat_completion
from tests.conftest import auth, make_bot


def make_settings(**overrides):
    # explicit blanks: the test session's own environment (conftest) must not leak into these
    base = dict(DATABASE_URL="sqlite://", SECRET_KEY="s" * 40, ENCRYPTION_KEY=Fernet.generate_key().decode(),
                PLATFORM_AI_API_KEY="", OPENAI_API_KEY="", EMBEDDING_API_KEY="", _env_file=None)
    return Settings(**{**base, **overrides})


# ---- which key is sent to whom ----

def test_deepseek_is_the_default_platform_provider():
    s = make_settings(PLATFORM_AI_API_KEY="ds-key")
    assert (s.platform_provider, s.platform_api_key) == ("deepseek", "ds-key")


def test_the_openai_key_is_never_sent_to_another_provider():
    # an OPENAI_API_KEY left over in .env must not become DeepSeek's (or anyone else's) bearer token
    assert make_settings(PLATFORM_AI_PROVIDER="deepseek", OPENAI_API_KEY="sk-openai").platform_api_key == ""
    assert make_settings(PLATFORM_AI_PROVIDER="openrouter", PLATFORM_AI_MODEL="a/b", OPENAI_API_KEY="sk-openai").platform_api_key == ""
    assert make_settings(PLATFORM_AI_PROVIDER="openai", OPENAI_API_KEY="sk-openai").platform_api_key == "sk-openai"


@pytest.mark.parametrize("env,expected", [
    # DeepSeek has no embeddings API: nothing to use, so semantic search is simply off
    (dict(PLATFORM_AI_PROVIDER="deepseek", PLATFORM_AI_API_KEY="ds"), ("", "", "")),
    # ...unless an OpenAI key is around for exactly this purpose
    (dict(PLATFORM_AI_PROVIDER="deepseek", PLATFORM_AI_API_KEY="ds", OPENAI_API_KEY="sk-o"), ("sk-o", "", "text-embedding-3-small")),
    # OpenRouter serves OpenAI's embedding models, so one key covers chat and search
    (dict(PLATFORM_AI_PROVIDER="openrouter", PLATFORM_AI_MODEL="a/b", PLATFORM_AI_API_KEY="or"),
     ("or", "https://openrouter.ai/api/v1", "openai/text-embedding-3-small")),
    # an explicit setting always wins
    (dict(PLATFORM_AI_PROVIDER="openrouter", PLATFORM_AI_MODEL="a/b", PLATFORM_AI_API_KEY="or",
          EMBEDDING_API_KEY="e", EMBEDDING_BASE_URL="https://emb.example/v1", EMBEDDING_MODEL="my-model"),
     ("e", "https://emb.example/v1", "my-model")),
    # a custom embeddings URL without its own key gets no key at all
    (dict(PLATFORM_AI_PROVIDER="openai", OPENAI_API_KEY="sk-o", EMBEDDING_BASE_URL="https://emb.example/v1"), ("", "", "")),
    (dict(PLATFORM_AI_PROVIDER="openai", OPENAI_API_KEY="sk-o", ENABLE_EMBEDDINGS=False), ("", "", "")),
])
def test_embeddings_endpoint_resolution(env, expected):
    assert make_settings(**env).embedding_endpoint == expected


def test_misconfigured_platform_provider_is_caught_at_startup():
    with pytest.raises(ValueError, match="not a known provider"):
        make_settings(PLATFORM_AI_PROVIDER="skynet")
    with pytest.raises(ValueError, match="PLATFORM_AI_MODEL is required"):
        make_settings(ENVIRONMENT="production", PLATFORM_AI_PROVIDER="openrouter", PLATFORM_AI_API_KEY="or")
    with pytest.raises(ValueError, match="PLATFORM_AI_BASE_URL is required"):
        make_settings(ENVIRONMENT="production", PLATFORM_AI_PROVIDER="custom", PLATFORM_AI_MODEL="m", PLATFORM_AI_API_KEY="k")


# ---- the catalogue, as the dashboard sees it ----

def test_dashboard_gets_the_provider_list(api, two_tenants, monkeypatch):
    headers = auth(two_tenants["acme"]["token"])
    providers = api.get("/api/admin/providers", headers=headers).json()
    ids = [p["id"] for p in providers]
    assert ids[:2] == ["deepseek", "openrouter"] and {"openai", "anthropic", "gemini", "groq", "mistral", "custom"} <= set(ids)
    by_id = {p["id"]: p for p in providers}
    assert by_id["deepseek"]["default_model"] == "deepseek-flash"
    assert by_id["openrouter"]["default_model"] is None          # a model must be chosen
    assert by_id["custom"]["needs_base_url"] is True

    monkeypatch.setattr(settings, "ALLOW_CUSTOM_AI_ENDPOINTS", False)
    assert "custom" not in [p["id"] for p in api.get("/api/admin/providers", headers=headers).json()]
    assert api.get("/api/admin/providers").status_code == 401


def test_new_bots_default_to_deepseek_and_unknown_providers_are_refused(api, two_tenants):
    assert two_tenants["acme"]["bot"]["ai_provider"] == "deepseek"
    bot_id, headers = two_tenants["acme"]["bot"]["id"], auth(two_tenants["acme"]["token"])
    assert api.put(f"/api/admin/clients/{bot_id}", headers=headers, json={"ai_provider": "skynet"}).status_code == 422


def test_a_provider_without_a_default_model_needs_one_once_a_key_is_set(api, two_tenants):
    bot_id, headers = two_tenants["acme"]["bot"]["id"], auth(two_tenants["acme"]["token"])
    url = f"/api/admin/clients/{bot_id}"
    assert api.put(url, headers=headers, json={"ai_provider": "openrouter"}).status_code == 200      # no key yet: platform AI answers
    res = api.put(url, headers=headers, json={"ai_api_key": "or-key-1234567"})
    assert res.status_code == 400 and "model" in res.json()["detail"].lower()
    res = api.put(url, headers=headers, json={"ai_api_key": "or-key-1234567", "ai_model": "deepseek/some-model"})
    assert res.status_code == 200 and res.json()["ai_model"] == "deepseek/some-model"


# ---- custom endpoints are tenant input: they must not reach inside the network ----

@pytest.mark.parametrize("base_url,reason", [
    ("http://8.8.8.8/v1", "https"),                      # the API key would travel in clear text
    ("https://127.0.0.1/v1", "publicly routable"),
    ("https://10.0.0.5/v1", "publicly routable"),
    ("https://169.254.169.254/v1", "publicly routable"),  # cloud metadata
    ("https://localhost/v1", "publicly routable"),
    ("https://8.8.8.8:6379/v1", "port"),
    ("", "base URL"),
])
def test_custom_endpoint_must_be_public_https(api, two_tenants, base_url, reason):
    bot_id, headers = two_tenants["acme"]["bot"]["id"], auth(two_tenants["acme"]["token"])
    res = api.put(f"/api/admin/clients/{bot_id}", headers=headers, json={"ai_provider": "custom", "ai_base_url": base_url, "ai_model": "m"})
    assert res.status_code == 400 and reason.lower() in res.json()["detail"].lower(), res.json()


def test_custom_endpoint_is_used_for_the_bots_replies(api, two_tenants, fake_ai):
    bot_id, headers = two_tenants["acme"]["bot"]["id"], auth(two_tenants["acme"]["token"])
    res = api.put(f"/api/admin/clients/{bot_id}", headers=headers, json={
        "ai_provider": "custom", "ai_base_url": "https://8.8.8.8/v1/", "ai_model": "my-llm", "ai_api_key": "custom-key-123456",
    })
    assert res.status_code == 200 and res.json()["ai_base_url"] == "https://8.8.8.8/v1"

    api.post("/api/chat/message", headers={"Origin": "https://acme.com"}, json={"client_id": "acme-bot", "session_id": "session-12345678", "message": "hi"})
    endpoint = fake_ai[-1]["endpoint"]
    assert (endpoint.provider, endpoint.base_url, endpoint.model, endpoint.trusted) == ("custom", "https://8.8.8.8/v1", "my-llm", False)
    assert fake_ai[-1]["api_key"] == "custom-key-123456"


def test_tenants_cannot_redirect_a_named_provider_to_their_own_server(api, two_tenants):
    bot_id, headers = two_tenants["acme"]["bot"]["id"], auth(two_tenants["acme"]["token"])
    res = api.put(f"/api/admin/clients/{bot_id}", headers=headers, json={"ai_provider": "deepseek", "ai_base_url": "https://8.8.8.8/steal"})
    assert res.status_code == 200 and res.json()["ai_base_url"] is None


def test_custom_endpoints_can_be_switched_off_by_the_operator(api, two_tenants, monkeypatch):
    monkeypatch.setattr(settings, "ALLOW_CUSTOM_AI_ENDPOINTS", False)
    bot_id, headers = two_tenants["acme"]["bot"]["id"], auth(two_tenants["acme"]["token"])
    res = api.put(f"/api/admin/clients/{bot_id}", headers=headers, json={"ai_provider": "custom", "ai_base_url": "https://8.8.8.8/v1", "ai_model": "m"})
    assert res.status_code == 400 and "not enabled" in res.json()["detail"]


def test_endpoint_is_rechecked_at_call_time_and_redirects_are_not_followed(monkeypatch):
    # saved while it pointed somewhere public; DNS (or the row) changed afterwards
    with pytest.raises(AIProviderError, match="Endpoint refused"):
        chat_completion([{"role": "user", "content": "hi"}], Endpoint("custom", "m", "https://10.0.0.5/v1", trusted=False), "k")

    seen = {}
    for name in ("httpx", "httpx2"):
        try:
            lib = importlib.import_module(name)
        except ImportError:
            continue

        def send(self, request, _lib=lib, **kwargs):
            seen["follow_redirects"] = self.follow_redirects
            return _lib.Response(302, headers={"location": "http://169.254.169.254/latest/meta-data/"}, request=request)

        monkeypatch.setattr(lib.Client, "send", send)

    with pytest.raises(AIProviderError):
        chat_completion([{"role": "user", "content": "hi"}], Endpoint("custom", "m", "https://8.8.8.8/v1", trusted=False), "k")
    assert seen["follow_redirects"] is False

    # the operator's own endpoint is trusted: an internal gateway is a legitimate setup
    with pytest.raises(AIProviderError) as exc:
        chat_completion([{"role": "user", "content": "hi"}], Endpoint("custom", "m", "http://10.0.0.5:4000/v1", trusted=True), "k")
    assert "Endpoint refused" not in str(exc.value)
