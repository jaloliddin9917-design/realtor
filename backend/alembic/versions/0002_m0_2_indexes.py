"""m0-2 indexes: listing_contacts(contact_id), unique listing_photos(listing_id, position)

Revision ID: 0002
Revises: 0001
Create Date: 2026-08-30
"""

from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index("ix_listing_contacts_contact_id", "listing_contacts", ["contact_id"])
    op.create_unique_constraint(
        "uq_listing_photos_listing_position", "listing_photos", ["listing_id", "position"]
    )


def downgrade() -> None:
    op.drop_constraint("uq_listing_photos_listing_position", "listing_photos", type_="unique")
    op.drop_index("ix_listing_contacts_contact_id", table_name="listing_contacts")
