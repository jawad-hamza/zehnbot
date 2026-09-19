"""Launcher pictures: GIF, PNG or SVG, one per state (normal, hover, open).

Files are checked by their content, not by their name. SVG is the risky one, because it can carry script:
anything that could run is refused, and every picture is served with a sandboxing Content-Security-Policy,
so even opened directly in a browser tab on our domain it cannot run anything."""
import hashlib
import re
from typing import Dict

from fastapi import HTTPException

MAX_BYTES = 1024 * 1024       # 1 MB: plenty for an animated 64px mascot

# Anything in an SVG that can execute or pull in other documents
_SVG_DANGER = re.compile(
    rb"<\s*(script|foreignobject|iframe|embed|object|audio|video|handler|listener)\b"
    rb"|\bon[a-z]+\s*="
    rb"|javascript\s*:|data\s*:\s*text/html|<!ENTITY"
    rb"|(?:xlink:)?href\s*=\s*[\"']\s*(?!#|data:image/)",
    re.IGNORECASE,
)


def sniff(data: bytes) -> str:
    """The picture's real type, or HTTPException 400."""
    if not data:
        raise HTTPException(status_code=400, detail="The file is empty.")
    if len(data) > MAX_BYTES:
        raise HTTPException(status_code=413, detail="The picture is larger than 1 MB. Make it smaller (a launcher is 56 to 64 pixels).")
    if data[:6] in (b"GIF87a", b"GIF89a"):
        return "image/gif"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    head = data[:2048].lstrip(b"\xef\xbb\xbf").lstrip().lower()
    if head.startswith((b"<svg", b"<?xml")) and b"<svg" in data[:4096].lower():
        if _SVG_DANGER.search(data):
            raise HTTPException(status_code=400, detail="This SVG contains scripts, event handlers or links to other files. Export it as a plain drawing.")
        return "image/svg+xml"
    raise HTTPException(status_code=400, detail="Use a GIF, PNG or SVG picture.")


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def launcher_image_urls(client) -> Dict[str, str]:
    """Relative URLs (the widget resolves them against its own server). The version in the query string
    changes with the picture, so the file itself can be cached for a year."""
    return {m.slot: f"/api/public/media/{client.client_id}/{m.slot}?v={m.sha256[:12]}" for m in (client.media or [])}
