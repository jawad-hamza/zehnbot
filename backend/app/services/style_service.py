"""Makes a new bot look like the website it will live on.

Reads the site's homepage and stylesheets (through the SSRF guard), collects the colours and
fonts the site really uses, and picks a brand colour and a font for the widget. The AI only ever
CHOOSES among values found in the site's own CSS; it cannot introduce one, so a confused or
manipulated model (the page content is untrusted input) can do no worse than a poor pick.
Without an AI key, or if the call fails, a frequency heuristic makes the pick instead."""
import colorsys
import json
import logging
import re
from collections import Counter
from dataclasses import dataclass, field
from typing import Callable, Dict, List, Optional, Tuple
from urllib.parse import urljoin

from bs4 import BeautifulSoup

from app.services.net_guard import UnsafeURLError, safe_get

logger = logging.getLogger("app.style")

PAGE_BYTES = 1_500_000
SHEET_BYTES = 700_000
MAX_SHEETS = 5
TIMEOUT = 8.0

_HEX = re.compile(r"#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})(?![0-9a-fA-F])")
_RGB = re.compile(r"rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})(?:[\s,/]+([\d.]+%?))?\s*\)")
_RULE = re.compile(r"([^{}]+)\{([^{}]*)\}")
_FONT = re.compile(r"(?<![\w-])font-family\s*:\s*([^;}{]+)", re.I)
_CUSTOM_PROPERTY = re.compile(r"(--[\w-]+)\s*:\s*([^;}{]+)")
_VAR = re.compile(r"var\(\s*(--[\w-]+)\s*(?:,\s*([^)]*))?\)")
_BRAND_VAR = re.compile(r"--[\w-]*(primary|brand|accent|main|theme|cta|button|btn|link|highlight)[\w-]*\s*:", re.I)
_BRAND_SELECTOR = re.compile(r"(btn|button|cta|primary|brand|accent|hero|nav|header|\ba\b|link)", re.I)
_FILL = re.compile(r"(?:^|;|\s)(background(?:-color)?|border(?:-color)?|fill)\s*:", re.I)
_GENERIC_FONTS = {
    "serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui", "ui-sans-serif", "ui-serif", "ui-monospace",
    "ui-rounded", "inherit", "initial", "unset", "revert", "-apple-system", "blinkmacsystemfont", "segoe ui", "roboto",
    "helvetica neue", "helvetica", "arial", "noto sans", "apple color emoji", "segoe ui emoji", "segoe ui symbol",
    "noto color emoji", "times new roman", "times", "georgia", "courier new", "courier", "menlo", "monaco", "consolas",
    "liberation mono", "sfmono-regular", "sf mono", "tahoma", "verdana", "ubuntu", "cantarell", "oxygen", "fira sans",
    "droid sans", "emoji", "math", "fangsong",
}
_ICON_FONT = re.compile(r"(icon|awesome|glyph|material symbols|material icons|dashicons|swiper|slick|eicons|fontello|icomoon|brands)", re.I)
_SAFE_FONT = re.compile(r"^[A-Za-z0-9][A-Za-z0-9 _\-]{0,48}$")
_FALLBACK_STACK = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'


@dataclass
class StyleGuess:
    theme_color: Optional[str] = None
    font_family: Optional[str] = None      # a complete, safe CSS font stack, or None
    method: str = "none"                   # "ai" | "css" | "none"
    detail: str = ""
    colors: List[str] = field(default_factory=list)     # what was found, best first (for the dashboard)
    fonts: List[str] = field(default_factory=list)


def _to_hex(match: re.Match) -> Optional[str]:
    if match.re is _HEX:
        h = match.group(1)
        return "#" + ("".join(c * 2 for c in h) if len(h) == 3 else h).lower()
    r, g, b = (int(match.group(i)) for i in (1, 2, 3))
    alpha = match.group(4)
    if alpha is not None:
        value = float(alpha.rstrip("%")) / (100 if alpha.endswith("%") else 1)
        if value < 0.5:
            return None        # a wash or a shadow, not a brand colour
    if max(r, g, b) > 255:
        return None
    return "#%02x%02x%02x" % (r, g, b)


