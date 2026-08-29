from datetime import UTC, datetime

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.contacts.models import Contact
from app.modules.listings.models import Listing, RawListing, Source
from app.modules.properties.models import Property, PropertyStatusEvent


async def test_round_trip_source_raw_listing_property(db: AsyncSession) -> None:
    source = Source(kind="telegram", name="@test", config={"peer": "@test"})
    db.add(source)
    await db.flush()
    raw = RawListing(
        source_id=source.id,
        external_id="1:1",
        url=None,
        payload={"text": "x"},
        content_hash="h",
        fetched_at=datetime.now(UTC),
    )
    db.add(raw)
    prop = Property(status="new", first_seen_at=datetime.now(UTC), last_seen_at=datetime.now(UTC))
    db.add(prop)
    await db.flush()
    listing = Listing(
        raw_listing_id=raw.id,
        property_id=prop.id,
        title="t",
        description="d",
        first_seen_at=datetime.now(UTC),
        last_seen_at=datetime.now(UTC),
    )
    db.add(listing)
    contact = Contact(kind="phone", identifier="+998901234567")
    db.add(contact)
    await db.flush()
    assert listing.id and contact.id and prop.status == "new"


async def test_status_events_are_append_only(db: AsyncSession) -> None:
    prop = Property(status="new", first_seen_at=datetime.now(UTC), last_seen_at=datetime.now(UTC))
    db.add(prop)
    await db.flush()
    ev = PropertyStatusEvent(
        property_id=prop.id, from_status=None, to_status="new", actor_type="crawler"
    )
    db.add(ev)
    await db.flush()
    # Each statement runs in its own savepoint: the trigger aborts the savepoint on
    # failure, so without one the UPDATE's failure would poison the whole transaction
    # and the following DELETE could never run.
    with pytest.raises(DBAPIError):
        async with db.begin_nested():
            await db.execute(
                text("UPDATE property_status_events SET note = 'x' WHERE id = :id"), {"id": ev.id}
            )
    with pytest.raises(DBAPIError):
        async with db.begin_nested():
            await db.execute(
                text("DELETE FROM property_status_events WHERE id = :id"), {"id": ev.id}
            )


async def test_contact_identity_is_unique(db: AsyncSession) -> None:
    db.add(Contact(kind="phone", identifier="+998901234567"))
    await db.flush()
    db.add(Contact(kind="phone", identifier="+998901234567"))
    with pytest.raises(DBAPIError):
        await db.flush()


async def test_photo_bucket_index_exists(db: AsyncSession) -> None:
    indexdef = (
        await db.execute(
            text(
                "SELECT indexdef FROM pg_indexes "
                "WHERE tablename = 'listing_photos' AND indexname = 'ix_listing_photos_bucket'"
            )
        )
    ).scalar_one()
    assert "(phash >> 48)" in indexdef
    # Postgres renders the bigint literal with an explicit cast in the stored indexdef.
    assert "& (65535)" in indexdef
    assert "WHERE (phash IS NOT NULL)" in indexdef
