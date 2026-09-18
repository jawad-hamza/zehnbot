"""The core SaaS promise: one customer can never see or touch another customer's data."""
import uuid

from app.models.client import Client
from app.models.conversation import Conversation, Message
from tests.conftest import auth, login, make_bot, make_tenant


def test_tenant_lists_only_its_own_bots(api, two_tenants):
    acme = api.get("/api/admin/clients", headers=auth(two_tenants["acme"]["token"])).json()
    assert [c["client_id"] for c in acme] == ["acme-bot"]


def test_superadmin_sees_every_tenants_bots(api, superadmin, two_tenants):
    everything = api.get("/api/admin/clients", headers=auth(superadmin)).json()
    assert {c["client_id"] for c in everything} == {"acme-bot", "globex-bot"}
    assert {c["tenant_name"] for c in everything} == {"Acme", "Globex"}


def test_other_tenants_bot_is_invisible_on_every_route(api, two_tenants):
    intruder = auth(two_tenants["acme"]["token"])
    victim = two_tenants["globex"]["bot"]["id"]

    attempts = [
        api.get(f"/api/admin/clients/{victim}", headers=intruder),
        api.put(f"/api/admin/clients/{victim}", headers=intruder, json={"name": "pwned"}),
        api.delete(f"/api/admin/clients/{victim}", headers=intruder),
        api.get(f"/api/admin/clients/{victim}/knowledge", headers=intruder),
        api.post(f"/api/admin/clients/{victim}/knowledge", headers=intruder, json={"raw_text": "x"}),
        api.delete(f"/api/admin/clients/{victim}/knowledge", headers=intruder),
        api.post(f"/api/admin/clients/{victim}/knowledge/crawl", headers=intruder, json={"url": "https://example.com"}),
        api.get(f"/api/admin/clients/{victim}/conversations", headers=intruder),
        api.get(f"/api/admin/clients/{victim}/leads", headers=intruder),
        api.post(f"/api/admin/clients/{victim}/test-chat", headers=intruder, json={"session_id": "test-12345678", "message": "hi"}),
    ]
    assert [r.status_code for r in attempts] == [404] * len(attempts)

    # and nothing was changed
    owner = auth(two_tenants["globex"]["token"])
    assert api.get(f"/api/admin/clients/{victim}", headers=owner).json()["name"] == "Bot globex-bot"


def test_other_tenants_conversation_messages_are_invisible(api, db, two_tenants):
    bot_id = uuid.UUID(two_tenants["globex"]["bot"]["id"])
    conversation = Conversation(client_id=bot_id, session_id="session-12345678")
    db.add(conversation)
    db.flush()
    db.add(Message(conversation_id=conversation.id, role="user", content="my secret order number is 991"))
    db.commit()

    url = f"/api/admin/conversations/{conversation.id}/messages"
    assert api.get(url, headers=auth(two_tenants["acme"]["token"])).status_code == 404
    owner_view = api.get(url, headers=auth(two_tenants["globex"]["token"]))
    assert owner_view.status_code == 200 and len(owner_view.json()) == 1


def test_tenant_cannot_plant_a_bot_in_another_tenant(api, db, superadmin, two_tenants):
    globex_tenant_id = two_tenants["globex"]["bot"]["tenant_id"]
    bot = make_bot(api, two_tenants["acme"]["token"], "sneaky", tenant_id=globex_tenant_id)
    assert bot["tenant_id"] == two_tenants["acme"]["bot"]["tenant_id"]


def test_tenant_users_cannot_reach_platform_admin(api, two_tenants):
    intruder = auth(two_tenants["acme"]["token"])
    assert api.get("/api/admin/tenants", headers=intruder).status_code == 403
    assert api.post("/api/admin/tenants", headers=intruder, json={}).status_code == 403
    assert api.get("/api/admin/plans", headers=intruder).status_code == 403


def test_plan_limits_the_number_of_bots(api, superadmin):
    make_tenant(api, superadmin, "Tiny", "owner@tiny.com", plan="free")   # free = 1 bot
    token = login(api, "owner@tiny.com")
    make_bot(api, token, "tiny-one")
    res = api.post("/api/admin/clients", headers=auth(token), json={"name": "B", "domain": "tiny.com", "client_id": "tiny-two"})
    assert res.status_code == 403
    assert "plan" in res.json()["detail"].lower()


def test_changing_plan_applies_that_plans_limits(api, superadmin):
    tenant = make_tenant(api, superadmin, "Tiny", "owner@tiny.com", plan="free")
    res = api.put(f"/api/admin/tenants/{tenant['id']}", headers=auth(superadmin), json={"plan": "pro"})
    assert (res.json()["max_bots"], res.json()["monthly_message_quota"]) == (10, 10_000)


def test_deleting_a_tenant_removes_its_bots_and_logins(api, db, superadmin, two_tenants):
    tenant_id = two_tenants["acme"]["bot"]["tenant_id"]
    assert api.delete(f"/api/admin/tenants/{tenant_id}", headers=auth(superadmin)).status_code == 204
    assert db.query(Client).filter(Client.client_id == "acme-bot").first() is None
    assert api.get("/api/admin/clients", headers=auth(two_tenants["acme"]["token"])).status_code == 401
    assert db.query(Client).filter(Client.client_id == "globex-bot").first() is not None


# ---- API keys ----

def test_api_key_is_encrypted_at_rest_and_never_returned(api, db, two_tenants):
    token = two_tenants["acme"]["token"]
    bot_id = two_tenants["acme"]["bot"]["id"]
    res = api.put(f"/api/admin/clients/{bot_id}", headers=auth(token), json={"ai_api_key": "sk-super-secret-1234"})

    assert "sk-super-secret" not in res.text
    assert res.json()["ai_api_key_set"] is True
    assert res.json()["ai_api_key_hint"] == "…1234"
    assert "ai_api_key" not in res.json()

    stored = db.query(Client).filter(Client.client_id == "acme-bot").one().ai_api_key
    assert stored.startswith("enc:v1:") and "sk-super-secret" not in stored


def test_saving_other_fields_keeps_the_key_and_blank_removes_it(api, two_tenants):
    token, bot_id = two_tenants["acme"]["token"], two_tenants["acme"]["bot"]["id"]
    url = f"/api/admin/clients/{bot_id}"
    api.put(url, headers=auth(token), json={"ai_api_key": "sk-super-secret-1234"})

    assert api.put(url, headers=auth(token), json={"name": "Renamed", "ai_api_key": None}).json()["ai_api_key_set"] is True
    assert api.put(url, headers=auth(token), json={"ai_api_key": ""}).json()["ai_api_key_set"] is False