def _is_brandlike(hex_color: str) -> bool:
    """Greys, near-whites and near-blacks are structure, not brand."""
    r, g, b = (int(hex_color[i:i + 2], 16) / 255 for i in (1, 3, 5))
    _, lightness, saturation = colorsys.rgb_to_hls(r, g, b)
    return saturation >= 0.25 and 0.12 <= lightness <= 0.85


def _colors_in(text: str) -> List[str]:
    found = []
    for pattern in (_HEX, _RGB):
        for m in pattern.finditer(text):
            color = _to_hex(m)
            if color and _is_brandlike(color):
                found.append(color)
    return found


def rank_colors(css: str, meta_colors: List[str]) -> List[Tuple[str, float]]:
    score: Counter = Counter()
    for color in meta_colors:                      # <meta name="theme-color">: the site saying it outright
        if _is_brandlike(color):
            score[color] += 40
    for m in _RULE.finditer(css):
        selector, body = m.group(1), m.group(2)
        branded = bool(_BRAND_SELECTOR.search(selector))
        for declaration in body.split(";"):
            colors = _colors_in(declaration)
            if not colors:
                continue
            weight = 1.0
            if _BRAND_VAR.search(declaration):
                weight += 12                       # --primary / --brand-color and friends
            if _FILL.search(" " + declaration):
                weight += 2 if branded else 0.5    # a filled button says more than a text colour
            elif branded:
                weight += 1
            for color in colors:
                score[color] += weight
    return score.most_common(8)


def _clean_font(name: str) -> Optional[str]:
    name = name.strip().strip("'\"").strip()
    if not name or name.lower() in _GENERIC_FONTS or name.lower().startswith("var(") or _ICON_FONT.search(name):
        return None
    return name if _SAFE_FONT.match(name) else None


def _resolve_vars(value: str, properties: Dict[str, str], depth: int = 0) -> str:
    """`font-family: var(--font)` says nothing until --font is looked up. Modern sites are all written this way."""
    if depth > 4 or "var(" not in value:
        return value
    return _VAR.sub(lambda m: _resolve_vars(properties.get(m.group(1)) or m.group(2) or "", properties, depth + 1), value)


def rank_fonts(css: str, google_families: List[str]) -> List[str]:
    score: Counter = Counter()
    properties = {name: value.strip() for name, value in _CUSTOM_PROPERTY.findall(css)}
    elsewhere: Counter = Counter()
    for family in google_families:
        cleaned = _clean_font(family)
        if cleaned:
            score[cleaned] += 3
    for m in _RULE.finditer(css):
        selector, body = m.group(1), m.group(2)
        fm = _FONT.search(body)
        if not fm:
            continue
        first = next((c for c in (_clean_font(part) for part in _resolve_vars(fm.group(1), properties).split(",")) if c), None)
        if not first:
            continue
        where = selector.strip()
        if re.search(r"(^|[\s,>])(body|html|:root)\b", where, re.I):
            score[first] += 100          # the page's text face, said outright
        elif re.search(r"(^|[\s,>.#])(h[1-6]|hero|title|headline|display|heading|logo|brand)\b", where, re.I):
            continue                     # a headline face is the wrong voice for a chat window
        else:
            elsewhere[first] += 1
    for name, count in elsewhere.items():
        score[name] += min(count, 8)     # a face used in fifty small rules must not outvote the body rule
    return [name for name, _ in score.most_common(5)]


def font_stack(name: str) -> str:
    return f'"{name}", {_FALLBACK_STACK}'


