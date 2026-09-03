import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import DateTime, ForeignKey, String, Text, func, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, IdMixin


class PropertyCheck(IdMixin, Base):
    """One logged contact attempt against a property (the agent's call log).

    Append-only in spirit, though — unlike `property_status_events` — not enforced by a
    trigger: a check records who was called, the outcome, the terms discussed, and when
    the property is next due. `created_at` is set to the logical check time by
    `service.log_check` (falling back to the server default for any other insert).
    """

    __tablename__ = "property_checks"

    property_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("properties.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # SET NULL, not CASCADE: a departed agent's checks are history worth keeping.
    agent_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    contact_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("contacts.id", ondelete="SET NULL")
    )
    channel: Mapped[str] = mapped_column(
        String(16), nullable=False, default="call", server_default="call"
    )  # call | telegram | ...
    outcome: Mapped[str] = mapped_column(String(24), nullable=False)
    note: Mapped[str | None] = mapped_column(Text)
    terms: Mapped[dict[str, Any]] = mapped_column(
        JSONB, nullable=False, default=dict, server_default=text("'{}'::jsonb")
    )
    next_check_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
