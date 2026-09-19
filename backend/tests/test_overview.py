"""The two dashboards' home pages, the workspace rename, and the public bits the landing page reads."""
from app.config import settings
from app.models.tenant import Tenant
from app.models.user import User
from tests.conftest import PASSWORD, auth, login, make_bot, make_tenant

ACME = {"Origin": "https://www.acme.com"}
GLOBEX = {"Origin": "https://www.globex.com"}


def say(api, text, bot="acme-bot", headers=ACME, session="session-12345678"):
    res = api.post("/api/chat/message", headers=headers, json={"client_id": bot, "session_id": session, "message": text})
    assert res.status_code == 200, res.text
    return res


def workspace(api, token, **params):
    res = api.get("/api/admin/overview/workspace", headers=auth(token), params=params)
    assert res.status_code == 200, res.text
    return res.json()


# ---------- workspace overview ----------

def test_a_new_workspace_starts_with_an_empty_checklist(api, superadmin):
    make_tenant(api, superadmin, "Acme", "owner@acme.com")
    data = workspace(api, login(api, "owner@acme.com"))
    assert data["checklist"] == {"has_bot": False, "has_knowledge": False, "has_conversation": False, "has_lead": False}
    assert data["bots"] == [] and data["recent_leads"] == [] and data["open_questions"] == []
    assert data["period"]["answer_rate"] == 1.0 and data["period"]["lead_conversion_rate"] == 0.0
    assert len(data["daily"]) == 30 and all(day["conversations"] == 0 for day in data["daily"])


def test_workspace_overview_counts_only_its_own_tenant(api, two_tenants, fake_ai):
    say(api, "Hello, my email is sam@example.com")
    say(api, "Second visitor", session="session-abcdefgh")
    say(api, "Globex visitor", bot="globex-bot", headers=GLOBEX, session="session-globex01")

    acme = workspace(api, two_tenants["acme"]["token"])
    assert acme["workspace"]["name"] == "Acme"
    assert acme["period"]["conversations"] == 2
    assert acme["period"]["visitor_messages"] == 2
    assert acme["period"]["leads"] == 1
    assert acme["period"]["lead_conversion_rate"] == 0.5
    assert [b["client_id"] for b in acme["bots"]] == ["acme-bot"]
    assert acme["bots"][0]["conversations"] == 2 and acme["bots"][0]["leads"] == 1
    assert [l["email"] for l in acme["recent_leads"]] == ["sam@example.com"]
    assert acme["workspace"]["messages_this_month"] == 2 and acme["workspace"]["bots_used"] == 1
    assert acme["checklist"]["has_conversation"] and acme["checklist"]["has_lead"]
    assert sum(day["conversations"] for day in acme["daily"]) == 2

    globex = workspace(api, two_tenants["globex"]["token"])
    assert globex["period"]["conversations"] == 1 and globex["period"]["leads"] == 0
    assert globex["recent_leads"] == []


def test_unanswered_questions_are_listed_with_what_was_asked(api, two_tenants, monkeypatch):
    monkeypatch.setattr(
        "app.services.chat_service.chat_completion",
        lambda messages, endpoint, api_key: ("I don't have that to hand. [[UNANSWERED]]", 10),
    )
    say(api, "Do you ship to Norway?")
    say(api, "do you ship to  norway?", session="session-abcdefgh")     # the same gap, asked again: listed once
    data = workspace(api, two_tenants["acme"]["token"])
    assert data["period"]["unanswered"] == 2 and data["period"]["answer_rate"] == 0.0
    assert len(data["open_questions"]) == 1 and "norway" in data["open_questions"][0]["question"].lower()
    assert data["open_questions"][0]["bot_name"] == "Bot acme-bot"
    assert workspace(api, two_tenants["globex"]["token"])["open_questions"] == []


def test_overview_window_is_bounded(api, two_tenants):
    token = two_tenants["acme"]["token"]
    assert len(workspace(api, token, days=7)["daily"]) == 7
    assert api.get("/api/admin/overview/workspace", headers=auth(token), params={"days": 3}).status_code == 422
    assert api.get("/api/admin/overview/workspace", headers=auth(token), params={"days": 9999}).status_code == 422


