"""A new bot takes its look from its website; landing-page contact requests reach the super admin only."""
import json

import pytest

from app.services import style_service
from app.services.net_guard import UnsafeURLError
from app.services.style_service import detect_site_style, rank_colors, rank_fonts
from tests.conftest import PASSWORD, auth, login, make_bot, make_tenant

HOMEPAGE = b"""<html><head>
<meta name="theme-color" content="#0B6E4F">
<link rel="stylesheet" href="/assets/site.css">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Work+Sans:wght@400;600&display=swap">
<link rel="stylesheet" href="http://169.254.169.254/latest/meta-data.css">
<style>body { font-family: "Work Sans", Arial, sans-serif; color: #222; background: #ffffff }</style>
</head><body><a class="btn" style="background:#0b6e4f">Book</a></body></html>"""

SITE_CSS = b"""
:root { --brand-primary: #0b6e4f; --ink: #1a1a1a; --paper: #fafafa }
.btn-primary, .cta { background-color: #0b6e4f; color: #fff }
.alert-danger { background: #d92d20 } .alert-danger .x { border-color: #d92d20 } .badge-hot { color: #d92d20 }
.fa { font-family: "Font Awesome 6 Free" }  h1 { font-family: 'Playfair Display', serif }  .prose { font-family: Lora, serif }
.shadow { box-shadow: 0 1px 2px rgba(11, 110, 79, 0.1) }
@media (min-width: 600px) { .hero { background: rgb(11 110 79) } }
"""


@pytest.fixture
def fake_site(monkeypatch):
    fetched = []

    def _get(url, timeout, max_bytes):
        fetched.append(url)
        if "169.254" in url:
            raise UnsafeURLError("private address")
        if url.endswith(".css"):
            return url, 200, "text/css", SITE_CSS
        return "https://acme.com/", 200, "text/html; charset=utf-8", HOMEPAGE

    monkeypatch.setattr(style_service, "safe_get", _get)
    return fetched


@pytest.fixture(autouse=True)
def no_real_ai(monkeypatch):
    """The bot routes call the provider directly for the style pick; tests must never reach a real one."""
    calls = []

    def _fake(messages, endpoint, api_key):
        calls.append(messages)
        return '{"theme_color": "#0b6e4f", "font": "Work Sans"}', 12

    monkeypatch.setattr("app.routers.clients.chat_completion", _fake)
    return calls


# ---------- reading a website's look ----------

def test_brand_colour_and_body_font_are_found_without_any_ai(fake_site):
    guess = detect_site_style("acme.com")
    assert guess.method == "css"
    assert guess.theme_color == "#0b6e4f"
    assert guess.font_family.startswith('"Work Sans", ')
    assert "#d92d20" in guess.colors                       # seen, but outranked by the brand colour
    assert "Font Awesome 6 Free" not in guess.fonts        # icon fonts are not text fonts
    assert all(c not in guess.colors for c in ("#ffffff", "#1a1a1a", "#fafafa", "#222222"))   # structure, not brand
    assert fake_site[0] == "https://acme.com"


def test_a_stylesheet_on_a_private_address_is_skipped_not_fatal(fake_site):
    assert detect_site_style("acme.com").theme_color == "#0b6e4f"
    assert any("169.254" in url for url in fake_site)      # it was refused by the guard, and the rest still worked


def test_the_ai_may_only_choose_among_what_the_site_really_uses(fake_site):
    sent = []

    def ai(messages):
        sent.append(messages)
        return 'Sure! {"theme_color": "#D92D20", "font": "Lora"}'

    guess = detect_site_style("acme.com", ai)
    assert guess.method == "ai" and guess.theme_color == "#d92d20"
    assert guess.font_family.startswith('"Lora", ')
    assert "Playfair Display" not in guess.fonts            # a headline face is never offered for a chat window
    assert "#0b6e4f" in sent[0][1]["content"]

    invented = detect_site_style("acme.com", lambda m: json.dumps({"theme_color": "#ff00ff", "font": "Comic Sans MS; } body { display:none"}))
    assert invented.theme_color == "#0b6e4f" and invented.font_family.startswith('"Work Sans"')   # ignored, CSS pick kept


def test_a_failing_ai_or_an_unreadable_site_never_breaks_anything(fake_site, monkeypatch):
    def broken(messages):
        raise RuntimeError("provider down")

    assert detect_site_style("acme.com", broken).theme_color == "#0b6e4f"

    def refuse(url, timeout, max_bytes):
        raise UnsafeURLError("private address")

    monkeypatch.setattr(style_service, "safe_get", refuse)
    guess = detect_site_style("10.0.0.5")
    assert guess.method == "none" and guess.theme_color is None and guess.detail


def test_a_body_font_set_through_a_css_variable_is_followed():
    css = """:root { --font: "Archivo", ui-sans-serif, system-ui, sans-serif; --display: "Fraunces", serif; --loop: var(--loop) }
             body { font-family: var(--font) }  h1, h2, h3, .hero-title { font-family: var(--display) }
             .x { font-family: var(--missing, "Karla", sans-serif) } .y { font-family: var(--loop) }"""
    assert rank_fonts(css, [])[0] == "Archivo"            # the text face, not the headline face
    assert "Karla" in rank_fonts(css, [])                 # a var() fallback counts too


def test_font_names_that_could_break_out_of_css_are_dropped():
    fonts = rank_fonts('body { font-family: "Evil\\"; } * { display: none } x {", Inter, sans-serif }', [])
    assert all(";" not in f and "{" not in f and '"' not in f for f in fonts)
    assert rank_fonts("body { font-family: Inter, sans-serif }", []) == ["Inter"]
    assert rank_colors(".btn { background: #fff; color: #000 }", []) == []


