"""Baseline: the schema as it existed before migrations were introduced.

Databases created by the old `create_all` startup are stamped at this revision
by scripts/migrate.py instead of running it.

Revision ID: 0001
Revises:
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def _now():
    return sa.text("now()")


def upgrade() -> None:
    op.create_table(
        "admins",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("email", sa.String(255), nullable=False),
        sa.Column("hashed_password", sa.String(255), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=_now()),
        sa.UniqueConstraint("email", name="admins_email_key"),
    )

    op.create_table(
        "clients",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("domain", sa.String(255), nullable=False),
        sa.Column("client_id", sa.String(64), nullable=False),
        sa.Column("bot_name", sa.String(100), nullable=False),
        sa.Column("system_prompt", sa.Text, nullable=False),
        sa.Column("welcome_message", sa.Text, nullable=False),
        sa.Column("theme_color", sa.String(7), nullable=False),
        sa.Column("widget_position", sa.String(16), nullable=False),
        sa.Column("font_family", sa.String(200), nullable=True),
        sa.Column("custom_css", sa.Text, nullable=True),
        sa.Column("ai_provider", sa.String(32), nullable=False),
        sa.Column("ai_model", sa.String(100), nullable=True),
        sa.Column("ai_api_key", sa.String(255), nullable=True),
        sa.Column("is_active", sa.Boolean, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=_now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=_now()),
    )
    op.create_index("ix_clients_client_id", "clients", ["client_id"], unique=True)

    op.create_table(
        "knowledge_chunks",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("client_id", UUID(as_uuid=True), sa.ForeignKey("clients.id", ondelete="CASCADE"), nullable=False),
        sa.Column("chunk_text", sa.Text, nullable=False),
        sa.Column("chunk_index", sa.Integer, nullable=False),
        sa.Column("source_label", sa.String(255)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=_now()),
    )
    op.create_index("ix_knowledge_chunks_client_id", "knowledge_chunks", ["client_id"])

    op.create_table(
        "conversations",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("client_id", UUID(as_uuid=True), sa.ForeignKey("clients.id", ondelete="CASCADE"), nullable=False),
        sa.Column("session_id", sa.String(64), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), server_default=_now()),
        sa.Column("last_message_at", sa.DateTime(timezone=True), server_default=_now()),
    )
    op.create_index("ix_conversations_client_id", "conversations", ["client_id"])
    op.create_index("ix_conversations_session_id", "conversations", ["session_id"])

    op.create_table(
        "messages",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("conversation_id", UUID(as_uuid=True), sa.ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("role", sa.String(10), nullable=False),
        sa.Column("content", sa.Text, nullable=False),
        sa.Column("tokens_used", sa.Integer, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=_now()),
    )
    op.create_index("ix_messages_conversation_id", "messages", ["conversation_id"])
    op.create_index("ix_messages_created_at", "messages", ["created_at"])

    op.create_table(
        "leads",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("client_id", UUID(as_uuid=True), sa.ForeignKey("clients.id", ondelete="CASCADE"), nullable=False),
        sa.Column("conversation_id", UUID(as_uuid=True), sa.ForeignKey("conversations.id", ondelete="SET NULL"), nullable=True),
        sa.Column("name", sa.String(255), nullable=True),
        sa.Column("email", sa.String(255), nullable=True),
        sa.Column("phone", sa.String(50), nullable=True),
        sa.Column("raw_context", sa.Text, nullable=True),
        sa.Column("captured_at", sa.DateTime(timezone=True), server_default=_now()),
    )
    op.create_index("ix_leads_client_id", "leads", ["client_id"])
    op.create_index("ix_leads_email", "leads", ["email"])


def downgrade() -> None:
    for table in ("leads", "messages", "conversations", "knowledge_chunks", "clients", "admins"):
        op.drop_table(table)