def test_overviews_need_a_login(api):
    assert api.get("/api/admin/overview/workspace").status_code == 401
    assert api.get("/api/admin/overview/platform").status_code == 401


def test_the_operator_has_no_workspace_of_their_own(api, superadmin):
    assert api.get("/api/admin/overview/workspace", headers=auth(superadmin)).status_code == 404
    assert api.put("/api/admin/workspace", headers=auth(superadmin), json={"name": "Mine now"}).status_code == 404


# ---------- platform overview ----------

def test_platform_overview_is_for_the_operator_only(api, two_tenants):
    assert api.get("/api/admin/overview/platform", headers=auth(two_tenants["acme"]["token"])).status_code == 403


def test_platform_overview_adds_up_every_tenant(api, superadmin, two_tenants, fake_ai, db):
    say(api, "Hello")
    say(api, "Hi there, reach me on sam@example.com", bot="globex-bot", headers=GLOBEX, session="session-globex01")
    suspended = db.query(Tenant).filter(Tenant.name == "Globex").one()
    suspended.is_active = False
    db.commit()

    res = api.get("/api/admin/overview/platform", headers=auth(superadmin))
    assert res.status_code == 200, res.text
    data = res.json()
    assert data["totals"]["tenants"] == 2
    assert data["totals"]["active_tenants"] == 1 and data["totals"]["suspended_tenants"] == 1
    assert data["totals"]["bots"] == 2
    assert data["period"]["new_tenants"] == 2 and data["period"]["conversations"] == 2 and data["period"]["leads"] == 1
    assert data["month"]["messages"] == 2
    assert {row["name"] for row in data["top_tenants"]} == {"Acme", "Globex"}
    assert {row["owner_email"] for row in data["recent_tenants"]} == {"owner@acme.com", "owner@globex.com"}
    assert {p["plan"]: p["tenants"] for p in data["plans"]}["starter"] == 2
    assert sum(day["signups"] for day in data["daily"]) == 2


def test_platform_status_reports_settings_but_never_secrets(api, superadmin):
    res = api.get("/api/admin/overview/platform", headers=auth(superadmin))
    system = res.json()["system"]
    assert system["platform_provider"] == "DeepSeek"      # the display label, as the dashboard shows it
    assert system["platform_key_set"] is True and system["signup_open"] is True
    assert "platform-test-key" not in res.text


def test_a_tenant_near_its_quota_is_flagged(api, superadmin, two_tenants, fake_ai, db):
    tenant = db.query(Tenant).filter(Tenant.name == "Acme").one()
    tenant.monthly_message_quota = 2
    db.commit()
    say(api, "one")
    say(api, "two")
    data = api.get("/api/admin/overview/platform", headers=auth(superadmin)).json()
    assert data["totals"]["tenants_near_quota"] == 1


# ---------- renaming a workspace ----------

def test_an_owner_can_rename_their_own_workspace_only(api, two_tenants, db):
    res = api.put("/api/admin/workspace", headers=auth(two_tenants["acme"]["token"]), json={"name": "  Acme Cycles  "})
    assert res.status_code == 200, res.text
    assert res.json()["name"] == "Acme Cycles"
    assert {t.name for t in db.query(Tenant).all()} == {"Acme Cycles", "Globex"}


def test_renaming_cannot_change_plan_or_limits(api, two_tenants, db):
    res = api.put(
        "/api/admin/workspace", headers=auth(two_tenants["acme"]["token"]),
        json={"name": "Acme", "plan": "business", "monthly_message_quota": 999999, "max_bots": 500},
    )
    assert res.status_code == 200
    tenant = db.query(Tenant).filter(Tenant.name == "Acme").one()
    assert tenant.plan == "starter" and tenant.monthly_message_quota == 2000 and tenant.max_bots == 3


def test_a_workspace_name_cannot_be_blank(api, two_tenants):
    assert api.put("/api/admin/workspace", headers=auth(two_tenants["acme"]["token"]), json={"name": "x"}).status_code == 422
    assert api.put("/api/admin/workspace", headers=auth(two_tenants["acme"]["token"]), json={"name": "     "}).status_code == 422


