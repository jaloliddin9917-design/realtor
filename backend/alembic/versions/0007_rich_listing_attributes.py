"""rich apartments: location + attribute columns on listings and properties

Adds the coordinates (approximate — radius + precise flag travel with them), a
human-readable location label, and the parsed attributes (building type, furnished,
renovation, year built) that already sit unparsed in raw_listings.payload, plus a
display-only JSONB `attributes` bag on listings. Populated by a network-free `reparse`.

Revision ID: 0007
Revises: 0006
Create Date: 2026-09-05
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def _shared_columns() -> list[sa.Column]:
    """Fresh Column objects each call — a Column instance belongs to one table, and
    SQLAlchemy 2.0 removed Column.copy(), so listings and properties each get their own."""
    return [
        sa.Column("latitude", sa.Float(), nullable=True),
        sa.Column("longitude", sa.Float(), nullable=True),
        sa.Column("location_radius_m", sa.Integer(), nullable=True),
        sa.Column("location_label", sa.Text(), nullable=True),
        sa.Column("building_type", sa.String(length=16), nullable=True),
        sa.Column("is_furnished", sa.Boolean(), nullable=True),
        sa.Column("renovation", sa.String(length=16), nullable=True),
        sa.Column("year_built", sa.Integer(), nullable=True),
    ]


def upgrade() -> None:
    for col in _shared_columns():
        op.add_column("listings", col)
    op.add_column("listings", sa.Column("location_precise", sa.Boolean(), nullable=True))
    op.add_column(
        "listings",
        sa.Column(
            "attributes",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
    )
    for col in _shared_columns():
        op.add_column("properties", col)
    op.create_index(
        "ix_properties_lat_lon",
        "properties",
        ["latitude", "longitude"],
        postgresql_where=sa.text("latitude IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("ix_properties_lat_lon", table_name="properties")
    for name in (
        "latitude",
        "longitude",
        "location_radius_m",
        "location_label",
        "building_type",
        "is_furnished",
        "renovation",
        "year_built",
    ):
        op.drop_column("properties", name)
    for name in (
        "attributes",
        "latitude",
        "longitude",
        "location_radius_m",
        "location_precise",
        "location_label",
        "building_type",
        "is_furnished",
        "renovation",
        "year_built",
    ):
        op.drop_column("listings", name)
