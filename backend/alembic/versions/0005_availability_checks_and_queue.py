"""m1-2: availability checks + agent queue

Adds the `property_checks` call-log table and the per-property scheduling/assignment
columns behind the Queue and Call-log screens: when a property was last checked and is
next due, which agent (if any) holds its short-lived lock, and the terms last confirmed.
`contacts.do_not_contact` records an owner who asked not to be called again.

Revision ID: 0005
Revises: 0004
Create Date: 2026-09-03
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "property_checks",
        sa.Column("property_id", sa.UUID(), nullable=False),
        sa.Column("agent_id", sa.UUID(), nullable=True),
        sa.Column("contact_id", sa.UUID(), nullable=True),
        sa.Column("channel", sa.String(length=16), server_default="call", nullable=False),
        sa.Column("outcome", sa.String(length=24), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column(
            "terms",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
        sa.Column("next_check_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["property_id"], ["properties.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["agent_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["contact_id"], ["contacts.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_property_checks_property_id"), "property_checks", ["property_id"], unique=False
    )

    op.add_column(
        "properties", sa.Column("last_checked_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.add_column(
        "properties", sa.Column("next_check_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.add_column("properties", sa.Column("assigned_agent_id", sa.UUID(), nullable=True))
    op.add_column(
        "properties", sa.Column("assignment_expires_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.add_column(
        "properties",
        sa.Column(
            "terms",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
    )
    op.create_foreign_key(
        "fk_properties_assigned_agent_id_users",
        "properties",
        "users",
        ["assigned_agent_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(
        op.f("ix_properties_assigned_agent_id"), "properties", ["assigned_agent_id"], unique=False
    )

    op.add_column(
        "contacts",
        sa.Column(
            "do_not_contact",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
    )


def downgrade() -> None:
    op.drop_column("contacts", "do_not_contact")
    op.drop_index(op.f("ix_properties_assigned_agent_id"), table_name="properties")
    op.drop_constraint("fk_properties_assigned_agent_id_users", "properties", type_="foreignkey")
    op.drop_column("properties", "terms")
    op.drop_column("properties", "assignment_expires_at")
    op.drop_column("properties", "assigned_agent_id")
    op.drop_column("properties", "next_check_at")
    op.drop_column("properties", "last_checked_at")
    op.drop_index(op.f("ix_property_checks_property_id"), table_name="property_checks")
    op.drop_table("property_checks")
