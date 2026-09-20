"""Answering an enquiry by email from the Enquiries page, and knowing which button it came from."""
from app.config import settings
from tests.conftest import auth
from tests.test_verification_and_google import outbox     # noqa: F401  (fixture: email on, delivery captured)

ASK = {"name": "Dana", "email": "dana@example.com", "company": "Harbour Cafe",
       "message": "Can I get the Pro plan for two sites?", "plan": "pro", "source": "landing-pricing"}


def make_enquiry(api, **extra):
    res = api.post("/api/contact", json={**ASK, **extra})
    assert res.status_code in (200, 201), res.text
    return res


def only(api, superadmin):
    return api.get("/api/admin/enquiries", headers=auth(superadmin)).json()["items"][0]


def test_the_enquiry_records_which_button_it_came_from(api, superadmin):
    make_enquiry(api)
    item = only(api, superadmin)
    assert (item["source"], item["plan"]) == ("landing-pricing", "pro")
    make_enquiry(api, source="landing-footer", email="sam@example.com")
    sources = {e["source"] for e in api.get("/api/admin/enquiries", headers=auth(superadmin)).json()["items"]}
    assert sources == {"landing-pricing", "landing-footer"}


def test_the_operator_answers_by_email_and_the_reply_is_kept(api, superadmin, outbox):    # noqa: F811
    make_enquiry(api)
    item = only(api, superadmin)
    sent = api.post(f"/api/admin/enquiries/{item['id']}/reply", headers=auth(superadmin),
                    json={"subject": "About the Pro plan", "message": "Hi Dana,\n\nTwo sites is fine on Pro."})
    assert sent.status_code == 200, sent.text

    assert len(outbox) == 1
    message = outbox[0]
    assert message["To"] == "dana@example.com" and str(message["Subject"]) == "About the Pro plan"
    assert "Two sites is fine on Pro." in message.get_body(preferencelist=("plain",)).get_content()

    body = sent.json()
    assert body["status"] == "contacted"                       # answering moves it along by itself
    assert [r["body"] for r in body["replies"]] == ["Hi Dana,\n\nTwo sites is fine on Pro."]
    assert body["replies"][0]["delivered"] is True
    # and it is still there on the next page load
    assert len(only(api, superadmin)["replies"]) == 1


def test_replies_need_an_address_a_mail_server_and_the_operator(api, superadmin, two_tenants, outbox):   # noqa: F811
    make_enquiry(api, email=None, phone="+44 7700 900123")
    phone_only = only(api, superadmin)
    refused = api.post(f"/api/admin/enquiries/{phone_only['id']}/reply", headers=auth(superadmin), json={"message": "Hello"})
    assert refused.status_code == 400 and "phone number" in refused.json()["detail"]

    make_enquiry(api)
    item = api.get("/api/admin/enquiries", headers=auth(superadmin)).json()["items"][0]
    assert api.post(f"/api/admin/enquiries/{item['id']}/reply", headers=auth(two_tenants["acme"]["token"]),
                    json={"message": "Hello"}).status_code == 403
    assert api.post(f"/api/admin/enquiries/{item['id']}/reply", json={"message": "Hello"}).status_code == 401
    assert api.post(f"/api/admin/enquiries/{item['id']}/reply", headers=auth(superadmin), json={"message": "   "}).status_code == 422
    assert outbox == []


def test_without_a_mail_server_the_page_is_told_plainly(api, superadmin, monkeypatch):
    make_enquiry(api)
    item = only(api, superadmin)
    monkeypatch.setattr(settings, "SMTP_HOST", "")
    res = api.post(f"/api/admin/enquiries/{item['id']}/reply", headers=auth(superadmin), json={"message": "Hello"})
    assert res.status_code == 503 and "mail server" in res.json()["detail"]
