"""
Create embeddings for knowledge that has none: chunks loaded before semantic search was switched
on, during an embeddings outage, or after EMBEDDING_DIMENSIONS changed. Safe to run at any time
and to re-run; it only touches chunks without an embedding.

  docker compose exec backend python scripts/embed_backfill.py
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import app.models  # noqa: F401
from app.database import SessionLocal
from app.services import embedding_service
from app.services.knowledge_service import backfill_embeddings


def main() -> None:
    db = SessionLocal()
    try:
        if not embedding_service.embeddings_configured():
            sys.exit("No embeddings key configured (EMBEDDING_API_KEY / OPENAI_API_KEY). Nothing to do.")
        if not embedding_service.vector_column_present(db):
            sys.exit("This database has no pgvector `embedding` column. Start the stack once with the bundled db image.")
        print(f"Embedded {backfill_embeddings(db)} chunk(s).")
    finally:
        db.close()


if __name__ == "__main__":
    main()
