"""The platform AI key set from the super admin's Settings page: it overrides .env, and removing it falls back."""
from app.config import settings
from app.models.setting import PlatformSetting
from app.services.ai_service import AIProviderError
from tests.conftest import auth
from tests.test_chat import say

URL = "/api/admin/platform-ai"
NEW = {"provider": "openai", "model": "gpt-4o-mini", "api_key": "sk-dashboard-key-9876"}


def test_env_is_shown_until_the_dashboard_sets_a_key(api, superadmin):
    status = api.get(URL, headers=auth(superadmin)).json()
    assert (status["source"], status["env_key_set"], status["dashboard_key_saved"]) == ("env", True, False)
    assert status["key_hint"].endswith("-key") and "platform-test-key" not in str(status)


def test_a_dashboard_key_answers_instead_of_env_and_is_never_echoed(api, db, superadmin, two_tenants, fake_ai):
    saved = api.put(URL, headers=auth(superadmin), json=NEW)
    assert saved.status_code == 200, saved.text
    body = saved.json()
    assert (body["source"], body["provider"], body["model"], body["key_hint"]) == ("dashboard", "openai", "gpt-4o-mini", "…9876")
    assert "sk-dashboard-key-9876" not in saved.text
    stored = db.get(PlatformSetting, "platform_ai").value
    assert stored["api_key"].startswith("enc:v1:") and "sk-dashboard" not in str(stored)      # encrypted at rest

    assert say(api).status_code == 200
    call = fake_ai[-1]
    assert (call["api_key"], call["provider"], call["model"]) == ("sk-dashboard-key-9876", "openai", "gpt-4o-mini")
    assert call["endpoint"].trusted is False

    overview = api.get("/api/admin/overview/platform", headers=auth(superadmin)).json()["system"]
    assert (overview["platform_provider"], overview["platform_model"], overview["platform_key_set"]) == ("OpenAI", "gpt-4o-mini", True)


def test_changing_the_model_keeps_the_saved_key(api, superadmin, two_tenants, fake_ai):
    api.put(URL, headers=auth(superadmin), json=NEW)
    res = api.put(URL, headers=auth(superadmin), json={"provider": "openai", "model": "gpt-4o", "api_key": ""})
    assert res.status_code == 200 and res.json()["key_hint"] == "…9876"
    say(api)
    assert (fake_ai[-1]["api_key"], fake_ai[-1]["model"]) == ("sk-dashboard-key-9876", "gpt-4o")


def test_removing_the_dashboard_key_falls_back_to_env(api, superadmin, two_tenants, fake_ai):
    api.put(URL, headers=auth(superadmin), json=NEW)
    cleared = api.delete(URL, headers=auth(superadmin))
    assert cleared.status_code == 200 and cleared.json()["source"] == "env"
    say(api)
    assert fake_ai[-1]["api_key"] == "platform-test-key"


def test_a_dashboard_key_works_even_without_an_env_key(api, superadmin, two_tenants, fake_ai, monkeypatch):
    monkeypatch.setattr(settings, "PLATFORM_AI_API_KEY", "")
    assert api.get(URL, headers=auth(superadmin)).json()["source"] == "none"
    assert say(api).status_code == 503
    api.put(URL, headers=auth(superadmin), json=NEW)
    assert say(api, session="session-87654321").status_code == 200


def test_only_the_super_admin_can_see_or_set_it(api, two_tenants):
    token = two_tenants["acme"]["token"]
    assert api.get(URL, headers=auth(token)).status_code == 403
    assert api.put(URL, headers=auth(token), json=NEW).status_code == 403
    assert api.delete(URL, headers=auth(token)).status_code == 403
    assert api.post(URL + "/test", headers=auth(token)).status_code == 403
    assert api.put(URL, json=NEW).status_code == 401


def test_bad_settings_are_refused(api, superadmin):
    def put(**change):
        return api.put(URL, headers=auth(superadmin), json={**NEW, **change})

    assert put(provider="nope").status_code == 400
    assert put(provider="openrouter", model="").status_code == 400                    # no default model there
    assert put(api_key="").status_code == 400                                         # nothing saved yet to keep
    if settings.ALLOW_CUSTOM_AI_ENDPOINTS:
        assert put(provider="custom", model="m", base_url="http://llm.example.com/v1").status_code == 400
        assert put(provider="custom", model="m", base_url="https://127.0.0.1/v1").status_code == 400


def test_the_connection_test_reports_without_leaking(api, superadmin, monkeypatch):
    seen = {}

    def fake(messages, endpoint, api_key):
        seen["key"] = api_key
        return "ready", 3

    monkeypatch.setattr("app.routers.platform_ai.chat_completion", fake)
    ok = api.post(URL + "/test", headers=auth(superadmin), json=NEW).json()
    assert ok["ok"] is True and seen["key"] == "sk-dashboard-key-9876"
    assert api.post(URL + "/test", headers=auth(superadmin)).json()["ok"] is True       # what answers now (.env)
    assert seen["key"] == "platform-test-key"

    def broken(messages, endpoint, api_key):
        raise AIProviderError("AuthenticationError: invalid key")

    monkeypatch.setattr("app.routers.platform_ai.chat_completion", broken)
    bad = api.post(URL + "/test", headers=auth(superadmin), json=NEW).json()
    assert bad["ok"] is False and "invalid key" in bad["detail"]