def _collect(domain: str) -> Tuple[str, List[str], List[str]]:
    """(all css text, meta theme colours, google font families) for the site's homepage."""
    host = domain.split(",")[0].strip()
    url = host if "://" in host else f"https://{host}"
    final_url, status_code, content_type, body = safe_get(url, TIMEOUT, PAGE_BYTES)
    if status_code >= 400 or "html" not in content_type.lower():
        raise ValueError(f"The website answered {status_code} ({content_type or 'no content type'}).")
    soup = BeautifulSoup(body, "html.parser")

    metas = []
    for tag in soup.find_all("meta"):
        if (tag.get("name") or "").lower() in ("theme-color", "msapplication-tilecolor"):
            m = _HEX.search(tag.get("content") or "")
            if m:
                metas.append(_to_hex(m))

    css_parts = [tag.get_text() for tag in soup.find_all("style")]
    css_parts += [f"[inline]{{{tag.get('style')}}}" for tag in soup.find_all(style=True)][:200]
    google, fetched = [], 0
    for link in soup.find_all("link"):
        rel = " ".join(link.get("rel") or []).lower()
        href = link.get("href")
        if "stylesheet" not in rel or not href:
            continue
        sheet_url = urljoin(final_url, href)
        if "fonts.googleapis.com" in sheet_url:
            google += [f.split(":")[0].replace("+", " ") for f in re.findall(r"family=([^&]+)", sheet_url)]
            continue
        if fetched >= MAX_SHEETS:
            continue
        fetched += 1
        try:
            _, sheet_status, _, sheet = safe_get(sheet_url, TIMEOUT, SHEET_BYTES)
            if sheet_status < 400:
                css_parts.append(sheet.decode("utf-8", errors="ignore"))
        except (UnsafeURLError, Exception) as exc:      # one bad stylesheet must not sink the whole attempt
            logger.info("style: skipped stylesheet %s (%s)", sheet_url, exc)
    css = re.sub(r"/\*.*?\*/", "", "\n".join(css_parts), flags=re.S)
    return css, metas, google


_PROMPT = """You are choosing how a small chat widget should look so that it matches a website.
Below are colours and fonts that were found in that website's own CSS, with a usage score.
Pick the ONE colour that is the site's main brand or call-to-action colour (the colour of its
primary buttons and links), not a background, not a warning/error colour. Pick the font the
site uses for its normal body text.

You MUST choose only from the lists. Reply with JSON only, no prose:
{"theme_color": "<one of the colours>", "font": "<one of the fonts, or null>"}

Colours (hex, score): %s
Fonts: %s
Site: %s"""


def _ask_ai(colors: List[Tuple[str, float]], fonts: List[str], domain: str, complete: Callable[[List[dict]], str]) -> Dict:
    prompt = _PROMPT % (json.dumps([[c, round(s, 1)] for c, s in colors]), json.dumps(fonts), domain[:100])
    reply = complete([{"role": "system", "content": "You answer with a single JSON object and nothing else."},
                      {"role": "user", "content": prompt}])
    found = re.search(r"\{.*\}", reply or "", re.S)
    return json.loads(found.group(0)) if found else {}


def detect_site_style(domain: str, complete: Optional[Callable[[List[dict]], str]] = None) -> StyleGuess:
    """`complete(messages) -> text` is an AI call, or None to use the heuristic alone. Never raises."""
    try:
        css, metas, google = _collect(domain)
    except UnsafeURLError as exc:
        return StyleGuess(detail=f"That address cannot be read: {exc}")
    except Exception as exc:
        logger.info("style: could not read %s (%s)", domain, exc)
        return StyleGuess(detail="The website could not be read, so the default look was kept.")

    colors, fonts = rank_colors(css, metas), rank_fonts(css, google)
    guess = StyleGuess(colors=[c for c, _ in colors], fonts=fonts)
    if not colors and not fonts:
        guess.detail = "No brand colour or font could be found in the website's styles."
        return guess

    guess.method = "css"
    guess.theme_color = colors[0][0] if colors else None
    guess.font_family = font_stack(fonts[0]) if fonts else None

    if complete and (len(colors) > 1 or len(fonts) > 1):
        try:
            choice = _ask_ai(colors, fonts, domain, complete)
            picked_color = str(choice.get("theme_color") or "").lower()
            if picked_color in guess.colors:                # only ever a value the site really uses
                guess.theme_color, guess.method = picked_color, "ai"
            picked_font = choice.get("font")
            if isinstance(picked_font, str) and picked_font in fonts:
                guess.font_family, guess.method = font_stack(picked_font), "ai"
        except Exception as exc:
            logger.info("style: AI pick failed for %s, keeping the CSS pick (%s)", domain, exc)

    guess.detail = "Matched to your website." if guess.theme_color or guess.font_family else ""
    return guess
