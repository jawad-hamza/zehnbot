import re
import time
from typing import List, Tuple
from sqlalchemy.orm import Session
from fastapi import HTTPException
from app.models.knowledge import KnowledgeChunk

CHUNK_SIZE = 400
CHUNK_OVERLAP = 80
MAX_URL_BYTES = 2_000_000
CRAWL_TIME_BUDGET_SEC = 120


def split_into_chunks(text: str) -> List[str]:
    text = re.sub(r"\s+", " ", text).strip()
    chunks, start = [], 0
    while start < len(text):
        end = start + CHUNK_SIZE
        chunks.append(text[start:end])
        start += CHUNK_SIZE - CHUNK_OVERLAP
    return chunks


def save_knowledge(raw_text: str, client_db_id, source_label: str, db: Session) -> int:
    db.query(KnowledgeChunk).filter(KnowledgeChunk.client_id == client_db_id).delete()
    return _insert_chunks(raw_text, client_db_id, source_label, db, start_index=0)


def append_knowledge(raw_text: str, client_db_id, source_label: str, db: Session) -> int:
    start = db.query(KnowledgeChunk).filter(KnowledgeChunk.client_id == client_db_id).count()
    return _insert_chunks(raw_text, client_db_id, source_label, db, start_index=start)


def _insert_chunks(raw_text: str, client_db_id, source_label: str, db: Session, start_index: int) -> int:
    chunks = split_into_chunks(raw_text)
    for offset, text in enumerate(chunks):
        db.add(KnowledgeChunk(
            client_id=client_db_id,
            chunk_text=text,
            chunk_index=start_index + offset,
            source_label=source_label,
        ))
    db.commit()
    return len(chunks)


def extract_file_text(filename: str, data: bytes) -> str:
    lower = filename.lower()
    if lower.endswith(".pdf"):
        return _extract_pdf(data)
    if lower.endswith(".docx"):
        return _extract_docx(data)
    if lower.endswith((".txt", ".md", ".csv")):
        try:
            return data.decode("utf-8", errors="replace")
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Could not read text file: {e}")
    raise HTTPException(status_code=400, detail=f"Unsupported file type: {filename}. Supported: .pdf, .docx, .txt, .md, .csv")


def _extract_pdf(data: bytes) -> str:
    import io
    from pypdf import PdfReader
    try:
        reader = PdfReader(io.BytesIO(data))
        pages = [page.extract_text() or "" for page in reader.pages]
        text = "\n\n".join(pages).strip()
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not parse PDF: {e}")
    if not text:
        raise HTTPException(status_code=400, detail="PDF had no extractable text (scanned/image PDFs aren't supported).")
    return text


def _extract_docx(data: bytes) -> str:
    import io
    from docx import Document
    try:
        doc = Document(io.BytesIO(data))
        parts = [p.text for p in doc.paragraphs if p.text.strip()]
        for table in doc.tables:
            for row in table.rows:
                row_text = " | ".join(cell.text.strip() for cell in row.cells if cell.text.strip())
                if row_text:
                    parts.append(row_text)
        text = "\n".join(parts).strip()
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not parse DOCX: {e}")
    if not text:
        raise HTTPException(status_code=400, detail="DOCX had no extractable text.")
    return text


def fetch_url_text(url: str) -> str:
    import requests
    from bs4 import BeautifulSoup

    if not re.match(r"^https?://", url, re.IGNORECASE):
        raise HTTPException(status_code=400, detail="URL must start with http:// or https://")
    try:
        resp = requests.get(url, timeout=15, headers={"User-Agent": "ChatBotKnowledgeBot/1.0"})
        resp.raise_for_status()
    except requests.RequestException as e:
        raise HTTPException(status_code=400, detail=f"Could not fetch URL: {e}")

    content = resp.content[:MAX_URL_BYTES]
    text = _extract_html_text(content)
    if not text:
        raise HTTPException(status_code=400, detail="Page had no extractable text")
    return text


def _extract_html_text(content: bytes) -> str:
    from bs4 import BeautifulSoup
    soup = BeautifulSoup(content, "html.parser")
    for tag in soup(["script", "style", "noscript", "svg", "header", "footer", "nav", "aside"]):
        tag.decompose()
    text = soup.get_text(separator=" ", strip=True)
    return re.sub(r"\s+", " ", text).strip()


def crawl_site(start_url: str, max_pages: int = 25) -> List[Tuple[str, str]]:
    """BFS-crawl the same domain as start_url, return list of (url, extracted_text)."""
    import requests
    from bs4 import BeautifulSoup
    from urllib.parse import urljoin, urlparse, urldefrag

    if not re.match(r"^https?://", start_url, re.IGNORECASE):
        raise HTTPException(status_code=400, detail="URL must start with http:// or https://")

    start_url = urldefrag(start_url.strip()).url
    domain = urlparse(start_url).netloc.lower()

    visited = set()
    queue = [start_url]
    results: List[Tuple[str, str]] = []
    headers = {"User-Agent": "ChatBotKnowledgeBot/1.0"}

    deadline = time.monotonic() + CRAWL_TIME_BUDGET_SEC
    skip_exts = (".pdf", ".jpg", ".jpeg", ".png", ".gif", ".svg", ".zip", ".mp4", ".webp", ".ico", ".css", ".js", ".xml", ".woff", ".woff2", ".ttf")

    while queue and len(results) < max_pages and time.monotonic() < deadline:
        url = queue.pop(0)
        url = urldefrag(url).url
        if url in visited:
            continue
        visited.add(url)

        path_lower = urlparse(url).path.lower()
        if path_lower.endswith(skip_exts):
            continue

        try:
            resp = requests.get(url, timeout=10, headers=headers, allow_redirects=True)
        except requests.RequestException:
            continue
        if resp.status_code != 200:
            continue
        if "html" not in resp.headers.get("content-type", "").lower():
            continue

        content = resp.content[:MAX_URL_BYTES]
        soup = BeautifulSoup(content, "html.parser")

        # collect same-domain links BEFORE stripping scripts/nav (nav has nav-links too)
        for a in soup.find_all("a", href=True):
            href = urljoin(url, a["href"])
            href = urldefrag(href).url
            p = urlparse(href)
            if p.scheme not in ("http", "https"):
                continue
            if p.netloc.lower() != domain:
                continue
            if href not in visited and href not in queue:
                queue.append(href)

        text = _extract_html_text(content)
        if text and len(text) > 80:
            results.append((url, text))

    if not results:
        raise HTTPException(status_code=400, detail="No pages could be crawled from that site.")
    return results


def _tokenize(text: str) -> set:
    return set(re.findall(r"\b\w+\b", text.lower()))


def search_knowledge(query: str, client_db_id, db: Session, top_k: int = 3) -> List[KnowledgeChunk]:
    chunks = db.query(KnowledgeChunk).filter(KnowledgeChunk.client_id == client_db_id).all()
    if not chunks:
        return []
    query_tokens = _tokenize(query)
    if not query_tokens:
        return []
    scored = []
    for chunk in chunks:
        overlap = len(query_tokens & _tokenize(chunk.chunk_text))
        if overlap > 0:
            scored.append((overlap / len(query_tokens), chunk))
    scored.sort(key=lambda x: x[0], reverse=True)
    return [chunk for _, chunk in scored[:top_k]]
