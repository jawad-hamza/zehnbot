"""Enquiries: contact requests to the platform operator, captured from the landing page.

Revision ID: 0006
Revises: 0005
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "enquiries",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String(255), nullable=True),
        sa.Column("email", sa.String(255), nullable=True),
        sa.Column("phone", sa.String(50), nullable=True),
        sa.Column("company", sa.String(255), nullable=True),
        sa.Column("plan", sa.String(32), nullable=True),
        sa.Column("message", sa.Text, nullable=True),
        sa.Column("source", sa.String(32), nullable=False, server_default="landing"),
        sa.Column("status", sa.String(16), nullable=False, server_default="new"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_enquiries_status_created", "enquiries", ["status", "created_at"])


def downgrade() -> None:
    op.drop_index("ix_enquiries_status_created", table_name="enquiries")
    op.drop_table("enquiries")
