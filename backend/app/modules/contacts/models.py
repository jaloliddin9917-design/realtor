from sqlalchemy import Float, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, IdMixin, TimestampMixin


class Contact(IdMixin, TimestampMixin, Base):
    __tablename__ = "contacts"
    __table_args__ = (UniqueConstraint("kind", "identifier", name="uq_contact_identity"),)

    kind: Mapped[str] = mapped_column(String(16), nullable=False)  # phone | telegram | olx_user
    identifier: Mapped[str] = mapped_column(String(64), nullable=False)
    display_name: Mapped[str | None] = mapped_column(String(120))
    agency_score: Mapped[float] = mapped_column(Float, nullable=False, default=0.5)
    classification: Mapped[str] = mapped_column(
        String(16), nullable=False, default="unknown"
    )  # owner | agent | unknown
    distinct_property_count_90d: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    human_decision: Mapped[str | None] = mapped_column(String(16))