def test_a_new_bot_is_matched_to_its_website_when_asked(api, superadmin, fake_site, no_real_ai):
    make_tenant(api, superadmin, "Acme", "owner@acme.com")
    token = login(api, "owner@acme.com")
    matched = make_bot(api, token, "acme-bot", "acme.com", match_website=True)
    assert matched["theme_color"] == "#0b6e4f" and matched["font_family"].startswith('"Work Sans"')
    assert len(no_real_ai) == 1                              # the platform's AI was asked to choose
    plain = make_bot(api, token, "acme-plain", "acme.com")
    assert plain["theme_color"] == "#1a52d7" and plain["font_family"] is None


def test_an_owner_can_rematch_their_own_bot_only(api, two_tenants, fake_site, fake_ai):
    acme, globex = two_tenants["acme"], two_tenants["globex"]
    res = api.post(f"/api/admin/clients/{acme['bot']['id']}/match-style", headers=auth(acme["token"]))
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["applied"] and body["theme_color"] == "#0b6e4f" and "#0b6e4f" in body["colors_found"]
    assert api.post(f"/api/admin/clients/{acme['bot']['id']}/match-style", headers=auth(globex["token"])).status_code == 404
    config = api.get("/api/widget/config?client_id=acme-bot", headers={"Origin": "https://www.acme.com"}).json()
    assert config["theme_color"] == "#0b6e4f"


# ---------- contact requests from the landing page ----------

def send(api, **fields):
    return api.post("/api/contact", json={"name": "Dana Whitfield", "email": "dana@harbourcafe.example", **fields})


def test_a_contact_request_reaches_the_super_admin(api, superadmin):
    assert send(api, phone="+44 7700 900111", company="Harbour Cafe", plan="pro", message="Can you set it up for us?", source="landing-pricing").status_code == 201
    data = api.get("/api/admin/enquiries", headers=auth(superadmin)).json()
    assert data["total"] == 1 and data["new"] == 1
    item = data["items"][0]
    assert (item["name"], item["plan"], item["source"], item["status"]) == ("Dana Whitfield", "pro", "landing-pricing", "new")
    assert api.get("/api/admin/overview/platform", headers=auth(superadmin)).json()["totals"]["new_enquiries"] == 1


def test_a_contact_request_needs_a_way_to_reply(api):
    assert api.post("/api/contact", json={"name": "No Contact", "message": "hello"}).status_code == 422
    assert api.post("/api/contact", json={"name": "Phone Only", "phone": "+92 345 0237013"}).status_code == 201
    assert api.post("/api/contact", json={"email": "x@example.com", "phone": "call me maybe"}).status_code == 422


def test_customers_cannot_read_contact_requests(api, superadmin, two_tenants):
    send(api)
    token = two_tenants["acme"]["token"]
    assert api.get("/api/admin/enquiries", headers=auth(token)).status_code == 403
    assert api.get("/api/admin/enquiries/export", headers=auth(token)).status_code == 403
    assert api.get("/api/admin/enquiries").status_code == 401
    enquiry_id = api.get("/api/admin/enquiries", headers=auth(superadmin)).json()["items"][0]["id"]
    assert api.patch(f"/api/admin/enquiries/{enquiry_id}", headers=auth(token), json={"status": "closed"}).status_code == 403
    assert api.delete(f"/api/admin/enquiries/{enquiry_id}", headers=auth(token)).status_code == 403


def test_the_super_admin_can_work_through_the_list(api, superadmin):
    send(api)
    send(api, name="Second Person", email="second@example.com", company="Northgate Dental")
    first = next(i for i in api.get("/api/admin/enquiries", headers=auth(superadmin)).json()["items"] if i["name"] == "Second Person")
    done = api.patch(f"/api/admin/enquiries/{first['id']}", headers=auth(superadmin), json={"status": "contacted"})
    assert done.status_code == 200 and done.json()["status"] == "contacted"
    assert api.patch(f"/api/admin/enquiries/{first['id']}", headers=auth(superadmin), json={"status": "won"}).status_code == 422
    assert api.get("/api/admin/enquiries?status=new", headers=auth(superadmin)).json()["total"] == 1
    assert api.get("/api/admin/enquiries?q=northgate", headers=auth(superadmin)).json()["total"] == 1
    assert api.delete(f"/api/admin/enquiries/{first['id']}", headers=auth(superadmin)).status_code == 204
    assert api.get("/api/admin/enquiries", headers=auth(superadmin)).json()["total"] == 1


def test_a_bot_filling_the_hidden_field_stores_nothing(api, superadmin):
    assert send(api, fax="http://spam.example").status_code == 201             # it learns nothing
    assert api.get("/api/admin/enquiries", headers=auth(superadmin)).json()["total"] == 0


def test_contact_requests_are_rate_limited_per_visitor(api):
    codes = [send(api, email=f"p{n}@example.com").status_code for n in range(7)]
    assert codes[:5] == [201] * 5 and codes[5:] == [429, 429]


def test_the_export_cannot_smuggle_a_formula_into_excel(api, superadmin):
    send(api, name="=HYPERLINK(\"http://evil.example\")", message="+1+1")
    csv_text = api.get("/api/admin/enquiries/export", headers=auth(superadmin)).text
    assert "'=HYPERLINK" in csv_text and "'+1+1" in csv_text
