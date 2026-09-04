import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, IdMixin


class OutreachMessage(IdMixin, Base):
    """One outbound availability check sent to a property's contact, plus its reply.

    The Bot Monitor ("Xabarlar") screen reads this table. Rows are written by the outreach
    sender once real Telegram/SMS sending is wired (see `service.record_outbound` /
    `record_reply`, gated by `service.sending_enabled`); nothing sends in this milestone, so
    the table is empty and the monitor honestly reports zeros. `parsed_result` is
    `parser.parse_reply`'s classification of `reply_text`, or the manual choice an agent picks
    when a reply came back `unclear`.
    """

    __tablename__ = "outreach_messages"

    property_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("properties.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # SET NULL, not CASCADE: a sent message is history worth keeping even if the contact is
    # later pruned.
    contact_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("contacts.id", ondelete="SET NULL")
    )
    channel: Mapped[str] = mapped_column(String(16), nullable=False)  # telegram | sms
    status: Mapped[str] = mapped_column(
        String(16), nullable=False, default="queued", server_default="queued"
    )  # queued | sent | answered | no_reply | error
    body: Mapped[str | None] = mapped_column(Text)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    reply_text: Mapped[str | None] = mapped_column(Text)
    reply_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    parsed_result: Mapped[str | None] = mapped_column(String(16))  # vacant | taken | unclear
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
