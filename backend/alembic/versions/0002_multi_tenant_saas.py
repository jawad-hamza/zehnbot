"""Multi-tenant SaaS: tenants, roles, usage metering, encrypted keys, full-text search.

Existing data is preserved:
  * every existing admin becomes a super admin
  * existing bots are moved into a tenant called "Default"
  * plaintext AI keys are encrypted with ENCRYPTION_KEY
  * duplicate conversations (same bot + session) are merged before the unique constraint is added

Revision ID: 0002
Revises: 0001
"""
import uuid

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None

ENC_PREFIX = "enc:v1:"


def _now():
    return sa.text("now()")


def upgrade() -> None:
    bind = op.get_bind()

    # ---- tenants and metering ----
    op.create_table(
        "tenants",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("plan", sa.String(32), nullable=False, server_default="free"),
        sa.Column("monthly_message_quota", sa.Integer, nullable=False, server_default="200"),
        sa.Column("max_bots", sa.Integer, nullable=False, server_default="1"),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=_now()),
    )
    op.create_table(
        "usage_counters",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("period", sa.String(7), nullable=False),
        sa.Column("messages", sa.Integer, nullable=False, server_default="0"),
        sa.Column("platform_messages", sa.Integer, nullable=False, server_default="0"),
        sa.Column("tokens", sa.Integer, nullable=False, server_default="0"),
        sa.UniqueConstraint("tenant_id", "period", name="uq_usage_tenant_period"),
    )
    op.create_index("ix_usage_counters_tenant_id", "usage_counters", ["tenant_id"])

    # ---- admins -> users with roles ----
    op.rename_table("admins", "users")
    op.execute("ALTER INDEX IF EXISTS admins_pkey RENAME TO users_pkey")
    op.execute("ALTER TABLE users DROP CONSTRAINT IF EXISTS admins_email_key")
    op.create_index("ix_users_email", "users", ["email"], unique=True)
    op.add_column("users", sa.Column("role", sa.String(32), nullable=False, server_default="tenant_admin"))
    op.add_column("users", sa.Column("is_active", sa.Boolean, nullable=False, server_default=sa.true()))
    op.add_column("users", sa.Column("tenant_id", UUID(as_uuid=True), nullable=True))
    op.create_foreign_key("fk_users_tenant_id", "users", "tenants", ["tenant_id"], ["id"], ondelete="CASCADE")
    op.create_index("ix_users_tenant_id", "users", ["tenant_id"])
    # Everyone who could log in before was a platform operator
    op.execute("UPDATE users SET role = 'superadmin'")

    # ---- bots belong to a tenant ----
    op.add_column("clients", sa.Column("tenant_id", UUID(as_uuid=True), nullable=True))
    if bind.execute(sa.text("SELECT count(*) FROM clients")).scalar():
        default_tenant = uuid.uuid4()
        bind.execute(
            sa.text(
                "INSERT INTO tenants (id, name, plan, monthly_message_quota, max_bots) "
                "VALUES (CAST(:id AS uuid), 'Default', 'business', 50000, 50)"
            ),
            {"id": str(default_tenant)},
        )
        bind.execute(sa.text("UPDATE clients SET tenant_id = CAST(:id AS uuid)"), {"id": str(default_tenant)})
    op.alter_column("clients", "tenant_id", nullable=False)
    op.create_foreign_key("fk_clients_tenant_id", "clients", "tenants", ["tenant_id"], ["id"], ondelete="CASCADE")
    op.create_index("ix_clients_tenant_id", "clients", ["tenant_id"])

    # ---- encrypt stored AI keys ----
    op.alter_column("clients", "ai_api_key", type_=sa.Text, existing_nullable=True)
    plaintext = bind.execute(
        sa.text("SELECT id, ai_api_key FROM clients WHERE ai_api_key IS NOT NULL AND ai_api_key <> '' AND ai_api_key NOT LIKE :p"),
        {"p": ENC_PREFIX + "%"},
    ).fetchall()
    if plaintext:
        from app.config import settings
        if not settings.ENCRYPTION_KEY:
            raise RuntimeError(
                "ENCRYPTION_KEY must be set before this migration can run: "
                f"{len(plaintext)} bot(s) have a plaintext AI key that needs encrypting."
            )
        from cryptography.fernet import Fernet
        fernet = Fernet(settings.ENCRYPTION_KEY.encode())
        for row_id, key in plaintext:
            bind.execute(
                sa.text("UPDATE clients SET ai_api_key = :v WHERE id = CAST(:id AS uuid)"),
                {"v": ENC_PREFIX + fernet.encrypt(key.encode()).decode(), "id": str(row_id)},
            )
    bind.execute(sa.text("UPDATE clients SET ai_api_key = NULL WHERE ai_api_key = ''"))

    # ---- one conversation per (bot, session): merge duplicates, then enforce ----
    op.execute(
        """
        CREATE TEMP TABLE conv_keep ON COMMIT DROP AS
        SELECT DISTINCT ON (client_id, session_id) id AS keep_id, client_id, session_id
        FROM conversations
        ORDER BY client_id, session_id, started_at, id
        """
    )
    for table in ("messages", "leads"):
        op.execute(
            f"""
            UPDATE {table} t SET conversation_id = k.keep_id
            FROM conversations c
            JOIN conv_keep k ON k.client_id = c.client_id AND k.session_id = c.session_id
            WHERE t.conversation_id = c.id AND c.id <> k.keep_id
            """
        )
    op.execute(
        """
        DELETE FROM conversations c USING conv_keep k
        WHERE c.client_id = k.client_id AND c.session_id = k.session_id AND c.id <> k.keep_id
        """
    )
    op.create_unique_constraint("uq_conversation_client_session", "conversations", ["client_id", "session_id"])
    op.create_index("ix_messages_conversation_created", "messages", ["conversation_id", "created_at"])

    # ---- indexed full-text search over knowledge ----
    op.execute(
        "ALTER TABLE knowledge_chunks ADD COLUMN search_vector tsvector "
        "GENERATED ALWAYS AS (to_tsvector('english', chunk_text)) STORED"
    )
    op.execute("CREATE INDEX ix_knowledge_chunks_search ON knowledge_chunks USING GIN (search_vector)")
    op.create_index("ix_knowledge_chunks_client_source", "knowledge_chunks", ["client_id", "source_label"])

    # ---- background ingest jobs ----
    op.create_table(
        "ingest_jobs",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("client_id", UUID(as_uuid=True), sa.ForeignKey("clients.id", ondelete="CASCADE"), nullable=False),
        sa.Column("kind", sa.String(16), nullable=False, server_default="crawl"),
        sa.Column("url", sa.String(2048), nullable=False),
        sa.Column("max_pages", sa.Integer, nullable=False, server_default="25"),
        sa.Column("status", sa.String(16), nullable=False, server_default="pending"),
        sa.Column("pages_crawled", sa.Integer, nullable=False, server_default="0"),
        sa.Column("chunks_created", sa.Integer, nullable=False, server_default="0"),
        sa.Column("error", sa.Text, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=_now()),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_ingest_jobs_client_id", "ingest_jobs", ["client_id"])


def downgrade() -> None:
    raise NotImplementedError(
        "Downgrading would discard tenants and leave AI keys encrypted. Restore from a backup instead."
    )
