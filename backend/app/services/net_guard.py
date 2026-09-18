"""Outbound HTTP for knowledge ingestion, hardened against SSRF.

Tenants are untrusted and can ask the server to fetch arbitrary URLs, so every hop
(including redirects) must resolve to a public address, and downloads are size-capped."""
import ipaddress
import socket
from typing import Tuple
from urllib.parse import urljoin, urlparse

import requests

USER_AGENT = "ChatBotKnowledgeBot/1.0"
MAX_REDIRECTS = 5
ALLOWED_PORTS = {None, 80, 443, 8080, 8443}


class UnsafeURLError(ValueError):
    pass


def _is_public(ip_text: str) -> bool:
    ip = ipaddress.ip_address(ip_text)
    if ip.version == 6 and ip.ipv4_mapped is not None:
        ip = ip.ipv4_mapped
    return ip.is_global


def assert_public_url(url: str) -> None:
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise UnsafeURLError("URL must start with http:// or https://")
    if parsed.username or parsed.password:
        raise UnsafeURLError("URLs with embedded credentials are not allowed")
    host = parsed.hostname
    if not host:
        raise UnsafeURLError("URL has no host")
    try:
        port = parsed.port
    except ValueError:
        raise UnsafeURLError("URL has an invalid port")
    if port not in ALLOWED_PORTS:
        raise UnsafeURLError("That port is not allowed")
    try:
        infos = socket.getaddrinfo(host, port or (443 if parsed.scheme == "https" else 80), type=socket.SOCK_STREAM)
    except socket.gaierror:
        raise UnsafeURLError("Host could not be resolved")
    addresses = {info[4][0].split("%")[0] for info in infos}
    if not addresses or not all(_is_public(a) for a in addresses):
        raise UnsafeURLError("That address is not publicly routable")


def safe_get(url: str, timeout: float, max_bytes: int) -> Tuple[str, int, str, bytes]:
    """GET `url`, following redirects manually with re-validation.
    Returns (final_url, status_code, content_type, body truncated to max_bytes)."""
    session = requests.Session()
    session.trust_env = False   # ignore proxy env vars; they would bypass the address check
    try:
        for _ in range(MAX_REDIRECTS + 1):
            assert_public_url(url)
            resp = session.get(
                url,
                timeout=timeout,
                headers={"User-Agent": USER_AGENT},
                allow_redirects=False,
                stream=True,
            )
            try:
                if resp.is_redirect or resp.is_permanent_redirect:
                    location = resp.headers.get("location")
                    if not location:
                        raise UnsafeURLError("Redirect without a location")
                    url = urljoin(url, location)
                    continue
                body = b""
                for block in resp.iter_content(chunk_size=65536):
                    body += block
                    if len(body) >= max_bytes:
                        body = body[:max_bytes]
                        break
                return url, resp.status_code, resp.headers.get("content-type", ""), body
            finally:
                resp.close()
        raise UnsafeURLError("Too many redirects")
    finally:
        session.close()
