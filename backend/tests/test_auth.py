import pytest
from cryptography.fernet import Fernet

from app.config import Settings, settings
from tests.conftest import PASSWORD, auth, login, make_tenant


def test_login_rejects_wrong_password(api, superadmin):
    res = api.post("/api/auth/login", json={"email": "root", "password": "nope-nope-nope"})
    assert res.status_code == 401


def test_unknown_user_gets_same_answer_as_wrong_password(api, superadmin):
    res = api.post("/api/auth/login", json={"email": "ghost", "password": PASSWORD})
    assert res.status_code == 401
    assert res.json()["detail"] == "Invalid credentials"


def test_the_public_login_never_admits_or_reveals_the_operator(api, superadmin):
    make_tenant(api, superadmin, "Acme", "owner@acme.com")
    public = api.post("/api/auth/login", json={"email": "root", "password": PASSWORD})
    wrong = api.post("/api/auth/login", json={"email": "root", "password": "nope-nope-nope"})
    assert public.status_code == wrong.status_code == 401
    assert public.json() == wrong.json() == {"detail": "Invalid credentials"}    # same answer as a wrong password
    # the console's page is only for the operator
    assert api.post("/api/auth/login", json={"email": "owner@acme.com", "password": PASSWORD, "console": True}).status_code == 401
    assert api.post("/api/auth/login", json={"email": "owner@acme.com", "password": PASSWORD}).status_code == 200
    assert api.post("/api/auth/login", json={"email": "root", "password": PASSWORD, "console": True}).status_code == 200


def test_login_is_rate_limited_per_account(api, superadmin):
    for _ in range(settings.RATE_LOGIN_PER_ACCOUNT_PER_5MIN):
        api.post("/api/auth/login", json={"email": "root", "password": "wrong-password"})
    res = api.post("/api/auth/login", json={"email": "root", "password": PASSWORD})
    assert res.status_code == 429


def test_admin_routes_need_a_token(api):
    assert api.get("/api/admin/clients").status_code == 401
    assert api.get("/api/admin/clients", headers=auth("garbage")).status_code == 401


def test_password_change_revokes_old_tokens(api, superadmin):
    res = api.post(
        "/api/auth/change-credentials",
        headers=auth(superadmin),
        json={"current_password": PASSWORD, "new_password": "a-brand-new-password"},
    )
    assert res.status_code == 200
    assert api.get("/api/auth/me", headers=auth(superadmin)).status_code == 401
    assert api.get("/api/auth/me", headers=auth(res.json()["access_token"])).status_code == 200


def test_weak_new_password_is_refused(api, superadmin):
    res = api.post(
        "/api/auth/change-credentials",
        headers=auth(superadmin),
        json={"current_password": PASSWORD, "new_password": "short"},
    )
    assert res.status_code == 422


def test_signup_creates_an_isolated_tenant(api):
    res = api.post("/api/auth/signup", json={"company_name": "Initech", "email": "bill@initech.com", "password": PASSWORD})
    assert res.status_code == 201
    me = api.get("/api/auth/me", headers=auth(res.json()["access_token"])).json()
    assert me["role"] == "tenant_admin"
    assert me["tenant"]["name"] == "Initech"
    assert me["tenant"]["plan"] == settings.DEFAULT_SIGNUP_PLAN


def test_signup_can_be_switched_off(api, monkeypatch):
    monkeypatch.setattr(settings, "ALLOW_SIGNUP", False)
    res = api.post("/api/auth/signup", json={"company_name": "Initech", "email": "bill@initech.com", "password": PASSWORD})
    assert res.status_code == 403


def test_signup_refuses_duplicate_email(api):
    body = {"company_name": "Initech", "email": "bill@initech.com", "password": PASSWORD}
    assert api.post("/api/auth/signup", json=body).status_code == 201
    assert api.post("/api/auth/signup", json=body).status_code == 409


def test_suspended_tenant_cannot_log_in_or_use_tokens(api, superadmin):
    tenant = make_tenant(api, superadmin, "Acme", "owner@acme.com")
    token = login(api, "owner@acme.com")
    api.put(f"/api/admin/tenants/{tenant['id']}", headers=auth(superadmin), json={"is_active": False})

    assert api.get("/api/admin/clients", headers=auth(token)).status_code == 403
    assert api.post("/api/auth/login", json={"email": "owner@acme.com", "password": PASSWORD}).status_code == 403


def test_production_refuses_to_start_with_weak_secrets():
    base = dict(DATABASE_URL="sqlite://", ENVIRONMENT="production", _env_file=None)
    with pytest.raises(ValueError, match="SECRET_KEY"):
        Settings(SECRET_KEY="changeme", ENCRYPTION_KEY=Fernet.generate_key().decode(), **base)
    with pytest.raises(ValueError, match="ENCRYPTION_KEY"):
        Settings(SECRET_KEY="s" * 40, ENCRYPTION_KEY="", **base)
    with pytest.raises(ValueError, match="not a valid Fernet key"):
        Settings(SECRET_KEY="s" * 40, ENCRYPTION_KEY="not-a-real-key", **base)


def test_wildcard_is_never_an_allowed_admin_origin():
    s = Settings(DATABASE_URL="sqlite://", SECRET_KEY="s" * 40, ENCRYPTION_KEY=Fernet.generate_key().decode(), ALLOWED_ORIGINS='["*", "https://ops.example.com/"]', _env_file=None)
    assert s.allowed_origins_list == ["https://ops.example.com"]
