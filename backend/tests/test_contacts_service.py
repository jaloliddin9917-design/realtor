from datetime import UTC, datetime

from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.contacts.service import contacts_for_listing, get_or_create, link
from app.modules.listings.models import Listing, RawListing, Source


async def _listing(db: AsyncSession) -> Listing:
    source = Source(kind="telegram", name="@t", config={})
    db.add(source)
    await db.flush()
    raw = RawListing(
        source_id=source.id,
        external_id="1",
        payload={},
        content_hash="h",
        fetched_at=datetime.now(UTC),
    )
    db.add(raw)
    await db.flush()
    listing = Listing(
        raw_listing_id=raw.id, first_seen_at=datetime.now(UTC), last_seen_at=datetime.now(UTC)
    )
    db.add(listing)
    await db.flush()
    return listing


async def test_get_or_create_returns_same_row(db: AsyncSession) -> None:
    a = await get_or_create(db, "phone", "+998901234567")
    b = await get_or_create(db, "phone", "+998901234567", display_name="Aziz")
    assert a.id == b.id
    assert b.display_name == "Aziz"


async def test_link_is_idempotent(db: AsyncSession) -> None:
    listing = await _listing(db)
    c = await get_or_create(db, "telegram", "dilshod_uy")
    await link(db, listing.id, c.id)
    await link(db, listing.id, c.id)
    assert [x.identifier for x in await contacts_for_listing(db, listing.id)] == ["dilshod_uy"]
