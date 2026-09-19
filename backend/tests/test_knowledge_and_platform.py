import uuid

import pytest

from app.config import settings
from app.services import knowledge_service
from app.services.net_guard import UnsafeURLError, assert_public_url
from tests.conftest import auth


# ---- SSRF guard ----

@pytest.mark.parametrize("url", [
    "http://127.0.0.1/",
    "http://localhost/admin",
    "http://169.254.169.254/latest/meta-data/",   # cloud metadata service
    "http://10.0.0.5/",
    "http://192.168.1.1/",
    "http://[::1]/",
    "http://[::ffff:127.0.0.1]/",
    "http://0.0.0.0/",
    "http://user:pass@8.8.8.8/",
    "http://8.8.8.8:6379/",                        # odd port
    "ftp://8.8.8.8/",
    "file:///etc/passwd",
])
def test_internal_and_malformed_urls_are_refused(url):
    with pytest.raises(UnsafeURLError):
        assert_public_url(url)


def test_public_address_is_accepted():
    assert_public_url("https://8.8.8.8/")


def test_url_ingest_refuses_internal_targets(api, two_tenants):
    bot_id = two_tenants["acme"]["bot"]["id"]
    headers = auth(two_tenants["acme"]["token"])
    res = api.post(f"/api/admin/clients/{bot_id}/knowledge/url", headers=headers, json={"url": "http://169.254.169.254/latest/"})
    assert res.status_code == 400
    res = api.post(f"/api/admin/clients/{bot_id}/knowledge/crawl", headers=headers, json={"url": "http://127.0.0.1:8080/"})
    assert res.status_code == 400


# ---- knowledge base ----

def sources(api, bot_id, headers):
    chunks = api.get(f"/api/admin/clients/{bot_id}/knowledge", headers=headers).json()["chunks"]
    return sorted({c["source_label"] for c in chunks})


def test_pasting_text_replaces_only_its_own_source(api, two_tenants):
    bot_id, headers = two_tenants["acme"]["bot"]["id"], auth(two_tenants["acme"]["token"])
    url = f"/api/admin/clients/{bot_id}/knowledge"

    api.post(url, headers=headers, json={"raw_text": "We open at nine.", "source_label": "hours"})
    api.post(url, headers=headers, json={"raw_text": "Delivery takes three days.", "source_label": "shipping"})
    api.post(url, headers=headers, json={"raw_text": "We now open at eight.", "source_label": "hours"})

    chunks = api.get(url, headers=headers).json()["chunks"]
    assert sorted(c["chunk_text"] for c in chunks) == ["Delivery takes three days.", "We now open at eight."]

    assert api.delete(url, headers=headers, params={"source_label": "hours"}).status_code == 204
    assert sources(api, bot_id, headers) == ["shipping"]


def test_knowledge_size_is_capped_per_bot(api, two_tenants, monkeypatch):
    monkeypatch.setattr(settings, "MAX_CHUNKS_PER_CLIENT", 2)
    bot_id, headers = two_tenants["acme"]["bot"]["id"], auth(two_tenants["acme"]["token"])
    url = f"/api/admin/clients/{bot_id}/knowledge"

    first = api.post(url, headers=headers, json={"raw_text": "word " * 400, "source_label": "big"})
    assert first.json()["chunks_created"] == 2
    assert api.post(url, headers=headers, json={"raw_text": "more", "source_label": "extra"}).status_code == 400


def test_search_finds_the_relevant_chunk_and_ignores_filler_words(db, two_tenants):
    bot_id = uuid.UUID(two_tenants["acme"]["bot"]["id"])
    knowledge_service.replace_source("The refund policy allows returns within thirty days.", bot_id, "refunds", db)
    knowledge_service.replace_source("This is the way that we are and what it is to you.", bot_id, "filler", db)

    hits = knowledge_service.search_knowledge("what is the refund policy?", bot_id, db, top_k=1)
    assert [h.source_label for h in hits] == ["refunds"]
    assert knowledge_service.search_knowledge("what is the", bot_id, db) == []


def test_search_never_crosses_bots(db, two_tenants):
    acme, globex = (uuid.UUID(two_tenants[t]["bot"]["id"]) for t in ("acme", "globex"))
    knowledge_service.replace_source("Globex secret pricing is 999 dollars.", globex, "pricing", db)
    assert knowledge_service.search_knowledge("secret pricing", acme, db) == []


def test_chunks_break_on_word_boundaries():
    chunks = knowledge_service.split_into_chunks("alpha beta gamma delta " * 100)
    assert len(chunks) > 1
    assert all(c.split()[-1] in {"alpha", "beta", "gamma", "delta"} for c in chunks)


# ---- platform ----

def test_health_endpoints(api):
    assert api.get("/health").json() == {"status": "ok"}
    assert api.get("/health/ready").json() == {"status": "ready"}


