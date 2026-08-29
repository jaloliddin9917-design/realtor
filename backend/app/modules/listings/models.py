import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import (
    BigInteger,
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base, IdMixin, TimestampMixin


class Source(IdMixin, TimestampMixin, Base):
    __tablename__ = "sources"

    kind: Mapped[str] = mapped_column(String(16), nullable=False)  # telegram | olx | manual
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    config: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    state: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    interval_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=900)
    next_run_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_run_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    consecutive_failures: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    paused_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default="ok"
    )  # ok | failing | login_required | paused


class CrawlRun(IdMixin, Base):
    __tablename__ = "crawl_runs"

    source_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("sources.id", ondelete="CASCADE"), nullable=False, index=True
    )
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    found: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    new: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    changed: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    failed: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    removed: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    error: Mapped[str | None] = mapped_column(Text)


class RawListing(IdMixin, TimestampMixin, Base):
    __tablename__ = "raw_listings"
    __table_args__ = (UniqueConstraint("source_id", "external_id", name="uq_raw_source_external"),)

    source_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("sources.id", ondelete="CASCADE"), nullable=False
    )
    external_id: Mapped[str] = mapped_column(String(120), nullable=False)
    url: Mapped[str | None] = mapped_column(Text)
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    content_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    fetched_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    parse_error: Mapped[str | None] = mapped_column(Text)

    source: Mapped[Source] = relationship()


class Listing(IdMixin, TimestampMixin, Base):
    __tablename__ = "listings"
    __table_args__ = (
        Index("ix_listings_attr_key", "district", "rooms", "floor", "total_floors"),
        Index(
            "ix_listings_description_trgm",
            "description",
            postgresql_using="gin",
            postgresql_ops={"description": "gin_trgm_ops"},
        ),
    )

    raw_listing_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("raw_listings.id", ondelete="CASCADE"), unique=True, nullable=False
    )
    property_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("properties.id", ondelete="SET NULL"), index=True
    )
    title: Mapped[str] = mapped_column(Text, nullable=False, default="")
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    price_amount_minor: Mapped[int | None] = mapped_column(BigInteger)
    price_currency: Mapped[str | None] = mapped_column(String(3))
    price_usd_minor: Mapped[int | None] = mapped_column(BigInteger)
    rooms: Mapped[int | None] = mapped_column(Integer)
    area_sqm: Mapped[float | None] = mapped_column(Float)
    floor: Mapped[int | None] = mapped_column(Integer)
    total_floors: Mapped[int | None] = mapped_column(Integer)
    district: Mapped[str | None] = mapped_column(String(32))
    address_text: Mapped[str | None] = mapped_column(Text)
    posted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    first_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    miss_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    source_removed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    removed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    owner_marker: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    agent_marker: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    parse_confidence: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)

    raw: Mapped[RawListing] = relationship()
    photos: Mapped[list["ListingPhoto"]] = relationship(
        back_populates="listing", cascade="all, delete-orphan", order_by="ListingPhoto.position"
    )
    contact_links: Mapped[list["ListingContact"]] = relationship(
        back_populates="listing", cascade="all, delete-orphan"
    )


class ListingContact(Base):
    __tablename__ = "listing_contacts"

    listing_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("listings.id", ondelete="CASCADE"), primary_key=True
    )
    contact_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("contacts.id", ondelete="CASCADE"), primary_key=True
    )

    listing: Mapped[Listing] = relationship(back_populates="contact_links")


class ListingPhoto(IdMixin, Base):
    __tablename__ = "listing_photos"
    __table_args__ = (
        Index(
            "ix_listing_photos_bucket",
            text("((phash >> 48) & 65535)"),
            postgresql_where=text("phash IS NOT NULL"),
        ),
    )

    listing_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("listings.id", ondelete="CASCADE"), nullable=False, index=True
    )
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    storage_key: Mapped[str | None] = mapped_column(Text)
    sha256: Mapped[str | None] = mapped_column(String(64))
    phash: Mapped[int | None] = mapped_column(BigInteger, index=True)
    width: Mapped[int | None] = mapped_column(Integer)
    height: Mapped[int | None] = mapped_column(Integer)
    download_error: Mapped[str | None] = mapped_column(Text)

    listing: Mapped[Listing] = relationship(back_populates="photos")


class FxRate(Base):
    __tablename__ = "fx_rates"

    date: Mapped[date] = mapped_column(Date, primary_key=True)
    usd_uzs: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    fetched_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