# ---------- what the landing page reads ----------

def test_a_filled_honeypot_is_refused_and_creates_nothing(api, db):
    res = api.post("/api/auth/signup", json={
        "company_name": "Spam Ltd", "email": "bot@spam.example", "password": PASSWORD, "website": "http://spam.example",
    })
    assert res.status_code == 400
    assert db.query(User).filter(User.email == "bot@spam.example").first() is None
    assert db.query(Tenant).count() == 0


def test_an_empty_honeypot_is_a_normal_signup(api):
    res = api.post("/api/auth/signup", json={"company_name": "Initech", "email": "bill@initech.com", "password": PASSWORD, "website": ""})
    assert res.status_code == 201, res.text


def test_auth_config_names_the_demo_bot_only_when_one_is_set(api, monkeypatch):
    assert api.get("/api/auth/config").json()["demo_client_id"] is None
    monkeypatch.setattr(settings, "LANDING_DEMO_BOT", "  tallis-cycles ")
    assert api.get("/api/auth/config").json()["demo_client_id"] == "tallis-cycles"


def test_the_landing_demo_may_talk_to_the_demo_bot_from_the_platform_host(api, superadmin, fake_ai):
    make_tenant(api, superadmin, "Tallis", "owner@tallis.example")
    make_bot(api, login(api, "owner@tallis.example"), "tallis-cycles", "talliscycles.example")
    # same host as the API (the landing page), which is how the inline demo calls it
    ok = api.post("/api/chat/message", headers={"Origin": "http://testserver"},
                  json={"client_id": "tallis-cycles", "session_id": "landing-12345678", "message": "When are you open?"})
    assert ok.status_code == 200, ok.text
    refused = api.post("/api/chat/message", headers={"Origin": "https://elsewhere.example"},
                       json={"client_id": "tallis-cycles", "session_id": "landing-12345678", "message": "Hi"})
    assert refused.status_code == 403


def test_the_landing_demo_has_a_daily_allowance_per_visitor(api, superadmin, fake_ai, monkeypatch):
    make_tenant(api, superadmin, "Tallis", "owner@tallis.example", plan="business")
    make_bot(api, login(api, "owner@tallis.example"), "tallis-cycles", "talliscycles.example")
    monkeypatch.setattr(settings, "LANDING_DEMO_BOT", "tallis-cycles")
    monkeypatch.setattr(settings, "RATE_LANDING_DEMO_PER_IP_PER_DAY", 3)
    monkeypatch.setattr(settings, "RATE_CHAT_PER_IP_PER_MIN", 1000)
    monkeypatch.setattr(settings, "RATE_CHAT_PER_SESSION_PER_MIN", 1000)

    def ask(origin, n, path="/api/chat/message"):
        return api.post(path, headers={"Origin": origin},
                        json={"client_id": "tallis-cycles", "session_id": f"landing-{n:08d}", "message": "When are you open?"})

    for n in range(3):
        assert ask("http://testserver", n).status_code == 200
    refused = ask("http://testserver", 3)                       # a new session does not reset it: it is per visitor
    assert refused.status_code == 429 and "limit for today" in refused.json()["detail"]
    assert ask("http://testserver", 4, "/api/chat/stream").status_code == 429   # streaming shares the allowance
    # the bot's real website is a different origin and keeps working
    assert ask("https://www.talliscycles.example", 5).status_code == 200
    assert len(fake_ai) == 4


def test_the_demo_allowance_only_applies_to_the_demo_bot(api, two_tenants, fake_ai, monkeypatch):
    monkeypatch.setattr(settings, "LANDING_DEMO_BOT", "some-other-bot")
    monkeypatch.setattr(settings, "RATE_LANDING_DEMO_PER_IP_PER_DAY", 1)
    for n in range(3):   # the owner previewing their own bot on our host is not a demo visitor
        res = api.post("/api/chat/message", headers={"Origin": "http://testserver"},
                       json={"client_id": "acme-bot", "session_id": f"preview-{n:08d}", "message": "Hello"})
        assert res.status_code == 200, res.text
