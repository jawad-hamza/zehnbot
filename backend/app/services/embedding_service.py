"""Text embeddings for semantic knowledge search.

Everything here degrades instead of failing: no key, no pgvector, or a provider outage all
mean "keyword search only", never a broken chat or a rejected upload."""
import logging
import time
from typing import List, Optional

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.config import settings

logger = logging.getLogger(__name__)

BATCH_SIZE = 96
QUERY_TIMEOUT_SECONDS = 5.0     # a visitor is waiting, and a DB connection is held meanwhile
INGEST_TIMEOUT_SECONDS = 30.0
_COLUMN_RECHECK_SECONDS = 300

_column_state = {"present": False, "checked_at": None}


def embeddings_configured() -> bool:
    return bool(settings.embedding_api_key)


def vector_column_present(db: Session) -> bool:
    """Whether this database has the pgvector `embedding` column (created by scripts/migrate.py
    when the extension is installed). A positive answer is cached for the life of the process."""
    if db.get_bind().dialect.name != "postgresql":
        return False
    now = time.monotonic()
    last = _column_state["checked_at"]
    if _column_state["present"] or (last is not None and now - last < _COLUMN_RECHECK_SECONDS):
        return _column_state["present"]
    _column_state["checked_at"] = now
    _column_state["present"] = bool(db.execute(text(
        "SELECT 1 FROM information_schema.columns "
        "WHERE table_name = 'knowledge_chunks' AND column_name = 'embedding'"
    )).first())
    return _column_state["present"]


def semantic_search_available(db: Session) -> bool:
    return embeddings_configured() and vector_column_present(db)


def _client(timeout: float, max_retries: int):
    from openai import OpenAI
    api_key, base_url, _ = settings.embedding_endpoint
    return OpenAI(api_key=api_key, base_url=base_url or None, timeout=timeout, max_retries=max_retries)


def _embed(client, texts: List[str]) -> List[List[float]]:
    model = settings.embedding_endpoint[2]
    kwargs = {"model": model, "input": texts}
    if "text-embedding-3" in model:   # also "openai/text-embedding-3-small" via OpenRouter
        kwargs["dimensions"] = settings.EMBEDDING_DIMENSIONS   # only the v3 family accepts this
    response = client.embeddings.create(**kwargs)
    vectors = [item.embedding for item in sorted(response.data, key=lambda d: d.index)]
    if any(len(v) != settings.EMBEDDING_DIMENSIONS for v in vectors):
        raise ValueError(
            f"{model} returned {len(vectors[0])}-dimensional vectors, "
            f"but EMBEDDING_DIMENSIONS is {settings.EMBEDDING_DIMENSIONS}"
        )
    return vectors


def embed_documents(texts: List[str]) -> Optional[List[List[float]]]:
    """Embeddings for a batch of chunks, or None if they could not be produced."""
    if not texts or not embeddings_configured():
        return None
    try:
        client = _client(INGEST_TIMEOUT_SECONDS, max_retries=2)
        vectors: List[List[float]] = []
        for start in range(0, len(texts), BATCH_SIZE):
            vectors.extend(_embed(client, texts[start:start + BATCH_SIZE]))
        return vectors
    except Exception as exc:
        logger.warning("Embedding %d chunk(s) failed; they stay keyword-searchable only: %s", len(texts), exc)
        return None


def embed_query(query: str) -> Optional[List[float]]:
    if not embeddings_configured():
        return None
    try:
        return _embed(_client(QUERY_TIMEOUT_SECONDS, max_retries=0), [query])[0]
    except Exception as exc:
        logger.warning("Query embedding failed; falling back to keyword search: %s", exc)
        return None


def vector_literal(vector: List[float]) -> str:
    """pgvector's text input format. Built from floats only, so it is safe to bind as a string."""
    return "[" + ",".join(f"{float(x):.7g}" for x in vector) + "]"


def store_embeddings(db: Session, chunk_ids: List, vectors: List[List[float]]) -> None:
    db.execute(
        text("UPDATE knowledge_chunks SET embedding = CAST(:v AS vector) WHERE id = CAST(:id AS uuid)"),
        [{"id": str(cid), "v": vector_literal(vec)} for cid, vec in zip(chunk_ids, vectors)],
    )
    db.commit()


def reset_cache_for_tests() -> None:
    _column_state.update(present=False, checked_at=None)
