"""Bots can use any OpenAI-compatible endpoint (provider "custom"): store its base URL.

Revision ID: 0004
Revises: 0003
"""
import sqlalchemy as sa
from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("clients", sa.Column("ai_base_url", sa.String(500), nullable=True))


def downgrade() -> None:
    op.drop_column("clients", "ai_base_url")
