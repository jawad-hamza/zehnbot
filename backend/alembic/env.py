import os
import sys
from logging.config import fileConfig
from sqlalchemy import engine_from_config, pool
from alembic import context

# Make the app importable
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.config import settings
from app.database import Base
import app.models  # noqa: F401 — ensures all models register with Base.metadata

config = context.config
# configparser treats "%" as interpolation, and passwords may contain it
config.set_main_option("sqlalchemy.url", settings.DATABASE_URL.replace("%", "%%"))

if config.config_file_name is not None:
    # keep the application's loggers alive when migrations run inside the app process
    fileConfig(config.config_file_name, disable_existing_loggers=False)

target_metadata = Base.metadata

# Postgres-only objects created by hand in migration 0002 and deliberately absent from the models.
# Without this, `alembic revision --autogenerate` would propose dropping the search index.
UNMAPPED = {
    ("column", "search_vector"), ("index", "ix_knowledge_chunks_search"),
    ("column", "embedding"),   # pgvector, added by scripts/migrate.py when the extension exists
}


def include_object(obj, name, type_, reflected, compare_to):
    return (type_, name) not in UNMAPPED


def run_migrations_offline() -> None:
    url = config.get_main_option("sqlalchemy.url")
    context.configure(url=url, target_metadata=target_metadata, literal_binds=True, include_object=include_object)
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata, include_object=include_object)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
