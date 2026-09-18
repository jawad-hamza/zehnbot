"""Insights and chat-captured leads.

  * messages.unanswered  marks bot replies that could not answer (feeds the dashboard's to-do list)
  * leads.source         "form" (widget form) or "chat" (details typed into the conversation)

The pgvector `embedding` column is NOT created here: it depends on an optional Postgres extension,
so scripts/migrate.py adds it whenever the extension is available.

Revision ID: 0003
Revises: 0002
"""
import sqlalchemy as sa
from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("messages", sa.Column("unanswered", sa.Boolean, nullable=False, server_default=sa.false()))
    op.add_column("leads", sa.Column("source", sa.String(16), nullable=False, server_default="form"))
    # one lead per conversation is looked up on every chat turn
    op.create_index("ix_leads_conversation_id", "leads", ["conversation_id"])


def downgrade() -> None:
    op.drop_index("ix_leads_conversation_id", table_name="leads")
    op.drop_column("leads", "source")
    op.drop_column("messages", "unanswered")
