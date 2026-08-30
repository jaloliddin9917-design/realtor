"""m0-2 fix: raw_listings.ingested_via — how the row got here (crawl | manual)

`apply_misses` only sweeps rows a crawler actually walked: a listing added by hand
(a pasted OLX/Telegram link) is attributed to the crawled source of that kind, but the
crawler may never list it (another category, past `olx_max_pages`), and counting it as
missed would flag a live ad `source_removed` after three runs.

Revision ID: 0004
Revises: 0003_sources_name_unique
Create Date: 2026-08-30
"""

import sqlalchemy as sa

from alembic import op

revision = "0004"
down_revision = "0003_sources_name_unique"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "raw_listings",
        sa.Column(
            "ingested_via",
            sa.String(length=16),
            nullable=False,
            server_default="crawl",
        ),
    )


def downgrade() -> None:
    op.drop_column("raw_listings", "ingested_via")
