"""Replies the operator sends to an enquiry, kept so the conversation is on the record.

Revision ID: 0010
Revises: 0009
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision = "0010"
down_revision = "0009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "enquiry_replies",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("enquiry_id", UUID(as_uuid=True), sa.ForeignKey("enquiries.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("subject", sa.String(255), nullable=False),
        sa.Column("body", sa.Text, nullable=False),
        sa.Column("sent_by", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("delivered", sa.Boolean, nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table("enquiry_replies")
