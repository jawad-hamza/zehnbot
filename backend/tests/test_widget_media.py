"""Custom JavaScript, launcher pictures (normal / hover / open) and the platform's own support chat."""
from app.config import settings
from tests.conftest import auth, make_bot

ACME = {"Origin": "https://www.acme.com"}
OURS = {"Origin": "http://testserver"}

GIF = b"GIF89a\x01\x00\x01\x00\x80\x00\x00\x00\x00\x00\xff\xff\xff!\xf9\x04\x01\x00\x00\x00\x00,\x00\x00\x00\x00\x01\x00\x01\x00\x00\x02\x02D\x01\x00;"
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32
SVG = b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="#0f766e"/></svg>'


def bot_uuid(api, token, slug="acme-bot"):
    return next(b["id"] for b in api.get("/api/admin/clients", headers=auth(token)).json() if b["client_id"] == slug)


def upload(api, token, uuid, slot, data, name="pic.gif"):
    return api.put(f"/api/admin/clients/{uuid}/launcher/{slot}", headers=auth(token), files={"file": (name, data, "application/octet-stream")})


def config(api, headers=ACME, bot="acme-bot"):
    return api.get("/api/widget/config", params={"client_id": bot}, headers=headers).json()


def test_custom_js_runs_on_the_owners_site_but_is_never_sent_to_our_pages(api, two_tenants):
    token = two_tenants["acme"]["token"]
    uuid = bot_uuid(api, token)
    saved = api.put(f"/api/admin/clients/{uuid}", headers=auth(token), json={"custom_js": "zehnbot.on('open', () => {})"})
    assert saved.status_code == 200 and saved.json()["custom_js"].startswith("zehnbot.on")
    assert config(api)["custom_js"].startswith("zehnbot.on")
    assert config(api, headers=OURS)["custom_js"] is None      # the preview page / landing page on our own domain
    assert config(api, headers={})["custom_js"] is None        # same-origin requests carry no Origin
    cleared = api.put(f"/api/admin/clients/{uuid}", headers=auth(token), json={"custom_js": None})
    assert cleared.json()["custom_js"] is None and config(api)["custom_js"] is None


def test_launcher_pictures_for_each_state(api, two_tenants):
    token = two_tenants["acme"]["token"]
    uuid = bot_uuid(api, token)
    assert config(api)["launcher_images"] == {}
    assert upload(api, token, uuid, "normal", GIF).status_code == 200
    assert upload(api, token, uuid, "hover", PNG, "h.png").status_code == 200
    res = upload(api, token, uuid, "open", SVG, "o.svg")
    assert res.status_code == 200 and set(res.json()["launcher_images"]) == {"normal", "hover", "open"}

    images = config(api)["launcher_images"]
    served = api.get(images["normal"])
    assert served.status_code == 200 and served.content == GIF and served.headers["content-type"] == "image/gif"
    assert "immutable" in served.headers["cache-control"]
    svg = api.get(images["open"])
    assert svg.headers["content-type"].startswith("image/svg+xml") and "sandbox" in svg.headers["content-security-policy"]

    # replacing a picture changes its URL, so caches pick it up
    upload(api, token, uuid, "normal", PNG, "n.png")
    assert config(api)["launcher_images"]["normal"] != images["normal"]

    removed = api.delete(f"/api/admin/clients/{uuid}/launcher/hover", headers=auth(token))
    assert set(removed.json()["launcher_images"]) == {"normal", "open"}
    assert api.get(images["hover"]).status_code == 404


def test_pictures_are_checked_by_content(api, two_tenants):
    token = two_tenants["acme"]["token"]
    uuid = bot_uuid(api, token)
    assert upload(api, token, uuid, "normal", b"<html><script>alert(1)</script></html>", "x.gif").status_code == 400
    assert upload(api, token, uuid, "normal", b"GIF89a" + b"\x00" * (1024 * 1024)).status_code == 413
    assert upload(api, token, uuid, "sideways", GIF).status_code == 404
    for bad in (
        b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
        b'<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>',
        b'<svg xmlns="http://www.w3.org/2000/svg"><a href="javascript:alert(1)"><circle r="4"/></a></svg>',
        b'<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><div/></foreignObject></svg>',
        b'<svg xmlns="http://www.w3.org/2000/svg"><image href="https://evil.example/x.png"/></svg>',
    ):
        assert upload(api, token, uuid, "normal", bad, "x.svg").status_code == 400, bad


def test_only_the_owner_can_change_a_bots_pictures(api, two_tenants):
    uuid = bot_uuid(api, two_tenants["acme"]["token"])
    assert upload(api, two_tenants["globex"]["token"], uuid, "normal", GIF).status_code == 404
    assert api.put(f"/api/admin/clients/{uuid}/launcher/normal", files={"file": ("a.gif", GIF)}).status_code == 401


def test_the_super_admin_chooses_the_support_bot_for_our_pages(api, superadmin, two_tenants):
    assert api.get("/api/public/support-bot").json() == {"client_id": None}
    assert api.put("/api/admin/support-bot", headers=auth(two_tenants["acme"]["token"]), json={"client_id": "acme-bot"}).status_code == 403
    assert api.put("/api/admin/support-bot", headers=auth(superadmin), json={"client_id": "no-such-bot"}).status_code == 404
    assert api.put("/api/admin/support-bot", headers=auth(superadmin), json={"client_id": "acme-bot"}).status_code == 200
    assert api.get("/api/public/support-bot").json() == {"client_id": "acme-bot"}
    api.put("/api/admin/support-bot", headers=auth(superadmin), json={"client_id": None})
    assert api.get("/api/public/support-bot").json() == {"client_id": None}


def test_the_support_chat_has_a_daily_allowance_per_visitor(api, superadmin, two_tenants, fake_ai, monkeypatch):
    monkeypatch.setattr(settings, "RATE_SUPPORT_BOT_PER_IP_PER_DAY", 2)
    api.put("/api/admin/support-bot", headers=auth(superadmin), json={"client_id": "acme-bot"})

    def say(n, headers=OURS):
        return api.post("/api/chat/message", headers=headers, json={"client_id": "acme-bot", "session_id": f"support-{n:08d}", "message": "Hi"})

    assert say(1).status_code == 200 and say(2).status_code == 200
    refused = say(3)
    assert refused.status_code == 429 and "support chat" in refused.json()["detail"]
    assert say(4, headers=ACME).status_code == 200       # the bot's own website is not affected
