"""m0-2 fix: unique constraint on sources.name

Revision ID: 0003_sources_name_unique
Revises: 0002
Create Date: 2026-08-30
"""

from alembic import op

revision = "0003_sources_name_unique"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_unique_constraint("uq_sources_name", "sources", ["name"])


def downgrade() -> None:
    op.drop_constraint("uq_sources_name", "sources", type_="unique")
