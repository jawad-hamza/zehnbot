"""Streaming replies, control tags, leads captured from chat, insights, search and export."""
import csv
import io
import json
import uuid
from datetime import datetime, timedelta, timezone

import pytest

from app.models.conversation import Conversation, Message
from app.models.lead import Lead
from app.services.ai_service import AIProviderError
from app.services.chat_service import LEAD_FORM_FALLBACK_AFTER, TagFilter, parse_reply
from app.services.knowledge_service import _fuse
from app.services.lead_service import extract_contact_details
from tests.conftest import auth

ACME = {"Origin": "https://www.acme.com"}


def say(api, text="Hello", session="session-12345678", path="/api/chat/message", headers=ACME):
    return api.post(path, headers=headers, json={"client_id": "acme-bot", "session_id": session, "message": text})


def reply_with(monkeypatch, text):
    monkeypatch.setattr("app.services.chat_service.chat_completion", lambda *a, **k: (text, 10))


def stream_with(monkeypatch, pieces, tokens=33, fail_after=None):
    def fake(messages, endpoint, api_key, usage):
        for i, piece in enumerate(pieces):
            if fail_after is not None and i == fail_after:
                raise AIProviderError("RateLimitError: upstream said no, key sk-live-abc")
            yield piece
        usage["tokens"] = tokens

    monkeypatch.setattr("app.services.chat_service.stream_completion", fake)


def events(response):
    return [json.loads(line[len("data: "):]) for line in response.text.split("\n\n") if line.startswith("data: ")]


# ---- control tags ----

def test_tags_are_removed_even_when_split_across_stream_chunks():
    tags = TagFilter()
    pieces = ["Happy to help! Want a quote? ", "[[LE", "AD_FO", "RM]]"]
    shown = "".join(tags.feed(p) for p in pieces) + tags.finish()
    assert shown == "Happy to help! Want a quote? "
    assert tags.lead_form and not tags.unanswered


def test_text_is_never_held_back_longer_than_a_possible_tag():
    tags = TagFilter()
    assert tags.feed("Prices [see list") == "Prices [see list"      # "[s" cannot start a tag: released at once
    assert tags.feed(" and array[[0]] ok") == " and array[[0]] ok"
    assert tags.feed("trailing [[") == "trailing"                   # could still become a tag: held
    assert tags.finish() == " [["                                   # it did not: released at the end
    assert not tags.lead_form and not tags.unanswered


def test_both_tags_any_case_anywhere():
    assert parse_reply("I don't have that. [[unanswered]] Shall I pass you on? [[LEAD_FORM]]") == (
        "I don't have that.  Shall I pass you on?", True, True,
    )


def test_lead_form_tag_opens_the_form_and_never_reaches_the_visitor_or_the_transcript(api, db, two_tenants, monkeypatch):
    reply_with(monkeypatch, "We'd love to quote that. What's the best email for you? [[LEAD_FORM]]")
    body = say(api, "how much for a website?").json()

    assert body["reply"] == "We'd love to quote that. What's the best email for you?"
    assert body["show_lead_form"] is True and body["lead_captured"] is False
    assert "[[" not in db.query(Message).filter(Message.role == "assistant").one().content


def test_without_the_tag_the_form_is_offered_only_in_a_long_conversation(api, two_tenants, monkeypatch):
    reply_with(monkeypatch, "Sure thing.")
    shown = [say(api, f"question {i}").json()["show_lead_form"] for i in range(LEAD_FORM_FALLBACK_AFTER)]
    assert shown == [False] * (LEAD_FORM_FALLBACK_AFTER - 1) + [True]


# ---- leads typed into the chat ----

@pytest.mark.parametrize("message,email,phone,name", [
    ("sure, it's Sam.Jones@Example.com.", "sam.jones@example.com", None, None),
    ("My name is Priya Patel, reach me at priya@shop.co.uk or +44 20 7946 0958", "priya@shop.co.uk", "+44 20 7946 0958", "Priya Patel"),
    ("call me on 07123456789 please", None, "07123456789", None),
    ("my order number is 1234567890", None, None, None),               # digits, but nothing says "phone"
    ("it costs 12500000 and I'm Interested", None, None, None),
    ("I'm Dana, email dana@x.io", "dana@x.io", None, "Dana"),
])
def test_contact_details_are_recognised_conservatively(message, email, phone, name):
    found = extract_contact_details(message)
    assert (found.email, found.phone, found.name) == (email, phone, name)


