"""Email verification on sign-up, and Sign in with Google. Both are off until configured."""
import re
from urllib.parse import parse_qs, unquote, urlparse

import pytest

from app.config import settings
from app.models.tenant import Tenant
from app.models.user import User
from app.services import google_service
from app.services.auth_service import create_email_verification_token, has_usable_password
from tests.conftest import PASSWORD, auth, login, make_tenant

SIGNUP = {"company_name": "Initech", "email": "bill@initech.com", "password": PASSWORD}


@pytest.fixture
def outbox(monkeypatch):
    """Email switched on, with the SMTP delivery replaced by a list."""
    sent = []
    monkeypatch.setattr(settings, "SMTP_HOST", "smtp.test")
    monkeypatch.setattr(settings, "SMTP_FROM", "ZehnBot <no-reply@zehnbot.test>")
    monkeypatch.setattr(settings, "PUBLIC_BASE_URL", "https://bot.example.com/")
    monkeypatch.setattr("app.services.email_service._deliver", lambda message: sent.append(message))
    return sent


def link_token(message) -> str:
    text = message.get_body(preferencelist=("plain",)).get_content()
    url = re.search(r"https://bot\.example\.com/verify-email\?token=\S+", text).group(0)
    return unquote(parse_qs(urlparse(url).query)["token"][0])


# ---------- email verification ----------

def test_without_a_mail_server_signup_works_exactly_as_before(api):
    res = api.post("/api/auth/signup", json=SIGNUP)
    assert res.status_code == 201 and res.json()["access_token"] and res.json()["verification_required"] is False
    config = api.get("/api/auth/config").json()
    assert config["email_verification"] is False and config["google_enabled"] is False


def test_signup_sends_a_link_and_gives_no_session_until_it_is_used(api, outbox, db):
    res = api.post("/api/auth/signup", json=SIGNUP)
    assert res.status_code == 201
    assert res.json() == {"access_token": None, "token_type": "bearer", "verification_required": True}
    assert len(outbox) == 1 and outbox[0]["To"] == "bill@initech.com"
    assert "Confirm" in outbox[0]["Subject"]

    blocked = api.post("/api/auth/login", json={"email": "bill@initech.com", "password": PASSWORD})
    assert blocked.status_code == 403 and blocked.headers["x-auth-reason"] == "email-unverified"
    # a wrong password still says nothing about the account
    assert api.post("/api/auth/login", json={"email": "bill@initech.com", "password": "not-the-password"}).status_code == 401

    confirmed = api.post("/api/auth/verify-email", json={"token": link_token(outbox[0])})
    assert confirmed.status_code == 200
    me = api.get("/api/auth/me", headers=auth(confirmed.json()["access_token"])).json()
    assert me["email"] == "bill@initech.com" and me["tenant"]["name"] == "Initech"
    assert db.query(User).filter(User.email == "bill@initech.com").one().email_verified_at is not None
    assert login(api, "bill@initech.com")                                  # and the password works from now on


def test_a_verification_link_is_not_a_session_and_a_session_is_not_a_link(api, outbox):
    api.post("/api/auth/signup", json=SIGNUP)
    token = link_token(outbox[0])
    assert api.get("/api/auth/me", headers=auth(token)).status_code == 401
    session = api.post("/api/auth/verify-email", json={"token": token}).json()["access_token"]
    assert api.post("/api/auth/verify-email", json={"token": session}).status_code == 400
    assert api.post("/api/auth/verify-email", json={"token": "x" * 40}).status_code == 400


def test_a_link_dies_when_the_address_changes(api, outbox, db):
    api.post("/api/auth/signup", json=SIGNUP)
    user = db.query(User).filter(User.email == "bill@initech.com").one()
    stale = create_email_verification_token(str(user.id), "someone-else@initech.com")
    assert api.post("/api/auth/verify-email", json={"token": stale}).status_code == 400


def test_resend_never_reveals_who_has_an_account(api, outbox):
    api.post("/api/auth/signup", json=SIGNUP)
    known = api.post("/api/auth/resend-verification", json={"email": "BILL@initech.com"})
    unknown = api.post("/api/auth/resend-verification", json={"email": "nobody@initech.com"})
    assert known.status_code == unknown.status_code == 200 and known.json() == unknown.json()
    assert len(outbox) == 2                                                # only the real, unconfirmed address got mail
    for _ in range(3):
        api.post("/api/auth/resend-verification", json={"email": "bill@initech.com"})
    assert api.post("/api/auth/resend-verification", json={"email": "bill@initech.com"}).status_code == 429