def test_cors_is_open_for_the_widget_and_closed_for_the_admin_api(api):
    origin = {"Origin": "https://some-customer-site.example"}
    widget = api.get("/api/widget/config?client_id=nope", headers=origin)
    assert widget.headers.get("access-control-allow-origin") == "*"

    admin = api.get("/api/admin/clients", headers=origin)
    assert "access-control-allow-origin" not in admin.headers

    preflight = api.options("/api/auth/login", headers={**origin, "Access-Control-Request-Method": "POST"})
    assert "access-control-allow-origin" not in preflight.headers


def test_responses_carry_a_request_id_and_are_not_cached(api):
    res = api.get("/api/auth/config")
    assert res.headers["x-request-id"]
    assert res.headers["cache-control"] == "no-store"
    assert res.headers["x-content-type-options"] == "nosniff"


# ---- background crawl ----

def test_crawl_runs_in_the_background_and_reports_through_its_job(api, two_tenants, monkeypatch):
    pages = [("https://8.8.8.8/", "Welcome to Acme. " * 10), ("https://8.8.8.8/pricing", "Plans start at ten pounds. " * 10)]
    monkeypatch.setattr(knowledge_service, "crawl_site", lambda url, max_pages: pages[:max_pages])
    bot_id, headers = two_tenants["acme"]["bot"]["id"], auth(two_tenants["acme"]["token"])

    started = api.post(f"/api/admin/clients/{bot_id}/knowledge/crawl", headers=headers, json={"url": "https://8.8.8.8/", "max_pages": 5})
    assert started.status_code == 202   # answered immediately; the test client then runs the background task

    job = api.get(f"/api/admin/clients/{bot_id}/knowledge/jobs/{started.json()['id']}", headers=headers).json()
    assert (job["status"], job["pages_crawled"]) == ("done", 2) and job["chunks_created"] >= 2
    assert sources(api, bot_id, headers) == ["https://8.8.8.8/", "https://8.8.8.8/pricing"]

    # crawling again refreshes the same pages instead of piling up duplicates
    api.post(f"/api/admin/clients/{bot_id}/knowledge/crawl", headers=headers, json={"url": "https://8.8.8.8/"})
    chunks = api.get(f"/api/admin/clients/{bot_id}/knowledge", headers=headers).json()["chunks"]
    assert len(chunks) == job["chunks_created"]

    # and the job belongs to this bot only
    other = two_tenants["globex"]
    assert api.get(f"/api/admin/clients/{other['bot']['id']}/knowledge/jobs/{job['id']}", headers=auth(other["token"])).status_code == 404


def test_failed_crawl_is_reported_not_swallowed(api, two_tenants, monkeypatch):
    monkeypatch.setattr(knowledge_service, "crawl_site", lambda url, max_pages: [])
    bot_id, headers = two_tenants["acme"]["bot"]["id"], auth(two_tenants["acme"]["token"])
    started = api.post(f"/api/admin/clients/{bot_id}/knowledge/crawl", headers=headers, json={"url": "https://8.8.8.8/"})
    job = api.get(f"/api/admin/clients/{bot_id}/knowledge/jobs/{started.json()['id']}", headers=headers).json()
    assert job["status"] == "failed" and "No pages" in job["error"]


def test_readiness_is_reachable_behind_the_proxy_too(api):
    """nginx only forwards /api/ and /static/, so the deploy script and any monitor use the /api/ address."""
    assert api.get("/health/ready").json() == {"status": "ready"}
    assert api.get("/api/health/ready").json() == {"status": "ready"}


def test_an_older_release_starts_on_a_database_a_newer_release_migrated(db):
    """A rollback across a release that added a migration: the older code must still start."""
    import os
    from alembic.config import Config
    from alembic.script import ScriptDirectory
    from sqlalchemy import text

    from scripts.migrate import BACKEND_DIR, database_is_ahead, revision_is_known

    cfg = Config(os.path.join(BACKEND_DIR, "alembic.ini"))
    cfg.set_main_option("script_location", os.path.join(BACKEND_DIR, "alembic"))
    script = ScriptDirectory.from_config(cfg)
    head = script.get_current_head()
    assert revision_is_known(script, head) and revision_is_known(script, "0001")
    assert not revision_is_known(script, "0999_from_the_future")

    db.execute(text("CREATE TABLE IF NOT EXISTS alembic_version (version_num VARCHAR(32) NOT NULL)"))
    db.execute(text("DELETE FROM alembic_version"))
    db.execute(text("INSERT INTO alembic_version VALUES (:v)"), {"v": head})
    db.commit()
    assert database_is_ahead(cfg) is False            # the normal case: upgrade as usual
    db.execute(text("UPDATE alembic_version SET version_num = '0999_from_the_future'"))
    db.commit()
    assert database_is_ahead(cfg) is True             # a rollback: leave the schema alone, start anyway
    db.execute(text("DROP TABLE alembic_version"))
    db.commit()
