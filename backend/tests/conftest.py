"""Test harness. Runs against SQLite so no services are needed; the Postgres-only pieces
(migrations, full-text search) are exercised by the Docker stack instead."""
import os
import sys
import tempfile

import pytest
from cryptography.fernet import Fernet

# Configuration must be in place before the app is imported
_DB_FILE = os.path.join(tempfile.mkdtemp(prefix="chatbot-tests-"), "test.db")
os.environ.update(
    ENVIRONMENT="development",
    DATABASE_URL=f"sqlite:///{_DB_FILE}",
    SECRET_KEY="test-secret-key-that-is-long-enough-0123456789",
    ENCRYPTION_KEY=Fernet.generate_key().decode(),
    ALLOW_SIGNUP="true",
    ALLOW_UNVERIFIED_SIGNUP="true",     # most tests sign up without a mail server; the gate has tests of its own
    PLATFORM_AI_API_KEY="platform-test-key",
    OPENAI_API_KEY="",
    REDIS_URL="",
    ALLOWED_ORIGINS="",
    ENFORCE_WIDGET_ORIGIN="true",
)
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from fastapi.testclient import TestClient  # noqa: E402

import app.models  # noqa: E402,F401
from app.database import Base, SessionLocal, engine  # noqa: E402
from app.main import app  # noqa: E402
from app.models.user import User, ROLE_SUPERADMIN  # noqa: E402
from app.services import rate_limit  # noqa: E402
from app.services.auth_service import hash_password  # noqa: E402

PASSWORD = "correct-horse-battery"


@pytest.fixture(autouse=True)
def fresh_state(monkeypatch):
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    rate_limit.reset_for_tests()
    # Limits use fixed clock windows; a test straddling a minute boundary would see its counter reset
    monkeypatch.setattr(rate_limit, "_now", lambda: 1_700_000_000.0)
    yield


@pytest.fixture
def db():
    session = SessionLocal()
    yield session
    session.close()


@pytest.fixture
def api():
    return TestClient(app)


@pytest.fixture
def fake_ai(monkeypatch):
    """Replaces the provider call. `calls` records what the model would have been sent."""
    calls = []

    def _fake(messages, endpoint, api_key):
        calls.append({"messages": messages, "endpoint": endpoint, "provider": endpoint.provider, "model": endpoint.model, "api_key": api_key})
        return "Hello from the bot", 42

    monkeypatch.setattr("app.services.chat_service.chat_completion", _fake)
    return calls


def auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def login(api, email: str, password: str = PASSWORD) -> str:
    res = api.post("/api/auth/login", json={"email": email, "password": password})
    assert res.status_code == 200, res.text
    return res.json()["access_token"]


@pytest.fixture
def superadmin(api, db):
    db.add(User(email="root", hashed_password=hash_password(PASSWORD), role=ROLE_SUPERADMIN))
    db.commit()
    return login(api, "root")


def make_tenant(api, superadmin_token: str, name: str, email: str, plan: str = "starter") -> dict:
    res = api.post(
        "/api/admin/tenants",
        headers=auth(superadmin_token),
        json={"name": name, "plan": plan, "owner_email": email, "owner_password": PASSWORD},
    )
    assert res.status_code == 201, res.text
    return res.json()


def make_bot(api, token: str, slug: str, domain: str = "acme.com", **extra) -> dict:
    res = api.post(
        "/api/admin/clients",
        headers=auth(token),
        json={"name": f"Bot {slug}", "domain": domain, "client_id": slug, **extra},
    )
    assert res.status_code == 201, res.text
    return res.json()


@pytest.fixture
def two_tenants(api, superadmin):
    """Two independent customers, each logged in, each with one bot."""
    make_tenant(api, superadmin, "Acme", "owner@acme.com")
    make_tenant(api, superadmin, "Globex", "owner@globex.com")
    acme, globex = login(api, "owner@acme.com"), login(api, "owner@globex.com")
    return {
        "acme": {"token": acme, "bot": make_bot(api, acme, "acme-bot", "acme.com")},
        "globex": {"token": globex, "bot": make_bot(api, globex, "globex-bot", "globex.com")},
    }