def test_whoever_owns_the_inbox_wins_an_unconfirmed_address(api, outbox, db):
    """Someone registers your address first. They never get in, and you can still sign up."""
    api.post("/api/auth/signup", json={**SIGNUP, "password": "the-squatters-password"})
    mine = api.post("/api/auth/signup", json={**SIGNUP, "company_name": "Initech Ltd", "password": "the-real-owners-password"})
    assert mine.status_code == 201 and mine.json()["verification_required"] is True
    assert db.query(User).filter(User.email == "bill@initech.com").count() == 1
    api.post("/api/auth/verify-email", json={"token": link_token(outbox[-1])})
    assert api.post("/api/auth/login", json={"email": "bill@initech.com", "password": "the-squatters-password"}).status_code == 401
    assert login(api, "bill@initech.com", "the-real-owners-password")
    assert db.query(Tenant).one().name == "Initech Ltd"


def test_a_confirmed_address_cannot_be_registered_again(api, outbox):
    api.post("/api/auth/signup", json=SIGNUP)
    api.post("/api/auth/verify-email", json={"token": link_token(outbox[0])})
    assert api.post("/api/auth/signup", json={**SIGNUP, "password": "another-long-password"}).status_code == 409
    assert login(api, "bill@initech.com")


def test_logins_made_by_the_operator_and_the_operator_are_never_locked_out(api, superadmin, outbox):
    make_tenant(api, superadmin, "Acme", "owner@acme.com")
    assert login(api, "owner@acme.com")
    assert login(api, "root", console=True)


def test_a_failing_mail_server_does_not_fail_the_signup(api, monkeypatch):
    monkeypatch.setattr(settings, "SMTP_HOST", "smtp.test")
    monkeypatch.setattr(settings, "SMTP_FROM", "no-reply@zehnbot.test")

    def down(message):
        raise OSError("connection refused")

    monkeypatch.setattr("app.services.email_service._deliver", down)
    assert api.post("/api/auth/signup", json=SIGNUP).status_code == 201


# ---------- Sign in with Google ----------

@pytest.fixture
def google(monkeypatch):
    monkeypatch.setattr(settings, "GOOGLE_CLIENT_ID", "client-id.apps.googleusercontent.com")
    monkeypatch.setattr(settings, "GOOGLE_CLIENT_SECRET", "client-secret")
    monkeypatch.setattr(settings, "PUBLIC_BASE_URL", "https://bot.example.com")
    who = {"identity": google_service.GoogleIdentity(sub="google-sub-1", email="dana@harbourcafe.example", name="Dana Whitfield")}

    def exchange(code):
        if code != "good-code":
            raise google_service.GoogleSignInError("bad code")
        return who["identity"]

    monkeypatch.setattr(google_service, "exchange_code", exchange)
    return who


def sign_in(api, code="good-code"):
    start = api.get("/api/auth/google/start", follow_redirects=False)
    assert start.status_code == 303
    target = urlparse(start.headers["location"])
    query = parse_qs(target.query)
    assert target.netloc == "accounts.google.com"
    assert query["redirect_uri"] == ["https://bot.example.com/api/auth/google/callback"] and query["scope"] == ["openid email profile"]
    cookie = start.headers["set-cookie"]
    assert "HttpOnly" in cookie and "Secure" in cookie and "SameSite=lax" in cookie
    # the test client speaks plain http, where a Secure cookie is (rightly) not replayed: hand it over ourselves
    saved = re.search(r"zb_g_state=([^;]+)", cookie).group(1)
    return api.get(f"/api/auth/google/callback?code={code}&state={query['state'][0]}", headers={"Cookie": f"zb_g_state={saved}"}, follow_redirects=False)


def token_from(response) -> str:
    assert response.status_code == 303 and response.headers["location"].startswith("/auth/callback#token="), response.headers
    return response.headers["location"].split("#token=")[1]


def test_google_is_absent_until_configured(api):
    assert api.get("/api/auth/google/start", follow_redirects=False).status_code == 404
    assert api.get("/api/auth/google/callback?code=x&state=y", follow_redirects=False).status_code == 404


def test_a_new_google_user_gets_a_workspace_and_a_session(api, google, db):
    assert api.get("/api/auth/config").json()["google_enabled"] is True
    me = api.get("/api/auth/me", headers=auth(token_from(sign_in(api)))).json()
    assert me["email"] == "dana@harbourcafe.example" and me["tenant"]["name"] == "Dana Whitfield" and me["tenant"]["plan"] == "free"
    assert me["has_password"] is False and me["google_linked"] is True
    user = db.query(User).one()
    assert user.email_verified_at is not None and not has_usable_password(user.hashed_password)
    # there is no password to guess
    assert api.post("/api/auth/login", json={"email": "dana@harbourcafe.example", "password": user.hashed_password}).status_code == 401

    again = api.get("/api/auth/me", headers=auth(token_from(sign_in(api)))).json()
    assert again["id"] == me["id"] and db.query(Tenant).count() == 1        # second visit: same account, no duplicate


