"""Deleting one person's data: what a bot's owner needs when a visitor asks to be forgotten."""
from app.models.conversation import Conversation, Message
from app.models.lead import Lead
from tests.conftest import auth
from tests.test_chat import say

ACME = {"Origin": "https://www.acme.com"}


def a_chat_with_a_lead(api, db):
    """One visitor: a conversation with messages, and their details captured from it."""
    assert say(api, "Do you deliver?", session="visitor-11111111").status_code == 200
    conversation = db.query(Conversation).filter(Conversation.session_id == "visitor-11111111").first()
    res = api.post("/api/leads/capture", headers=ACME, json={
        "client_id": "acme-bot", "conversation_id": str(conversation.id),
        "name": "Dana", "email": "dana@example.com", "phone": None,
    })
    assert res.status_code in (200, 201), res.text
    lead = db.query(Lead).filter(Lead.email == "dana@example.com").first()
    return conversation.id, lead.id      # plain ids: the rows are about to be deleted under us


def test_the_owner_deletes_one_lead_and_keeps_the_bot(api, db, two_tenants, fake_ai):
    token = two_tenants["acme"]["token"]
    bot_uuid = next(b["id"] for b in api.get("/api/admin/clients", headers=auth(token)).json() if b["client_id"] == "acme-bot")
    conversation_id, lead_id = a_chat_with_a_lead(api, db)

    gone = api.delete(f"/api/admin/clients/{bot_uuid}/leads/{lead_id}", headers=auth(token))
    assert gone.status_code == 204
    db.expire_all()
    assert db.query(Lead).filter(Lead.id == lead_id).first() is None
    assert db.query(Conversation).filter(Conversation.id == conversation_id).first() is not None   # transcript kept
    assert api.get(f"/api/admin/clients/{bot_uuid}", headers=auth(token)).status_code == 200       # the bot is untouched


def test_everything_about_one_person_can_go_in_one_request(api, db, two_tenants, fake_ai):
    token = two_tenants["acme"]["token"]
    bot_uuid = next(b["id"] for b in api.get("/api/admin/clients", headers=auth(token)).json() if b["client_id"] == "acme-bot")
    conversation_id, lead_id = a_chat_with_a_lead(api, db)

    gone = api.delete(f"/api/admin/clients/{bot_uuid}/leads/{lead_id}?transcript=true", headers=auth(token))
    assert gone.status_code == 204
    db.expire_all()
    assert db.query(Lead).filter(Lead.id == lead_id).first() is None
    assert db.query(Conversation).filter(Conversation.id == conversation_id).first() is None
    assert db.query(Message).filter(Message.conversation_id == conversation_id).count() == 0


def test_a_conversation_can_be_deleted_on_its_own(api, db, two_tenants, fake_ai):
    token = two_tenants["acme"]["token"]
    bot_uuid = next(b["id"] for b in api.get("/api/admin/clients", headers=auth(token)).json() if b["client_id"] == "acme-bot")
    conversation_id, lead_id = a_chat_with_a_lead(api, db)

    gone = api.delete(f"/api/admin/clients/{bot_uuid}/conversations/{conversation_id}", headers=auth(token))
    assert gone.status_code == 204
    db.expire_all()
    assert db.query(Conversation).filter(Conversation.id == conversation_id).first() is None
    assert db.query(Message).filter(Message.conversation_id == conversation_id).count() == 0
    kept = db.query(Lead).filter(Lead.id == lead_id).first()
    assert kept is not None and kept.conversation_id is None      # the details stay, the link does not


def test_nobody_can_delete_another_tenants_records(api, db, two_tenants, fake_ai):
    acme, globex = two_tenants["acme"]["token"], two_tenants["globex"]["token"]
    bot_uuid = next(b["id"] for b in api.get("/api/admin/clients", headers=auth(acme)).json() if b["client_id"] == "acme-bot")
    conversation_id, lead_id = a_chat_with_a_lead(api, db)

    assert api.delete(f"/api/admin/clients/{bot_uuid}/leads/{lead_id}", headers=auth(globex)).status_code == 404
    assert api.delete(f"/api/admin/clients/{bot_uuid}/conversations/{conversation_id}", headers=auth(globex)).status_code == 404
    assert api.delete(f"/api/admin/clients/{bot_uuid}/leads/{lead_id}").status_code == 401
    db.expire_all()
    assert db.query(Lead).filter(Lead.id == lead_id).first() is not None
