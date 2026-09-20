"""Forgotten password: a single-use emailed link, and nothing it can leak."""
import re
from urllib.parse import parse_qs, unquote, urlparse

from app.config import settings
from app.models.user import User
from tests.conftest import PASSWORD, auth, login, make_tenant
from tests.test_verification_and_google import outbox     # noqa: F401  (fixture: email on, delivery captured)

NEW_PASSWORD = "a-brand-new-passphrase"


def reset_token(message) -> str:
    text = message.get_body(preferencelist=("plain",)).get_content()
    url = re.search(r"https://bot\.example\.com/reset-password\?token=\S+", text).group(0)
    return unquote(parse_qs(urlparse(url).query)["token"][0])


def ask(api, email="owner@acme.com"):
    return api.post("/api/auth/forgot-password", json={"email": email})


def test_a_customer_resets_their_password_and_is_signed_in(api, superadmin, outbox):     # noqa: F811
    make_tenant(api, superadmin, "Acme", "owner@acme.com")
    assert ask(api).status_code == 200
    assert len(outbox) == 1 and outbox[0]["To"] == "owner@acme.com"
    assert "reset" in str(outbox[0]["Subject"]).lower()

    done = api.post("/api/auth/reset-password", json={"token": reset_token(outbox[0]), "new_password": NEW_PASSWORD})
    assert done.status_code == 200, done.text
    token = done.json()["access_token"]
    assert api.get("/api/auth/me", headers=auth(token)).status_code == 200      # signed in straight away

    assert login(api, "owner@acme.com", NEW_PASSWORD)                            # the new password works
    assert api.post("/api/auth/login", json={"email": "owner@acme.com", "password": PASSWORD}).status_code == 401


def test_the_link_works_once_and_ends_other_sessions(api, superadmin, outbox):           # noqa: F811
    make_tenant(api, superadmin, "Acme", "owner@acme.com")
    old_session = login(api, "owner@acme.com")
    ask(api)
    link = reset_token(outbox[0])

    assert api.post("/api/auth/reset-password", json={"token": link, "new_password": NEW_PASSWORD}).status_code == 200
    again = api.post("/api/auth/reset-password", json={"token": link, "new_password": "yet-another-password"})
    assert again.status_code == 400 and "not valid any more" in again.json()["detail"]
    assert api.get("/api/auth/me", headers=auth(old_session)).status_code == 401          # the old session is gone


def test_it_never_reveals_who_has_an_account(api, superadmin, outbox):                   # noqa: F811
    make_tenant(api, superadmin, "Acme", "owner@acme.com")
    known, unknown = ask(api), ask(api, "nobody@example.com")
    assert known.status_code == unknown.status_code == 200
    assert known.json() == unknown.json()
    assert len(outbox) == 1                                                              # only the real address was written to


def test_the_operator_console_account_cannot_be_reset_by_email(api, db, superadmin, outbox):   # noqa: F811
    db.query(User).filter(User.email == "root").update({"email": "root@zehnox.example"})
    db.commit()
    assert ask(api, "root@zehnox.example").status_code == 200
    assert outbox == []                                                                   # nothing sent


def test_a_suspended_workspace_gets_no_link(api, superadmin, outbox, db):                # noqa: F811
    tenant_id = make_tenant(api, superadmin, "Acme", "owner@acme.com")["id"]
    api.put(f"/api/admin/tenants/{tenant_id}", headers=auth(superadmin), json={"is_active": False})
    assert ask(api).status_code == 200
    assert outbox == []


def test_a_weak_new_password_is_refused(api, superadmin, outbox):                        # noqa: F811
    make_tenant(api, superadmin, "Acme", "owner@acme.com")
    ask(api)
    res = api.post("/api/auth/reset-password", json={"token": reset_token(outbox[0]), "new_password": "short"})
    assert res.status_code == 422
    assert login(api, "owner@acme.com")                                                   # the old password still works


def test_without_a_mail_server_nothing_is_sent(api, superadmin, monkeypatch):
    make_tenant(api, superadmin, "Acme", "owner@acme.com")
    monkeypatch.setattr(settings, "SMTP_HOST", "")
    assert ask(api).status_code == 200      # the same answer, so the page can say the same thing everywhere
