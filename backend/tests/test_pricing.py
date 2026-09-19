"""Plan prices: set by the operator in the dashboard, read by the public marketing page on another website."""
from app.config import settings
from tests.conftest import auth

NEW = {
    "currency": "Rs",
    "recommended": "pro",
    "plans": {
        "free": {"price": 0, "blurb": "Try it."},
        "starter": {"price": 4999, "blurb": "One shop."},
        "pro": {"price": 12999.5, "blurb": "  Several sites.  "},
        "business": {"price": 39999, "blurb": ""},
    },
}


def test_the_public_page_gets_prices_with_the_real_limits_and_no_login(api):
    res = api.get("/api/public/plans", headers={"Origin": "https://zehnox.com"})
    assert res.status_code == 200 and res.headers["access-control-allow-origin"] == "*"
    assert "max-age" in res.headers["cache-control"]
    plans = {p["id"]: p for p in res.json()}
    assert [p["id"] for p in res.json()] == ["free", "starter", "pro", "business"]
    assert (plans["starter"]["price"], plans["starter"]["currency"], plans["starter"]["recommended"]) == (19, "$", True)
    assert (plans["pro"]["max_bots"], plans["pro"]["monthly_message_quota"]) == (10, 10_000)     # limits come from the code, not the form


def test_the_operator_changes_prices_and_the_public_page_follows(api, superadmin):
    saved = api.put("/api/admin/pricing", headers=auth(superadmin), json=NEW)
    assert saved.status_code == 200, saved.text
    plans = {p["id"]: p for p in api.get("/api/public/plans").json()}
    assert (plans["pro"]["price"], plans["pro"]["currency"], plans["pro"]["blurb"], plans["pro"]["recommended"]) == (12999.5, "Rs", "Several sites.", True)
    assert plans["starter"]["recommended"] is False
    assert api.get("/api/admin/pricing", headers=auth(superadmin)).json()["plans"]["starter"]["price"] == 4999
    again = api.put("/api/admin/pricing", headers=auth(superadmin), json={**NEW, "currency": "$"})       # an update, not a second row
    assert again.status_code == 200 and api.get("/api/public/plans").json()[0]["currency"] == "$"


def test_only_the_operator_can_change_prices(api, two_tenants):
    token = two_tenants["acme"]["token"]
    assert api.put("/api/admin/pricing", headers=auth(token), json=NEW).status_code == 403
    assert api.get("/api/admin/pricing", headers=auth(token)).status_code == 403
    assert api.put("/api/admin/pricing", json=NEW).status_code == 401


def test_bad_prices_are_refused(api, superadmin):
    def put(**change):
        return api.put("/api/admin/pricing", headers=auth(superadmin), json={**NEW, **change}).status_code

    assert put(currency="<b>$</b>") == 422
    assert put(recommended="platinum") == 422
    assert put(plans={**NEW["plans"], "free": {"price": 5, "blurb": ""}}) == 422                   # free stays free
    assert put(plans={**NEW["plans"], "pro": {"price": -1, "blurb": ""}}) == 422
    assert put(plans={k: v for k, v in NEW["plans"].items() if k != "business"}) == 422            # every plan needs a price
    assert put(plans={**NEW["plans"], "platinum": {"price": 1, "blurb": ""}}) == 422


def test_the_app_says_where_its_landing_page_lives(api, monkeypatch):
    assert api.get("/api/auth/config").json()["marketing_url"] is None
    monkeypatch.setattr(settings, "MARKETING_URL", " https://zehnox.com/zehnbot ")
    assert api.get("/api/auth/config").json()["marketing_url"] == "https://zehnox.com/zehnbot"
    monkeypatch.setattr(settings, "MARKETING_URL", "javascript:alert(1)")
    assert api.get("/api/auth/config").json()["marketing_url"] is None
