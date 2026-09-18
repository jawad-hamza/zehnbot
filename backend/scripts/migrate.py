"""
Bring the database schema up to date. Runs on every container start.

Databases that were created by the old `create_all` startup have no Alembic history.
They already match revision 0001, so they are stamped there first and then upgraded,
which keeps all existing data.

  python scripts/migrate.py
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from alembic import command
from alembic.config import Config
from sqlalchemy import inspect, text

from app.config import settings
from app.database import engine

BACKEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))


def ensure_semantic_search() -> None:
    """Adds the pgvector column used for semantic knowledge search, if this Postgres can have it.

    Kept out of the Alembic chain on purpose: pgvector is an optional extension (the bundled
    `db` image has it, a managed Postgres may not). Without it the app simply stays on keyword
    search, and the column appears on the first start after the extension becomes available."""
    with engine.begin() as conn:
        available = conn.execute(text("SELECT 1 FROM pg_available_extensions WHERE name = 'vector'")).first()
        if not available:
            print("[migrate] pgvector is not installed in this Postgres: semantic search disabled, keyword search only")
            return
        conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
        existing = conn.execute(text(
            "SELECT format_type(a.atttypid, a.atttypmod) FROM pg_attribute a "
            "WHERE a.attrelid = 'knowledge_chunks'::regclass AND a.attname = 'embedding' AND NOT a.attisdropped"
        )).scalar()
        wanted = f"vector({int(settings.EMBEDDING_DIMENSIONS)})"
        if existing is None:
            conn.execute(text(f"ALTER TABLE knowledge_chunks ADD COLUMN embedding {wanted}"))
            print(f"[migrate] Semantic search enabled (embedding {wanted})")
        elif existing != wanted:
            # Vectors from a different model are not comparable, so they are discarded, never converted
            conn.execute(text("ALTER TABLE knowledge_chunks DROP COLUMN embedding"))
            conn.execute(text(f"ALTER TABLE knowledge_chunks ADD COLUMN embedding {wanted}"))
            print(f"[migrate] EMBEDDING_DIMENSIONS changed ({existing} -> {wanted}): run scripts/embed_backfill.py")


def main() -> None:
    cfg = Config(os.path.join(BACKEND_DIR, "alembic.ini"))
    cfg.set_main_option("script_location", os.path.join(BACKEND_DIR, "alembic"))

    tables = set(inspect(engine).get_table_names())
    if "alembic_version" not in tables and "clients" in tables:
        print("[migrate] Existing pre-migration database found; stamping baseline 0001")
        command.stamp(cfg, "0001")

    command.upgrade(cfg, "head")
    ensure_semantic_search()

    # A crawl that was running when the server stopped will never finish
    with engine.begin() as conn:
        conn.execute(text(
            "UPDATE ingest_jobs SET status = 'failed', error = 'Interrupted by a server restart', finished_at = now() "
            "WHERE status IN ('pending', 'running')"
        ))
    print("[migrate] Database is up to date")


if __name__ == "__main__":
    main()