def test_the_state_cookie_stops_a_sign_in_started_by_someone_else(api, google, db):
    api.get("/api/auth/google/start", follow_redirects=False)
    forged = api.get("/api/auth/google/callback?code=good-code&state=attacker-chosen", follow_redirects=False)
    assert forged.headers["location"] == "/login?google=failed"
    api.cookies.clear()
    no_cookie = api.get("/api/auth/google/callback?code=good-code&state=anything", follow_redirects=False)
    assert no_cookie.headers["location"] == "/login?google=failed"
    assert db.query(User).count() == 0


def test_google_failures_go_back_to_the_login_page(api, google):
    assert sign_in(api, code="bad-code").headers["location"] == "/login?google=failed"
    api.get("/api/auth/google/start", follow_redirects=False)
    assert api.get("/api/auth/google/callback?error=access_denied", follow_redirects=False).headers["location"] == "/login?google=cancelled"


def test_google_links_to_an_existing_verified_login_and_keeps_its_password(api, superadmin, google, db):
    make_tenant(api, superadmin, "Harbour Cafe", "dana@harbourcafe.example")
    me = api.get("/api/auth/me", headers=auth(token_from(sign_in(api)))).json()
    assert me["tenant"]["name"] == "Harbour Cafe" and me["has_password"] is True and db.query(Tenant).count() == 1
    assert login(api, "dana@harbourcafe.example")


def test_google_disarms_a_password_planted_on_an_unconfirmed_address(api, google, outbox, db):
    """Pre-hijacking: an attacker registers the victim's address with a password they know, then waits."""
    api.post("/api/auth/signup", json={"company_name": "Trap", "email": "dana@harbourcafe.example", "password": "attackers-known-password"})
    token_from(sign_in(api))
    assert api.post("/api/auth/login", json={"email": "dana@harbourcafe.example", "password": "attackers-known-password"}).status_code == 401
    assert db.query(User).one().google_sub == "google-sub-1"


def test_google_cannot_create_accounts_when_signup_is_closed(api, google, monkeypatch, db):
    monkeypatch.setattr(settings, "ALLOW_SIGNUP", False)
    assert sign_in(api).headers["location"] == "/login?google=no-account"
    assert db.query(User).count() == 0


def test_a_suspended_workspace_cannot_come_in_through_google(api, google, db):
    token_from(sign_in(api))
    tenant = db.query(Tenant).one()
    tenant.is_active = False
    db.commit()
    assert sign_in(api).headers["location"] == "/login?google=suspended"


def test_a_google_only_login_can_set_its_first_password(api, google):
    token = token_from(sign_in(api))
    res = api.post("/api/auth/change-credentials", headers=auth(token), json={"new_password": "a-brand-new-password"})
    assert res.status_code == 200, res.text
    assert login(api, "dana@harbourcafe.example", "a-brand-new-password")
    fresh = res.json()["access_token"]
    # from now on the current password is required again
    assert api.post("/api/auth/change-credentials", headers=auth(fresh), json={"new_password": "yet-another-password"}).status_code == 401


# ---------- no mail server, no open sign-up ----------

def test_signup_stays_closed_when_nobody_could_verify_an_address(api, monkeypatch, db):
    """ALLOW_SIGNUP=true on a server that cannot send email must not mean 'register any address you like'."""
    monkeypatch.setattr(settings, "ALLOW_UNVERIFIED_SIGNUP", False)
    assert api.get("/api/auth/config").json()["allow_signup"] is False
    assert api.post("/api/auth/signup", json=SIGNUP).status_code == 403
    assert db.query(User).count() == 0


def test_a_mail_server_opens_signup_and_every_account_is_verified(api, monkeypatch, outbox, db):
    monkeypatch.setattr(settings, "ALLOW_UNVERIFIED_SIGNUP", False)
    assert api.get("/api/auth/config").json()["allow_signup"] is True
    assert api.post("/api/auth/signup", json=SIGNUP).json()["verification_required"] is True
    assert api.post("/api/auth/login", json={"email": "bill@initech.com", "password": PASSWORD}).status_code == 403


def test_google_can_still_create_accounts_without_a_mail_server(api, monkeypatch, google, db):
    monkeypatch.setattr(settings, "ALLOW_UNVERIFIED_SIGNUP", False)
    config = api.get("/api/auth/config").json()
    assert config["allow_signup"] is False and config["google_signup"] is True     # Google verified the address already
    token_from(sign_in(api))
    assert db.query(User).one().email_verified_at is not None


def test_the_operator_is_told_why_signup_is_closed(api, superadmin, monkeypatch):
    monkeypatch.setattr(settings, "ALLOW_UNVERIFIED_SIGNUP", False)
    system = api.get("/api/admin/overview/platform", headers=auth(superadmin)).json()["system"]
    assert system["signup_wanted"] is True and system["signup_open"] is False and system["email_verification"] is False
