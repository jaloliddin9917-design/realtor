import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.ingestion.parse import parse_text
from app.modules.listings.models import Listing, Source
from app.modules.listings.service import persist_parsed, upsert_raw
from app.modules.properties.service import (
    attach,
    create_from_listing,
    recompute,
    set_status,
    status_history,
)

NOW = datetime(2026, 8, 29, 12, 0, tzinfo=UTC)


async def _listing(
    db: AsyncSession, source: Source, ext: str, text_: str, posted: datetime, now: datetime = NOW
) -> Listing:
    raw, _ = await upsert_raw(db, source.id, ext, None, {"text": text_}, now)
    return await persist_parsed(
        db, raw, parse_text(text_), posted_at=posted, now=now, usd_rate=None, contacts=[]
    )


async def _source(db: AsyncSession) -> Source:
    s = Source(kind="telegram", name="@t", config={})
    db.add(s)
    await db.flush()
    return s


async def test_create_from_listing_sets_new_status_and_event(db: AsyncSession) -> None:
    s = await _source(db)
    listing = await _listing(db, s, "1", "Chilonzor 2-xonali 3/9 54 m² 450$", NOW)
    prop = await create_from_listing(db, listing, NOW)
    assert prop.status == "new" and listing.property_id == prop.id
    assert (prop.district, prop.rooms, prop.floor, prop.total_floors, prop.area_sqm) == (
        "chilonzor",
        2,
        3,
        9,
        54.0,
    )
    assert prop.price_usd_min_minor == 45000
    history = await status_history(db, prop.id)
    assert [(e.from_status, e.to_status, e.actor_type) for e in history] == [
        (None, "new", "crawler")
    ]


async def test_attach_recomputes_min_price_and_best_attributes(db: AsyncSession) -> None:
    s = await _source(db)
    first = await _listing(db, s, "1", "Chilonzor 2-xonali 3/9 480$", NOW - timedelta(days=2))
    prop = await create_from_listing(db, first, NOW)
    second = await _listing(db, s, "2", "Chilonzor 2-xonali 3/9 54 m² 450$ tel 90 811 24 37", NOW)
    await attach(db, prop, second, NOW)
    assert prop.price_usd_min_minor == 45000
    assert prop.area_sqm == 54.0  # from the higher-confidence listing
    assert prop.first_seen_at == NOW - timedelta(days=2) or prop.first_seen_at == NOW
    assert prop.last_seen_at == NOW


async def test_recompute_flags_source_removed_only_when_all_listings_removed(
    db: AsyncSession,
) -> None:
    s = await _source(db)
    a = await _listing(db, s, "1", "2-xonali", NOW)
    prop = await create_from_listing(db, a, NOW)
    b = await _listing(db, s, "2", "2-xonali", NOW)
    await attach(db, prop, b, NOW)
    a.source_removed = True
    await recompute(db, prop)
    assert prop.source_removed is False
    b.source_removed = True
    await recompute(db, prop)
    assert prop.source_removed is True


async def test_search_vector_is_built(db: AsyncSession) -> None:
    s = await _source(db)
    a = await _listing(db, s, "1", "Chilonzor Qatortol evro remont", NOW)
    prop = await create_from_listing(db, a, NOW)
    hit = (
        await db.execute(
            text(
                "SELECT 1 FROM properties WHERE id = :id AND search_vector @@ "
                "plainto_tsquery('simple', 'qatortol')"
            ),
            {"id": prop.id},
        )
    ).first()
    assert hit is not None


async def test_set_status_writes_event_and_rejects_unknown(db: AsyncSession) -> None:
    s = await _source(db)
    prop = await create_from_listing(db, await _listing(db, s, "1", "2-xonali", NOW), NOW)
    agent = uuid.uuid4()
    ev = await set_status(db, prop, "active", actor_type="agent", actor_id=agent, note="bo'sh")
    assert (prop.status, ev.from_status, ev.to_status, ev.actor_id) == (
        "active",
        "new",
        "active",
        agent,
    )
    same = await set_status(db, prop, "active", actor_type="agent", actor_id=agent)
    assert same.id == ev.id
    with pytest.raises(ValueError):
        await set_status(db, prop, "rented", actor_type="agent")
    with pytest.raises(ValueError):
        await set_status(db, prop, "inactive", actor_type="visitor")
    assert [e.to_status for e in await status_history(db, prop.id)] == ["active", "new"]