def test_details_typed_in_chat_become_a_lead_and_the_bot_stops_asking(api, db, two_tenants, fake_ai):
    body = say(api, "I'm Dana, you can email me at dana@example.com").json()

    assert body["lead_captured"] is True and body["show_lead_form"] is False
    lead = db.query(Lead).one()
    assert (lead.email, lead.name, lead.source) == ("dana@example.com", "Dana", "chat")
    assert "dana@example.com" in lead.raw_context
    assert "already shared their contact details" in fake_ai[-1]["messages"][0]["content"]


def test_form_and_chat_details_merge_into_one_lead_per_conversation(api, db, two_tenants, fake_ai):
    conversation_id = say(api, "reach me at dana@example.com").json()["conversation_id"]
    res = api.post("/api/leads/capture", headers=ACME, json={
        "client_id": "acme-bot", "conversation_id": conversation_id, "name": "Dana Scully", "phone": "+1 202 555 0143",
    })
    assert res.status_code == 201

    lead = db.query(Lead).one()
    assert (lead.email, lead.name, lead.phone) == ("dana@example.com", "Dana Scully", "+1 202 555 0143")


# ---- streaming ----

def test_stream_delivers_the_reply_in_pieces_then_a_summary(api, db, superadmin, two_tenants, monkeypatch):
    stream_with(monkeypatch, ["We open ", "at nine. ", "Want us to call you? [[LEAD", "_FORM]]"])
    res = say(api, "when do you open?", path="/api/chat/stream")

    assert res.status_code == 200 and res.headers["content-type"].startswith("text/event-stream")
    got = events(res)
    assert [e["type"] for e in got] == ["delta", "delta", "delta", "done"]
    assert "".join(e["text"] for e in got[:-1]) == "We open at nine. Want us to call you?"
    assert got[-1]["show_lead_form"] is True and uuid.UUID(got[-1]["conversation_id"])

    stored = [(m.role, m.content, m.tokens_used) for m in db.query(Message).order_by(Message.created_at)]
    assert stored == [("user", "when do you open?", None), ("assistant", "We open at nine. Want us to call you?", 33)]
    tenant_id = two_tenants["acme"]["bot"]["tenant_id"]
    usage = api.get(f"/api/admin/tenants/{tenant_id}", headers=auth(superadmin)).json()
    assert (usage["messages_this_month"], usage["tokens_this_month"]) == (1, 33)


def test_stream_failure_is_reported_in_band_without_leaking_detail(api, db, two_tenants, monkeypatch):
    stream_with(monkeypatch, ["We open ", "never reached"], fail_after=1)
    res = say(api, path="/api/chat/stream")

    got = events(res)
    assert [e["type"] for e in got] == ["delta", "error"]
    assert "sk-live" not in res.text and "RateLimitError" not in res.text
    assert db.query(Message).filter(Message.role == "assistant").count() == 0   # no half reply in the transcript


def test_stream_refuses_with_real_status_codes_before_it_starts(api, superadmin, two_tenants, monkeypatch):
    stream_with(monkeypatch, ["never sent"])
    assert say(api, path="/api/chat/stream", headers={"Origin": "https://evil.example"}).status_code == 403
    assert say(api, "x" * 2001, path="/api/chat/stream").status_code == 422

    tenant_id = two_tenants["acme"]["bot"]["tenant_id"]
    api.put(f"/api/admin/tenants/{tenant_id}", headers=auth(superadmin), json={"monthly_message_quota": 0})
    assert say(api, path="/api/chat/stream").status_code == 429


def test_streaming_shares_the_rate_limit_budget_of_the_plain_endpoint(api, two_tenants, fake_ai, monkeypatch):
    from app.config import settings
    stream_with(monkeypatch, ["ok"])
    for _ in range(settings.RATE_CHAT_PER_SESSION_PER_MIN):
        assert say(api).status_code == 200
    assert say(api, path="/api/chat/stream").status_code == 429


# ---- insights ----

