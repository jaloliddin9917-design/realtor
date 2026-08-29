from datetime import UTC, datetime, timedelta
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ingestion.parse import parse_text
from app.modules.contacts.service import contacts_for_listing
from app.modules.listings.models import Listing, Source
from app.modules.listings.service import (
    SeenWindow,
    age_out,
    apply_misses,
    content_hash,
    mark_seen,
    persist_parsed,
    upsert_raw,
)

NOW = datetime(2026, 8, 29, 12, 0, tzinfo=UTC)
TEXT = "Chilonzor, 2-xonali, 3/9, 54 m², 450$. Egasidan. Tel 90 811 24 37"


async def _source(db: AsyncSession) -> Source:
    s = Source(kind="telegram", name="@t", config={})
    db.add(s)
    await db.flush()
    return s


def test_content_hash_is_order_independent() -> None:
    assert content_hash({"a": 1, "b": [1, 2]}) == content_hash({"b": [1, 2], "a": 1})


async def test_upsert_raw_detects_new_and_changed(db: AsyncSession) -> None:
    s = await _source(db)
    raw, changed = await upsert_raw(db, s.id, "1", None, {"text": "a"}, NOW)
    assert changed is True
    same, changed = await upsert_raw(db, s.id, "1", None, {"text": "a"}, NOW + timedelta(minutes=1))
    assert (same.id, changed) == (raw.id, False)
    same, changed = await upsert_raw(db, s.id, "1", None, {"text": "b"}, NOW + timedelta(minutes=2))
    assert (same.id, changed) == (raw.id, True)
    assert same.payload == {"text": "b"}


async def test_persist_parsed_is_idempotent_and_links_contacts(db: AsyncSession) -> None:
    s = await _source(db)
    raw, _ = await upsert_raw(db, s.id, "1", "https://t.me/t/1", {"text": TEXT}, NOW)
    parsed = parse_text(TEXT, sender_username="arenda_tsh")
    listing = await persist_parsed(
        db,
        raw,
        parsed,
        posted_at=NOW,
        now=NOW,
        usd_rate=Decimal("12000"),
        contacts=[("olx_user", "42")],
    )
    again = await persist_parsed(
        db,
        raw,
        parsed,
        posted_at=NOW,
        now=NOW + timedelta(hours=1),
        usd_rate=Decimal("12000"),
        contacts=[],
    )
    assert listing.id == again.id
    assert again.price_usd_minor == 45000 and again.district == "chilonzor" and again.owner_marker
    assert again.last_seen_at == NOW + timedelta(hours=1) and again.first_seen_at == NOW
    identities = {(c.kind, c.identifier) for c in await contacts_for_listing(db, listing.id)}
    assert identities == {
        ("phone", "+998908112437"),
        ("telegram", "arenda_tsh"),
        ("olx_user", "42"),
    }


async def test_reappearing_listing_is_unremoved(db: AsyncSession) -> None:
    s = await _source(db)
    raw, _ = await upsert_raw(db, s.id, "1", None, {"text": TEXT}, NOW)
    parsed = parse_text(TEXT)
    listing = await persist_parsed(
        db, raw, parsed, posted_at=NOW, now=NOW, usd_rate=None, contacts=[]
    )
    gone = SeenWindow(ids=set(), oldest_posted_at=NOW - timedelta(days=1))
    for i in range(1, 4):
        await apply_misses(db, s.id, gone, NOW + timedelta(minutes=15 * i))
    await db.refresh(listing)
    assert listing.source_removed is True and listing.removed_at is not None

    later = NOW + timedelta(hours=2)
    await persist_parsed(db, raw, parsed, posted_at=later, now=later, usd_rate=None, contacts=[])
    await db.refresh(listing)
    assert listing.source_removed is False
    assert listing.removed_at is None
    assert listing.miss_count == 0


async def test_uzs_price_is_converted_with_rate(db: AsyncSession) -> None:
    s = await _source(db)
    raw, _ = await upsert_raw(db, s.id, "2", None, {"text": "x"}, NOW)
    parsed = parse_text("Yunusobod 3-xonali 6 000 000 so'm")
    listing = await persist_parsed(
        db, raw, parsed, posted_at=NOW, now=NOW, usd_rate=Decimal("12000"), contacts=[]
    )
    assert listing.price_usd_minor == 50000


async def _three_listings(db: AsyncSession, s: Source) -> list[Listing]:
    out = []
    for i in range(3):
        raw, _ = await upsert_raw(db, s.id, str(i), None, {"text": str(i)}, NOW)
        posted = NOW - timedelta(days=i)
        out.append(
            await persist_parsed(
                db,
                raw,
                parse_text("2-xonali"),
                posted_at=posted,
                now=NOW,
                usd_rate=None,
                contacts=[],
            )
        )
    return out


async def test_misses_remove_after_three_consecutive_runs(db: AsyncSession) -> None:
    s = await _source(db)
    listings = await _three_listings(db, s)
    window = SeenWindow(ids={"0", "1"}, oldest_posted_at=NOW - timedelta(days=2))
    for run in range(1, 4):
        t = NOW + timedelta(minutes=15 * run)
        assert await mark_seen(db, s.id, window, t) == 2
        removed = await apply_misses(db, s.id, window, t)
        await db.refresh(listings[2])
        assert listings[2].miss_count == run
        assert removed == (1 if run == 3 else 0)
    assert listings[2].source_removed and listings[2].removed_at is not None
    await db.refresh(listings[0])
    assert listings[0].miss_count == 0 and not listings[0].source_removed


async def test_listings_outside_window_are_not_counted_as_missed(db: AsyncSession) -> None:
    s = await _source(db)
    listings = await _three_listings(db, s)
    window = SeenWindow(ids={"0"}, oldest_posted_at=NOW)  # only today's post is visible
    await apply_misses(db, s.id, window, NOW)
    await db.refresh(listings[2])
    assert listings[2].miss_count == 0


async def test_seen_resets_miss_count(db: AsyncSession) -> None:
    s = await _source(db)
    listings = await _three_listings(db, s)
    await apply_misses(
        db, s.id, SeenWindow(ids=set(), oldest_posted_at=NOW - timedelta(days=5)), NOW
    )
    await mark_seen(db, s.id, SeenWindow(ids={"2"}, oldest_posted_at=None), NOW)
    await db.refresh(listings[2])
    assert listings[2].miss_count == 0


async def test_age_out_after_30_days(db: AsyncSession) -> None:
    s = await _source(db)
    await _three_listings(db, s)
    assert await age_out(db, NOW + timedelta(days=31)) == 3
    rows = (
        (await db.execute(select(Listing).where(Listing.source_removed.is_(True)))).scalars().all()
    )
    assert len(rows) == 3


async def test_mark_seen_unremoves_listing(db: AsyncSession) -> None:
    s = await _source(db)
    listings = await _three_listings(db, s)
    window = SeenWindow(ids={"0", "1"}, oldest_posted_at=NOW - timedelta(days=2))
    for run in range(1, 4):
        t = NOW + timedelta(minutes=15 * run)
        await mark_seen(db, s.id, window, t)
        await apply_misses(db, s.id, window, t)
    await db.refresh(listings[2])
    assert listings[2].source_removed is True and listings[2].removed_at is not None
    later = NOW + timedelta(minutes=60)
    await mark_seen(db, s.id, SeenWindow(ids={"2"}, oldest_posted_at=None), later)
    await db.refresh(listings[2])
    assert listings[2].source_removed is False
    assert listings[2].removed_at is None
    assert listings[2].miss_count == 0
