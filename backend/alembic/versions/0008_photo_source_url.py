"""listing photos: source_url (for hotlinking the CDN image)

Adds `source_url` to listing_photos — the photo's URL at the source (e.g. OLX CDN). The API
serves it to clients directly so images render on a split deploy (SPA and API on different
origins) without shipping the re-hosted photo files. Nullable; back-filled from
raw_listings.payload for existing rows by a separate script, populated going forward by the
ingestion pipeline.

Revision ID: 0008
Revises: 0007
Create Date: 2026-09-06
"""

import sqlalchemy as sa

from alembic import op

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("listing_photos", sa.Column("source_url", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("listing_photos", "source_url")