def test_insights_count_activity_and_list_what_the_bot_could_not_answer(api, db, two_tenants, monkeypatch):
    reply_with(monkeypatch, "We open at nine.")
    say(api, "when do you open?", session="session-aaaaaaaa")
    reply_with(monkeypatch, "I'm afraid I don't have that. [[UNANSWERED]]")
    say(api, "do you ship to Norway?", session="session-bbbbbbbb")
    say(api, "reach me on nora@example.com", session="session-bbbbbbbb")

    # something from long ago must fall outside the window
    old = Conversation(client_id=uuid.UUID(two_tenants["acme"]["bot"]["id"]), session_id="session-old00000",
                       started_at=datetime.now(timezone.utc) - timedelta(days=90))
    db.add(old)
    db.commit()

    bot_id, headers = two_tenants["acme"]["bot"]["id"], auth(two_tenants["acme"]["token"])
    data = api.get(f"/api/admin/clients/{bot_id}/analytics?days=7", headers=headers).json()

    assert (data["conversations"], data["visitor_messages"], data["leads"], data["unanswered"]) == (2, 3, 1, 2)
    assert data["lead_conversion_rate"] == 0.5
    assert data["answer_rate"] == pytest.approx(1 / 3, abs=0.001)
    assert len(data["daily"]) == 7 and data["daily"][-1] == {
        "date": datetime.now(timezone.utc).date().isoformat(), "conversations": 2, "visitor_messages": 3, "leads": 1,
    }
    assert sum(day["conversations"] for day in data["daily"][:-1]) == 0
    assert {q["question"] for q in data["unanswered_questions"]} == {"do you ship to Norway?", "reach me on nora@example.com"}


def test_insights_search_and_export_are_tenant_scoped(api, two_tenants):
    victim, intruder = two_tenants["globex"]["bot"]["id"], auth(two_tenants["acme"]["token"])
    for path in ("analytics", "conversations?q=secret", "leads/export"):
        assert api.get(f"/api/admin/clients/{victim}/{path}", headers=intruder).status_code == 404


def test_conversation_search_treats_the_query_as_text_not_a_pattern(api, two_tenants, fake_ai):
    say(api, "Do you offer a 100% refund?", session="session-refund00")
    say(api, "What are your opening hours", session="session-hours000")
    bot_id, headers = two_tenants["acme"]["bot"]["id"], auth(two_tenants["acme"]["token"])
    url = f"/api/admin/clients/{bot_id}/conversations"

    def found(q):
        return [c["session_id"] for c in api.get(url, headers=headers, params={"q": q}).json()["items"]]

    assert found("REFUND") == ["session-refund00"]            # case-insensitive
    assert sorted(found("from the bot")) == ["session-hours000", "session-refund00"]   # bot replies are searched too
    assert found("100%") == ["session-refund00"]
    assert found("%") == ["session-refund00"]                 # a literal percent sign, not "match everything"
    assert found("_____") == []
    assert api.get(url, headers=headers, params={"q": "nothing like this"}).json()["total"] == 0


def test_lead_export_is_a_spreadsheet_safe_csv(api, db, two_tenants):
    api.post("/api/leads/capture", headers=ACME, json={"client_id": "acme-bot", "name": "=HYPERLINK(\"http://evil\")", "email": "x@example.com"})
    api.post("/api/leads/capture", headers=ACME, json={"client_id": "acme-bot", "name": "Zoë Müller", "phone": "+44 20 7946 0958"})

    bot_id = two_tenants["acme"]["bot"]["id"]
    res = api.get(f"/api/admin/clients/{bot_id}/leads/export", headers=auth(two_tenants["acme"]["token"]))

    assert res.status_code == 200 and res.headers["content-type"].startswith("text/csv")
    assert 'filename="leads-acme-bot.csv"' in res.headers["content-disposition"]
    assert res.content.startswith(b"\xef\xbb\xbf")             # BOM, so Excel reads the umlauts
    rows = list(csv.DictReader(io.StringIO(res.content.decode("utf-8-sig"))))
    by_email = {r["email"]: r for r in rows}
    assert by_email["x@example.com"]["name"].startswith("'=")  # would otherwise execute as a formula
    assert {r["name"] for r in rows} >= {"Zoë Müller"}
    assert {r["phone"] for r in rows} >= {"'+44 20 7946 0958"}


# ---- hybrid retrieval ----

def test_rank_fusion_prefers_passages_both_methods_agree_on():
    keyword, semantic = ["a", "b", "c"], ["c", "d", "a"]
    fused = _fuse([keyword, semantic])
    assert set(fused[:2]) == {"a", "c"} and set(fused) == {"a", "b", "c", "d"}
    assert _fuse([keyword]) == keyword and _fuse([]) == []
