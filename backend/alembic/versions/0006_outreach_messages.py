"""m1: outreach (bot monitor) messages

Adds the `outreach_messages` table behind the Bot Monitor ("Xabarlar") screen: one row per
outbound availability check sent to a property's contact, plus the reply and its parsed
result. The outreach sender that writes these rows is not wired this milestone (sending is
gated off), so the table starts empty and the monitor honestly reports zeros.

Revision ID: 0006
Revises: 0005
Create Date: 2026-09-04
"""

import sqlalchemy as sa

from alembic import op

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "outreach_messages",
        sa.Column("property_id", sa.UUID(), nullable=False),
        sa.Column("contact_id", sa.UUID(), nullable=True),
        sa.Column("channel", sa.String(length=16), nullable=False),
        sa.Column("status", sa.String(length=16), server_default="queued", nullable=False),
        sa.Column("body", sa.Text(), nullable=True),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("reply_text", sa.Text(), nullable=True),
        sa.Column("reply_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("parsed_result", sa.String(length=16), nullable=True),
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["property_id"], ["properties.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["contact_id"], ["contacts.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_outreach_messages_property_id"),
        "outreach_messages",
        ["property_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_outreach_messages_property_id"), table_name="outreach_messages")
    op.drop_table("outreach_messages")
