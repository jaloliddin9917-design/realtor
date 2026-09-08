import uuid
from collections.abc import AsyncIterator
from datetime import timedelta
from pathlib import Path

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ingestion import pipeline
from app.ingestion.adapters.base import RawRef
from app.ingestion.pipeline import ingest_payload, run_source
from app.modules.dedupe.config import load_config
from app.modules.listings.models import CrawlRun, Listing, ListingPhoto, RawListing, Source
from app.modules.listings.service import SeenWindow
from app.modules.properties.models import Property
from tests.fakes import NOW, FakeAdapter
from tests.fakes import payload as _payload

CFG = load_config(Path(__file__).resolve().parents[1] / "config" / "dedupe.yaml")


async def _source(db: AsyncSession) -> Source:
    s = Source(kind="telegram", name="@t", config={"peer": "@t"}, interval_seconds=900)
    db.add(s)
    await db.flush()
    return s


OWNER = (
    "Chilonzor, Qatortol, 2-xonali, 3/9 qavat, 54 m², evro remont. Egasidan. 450$. Tel 90 811 24 37"
)
AGENT = "Chilonzor Qatortol 2 xonali 3/9 qavat 55 m² evro remont 480$ xizmat 50% tel 93 402 18 55"
OTHER = "Yunusobod 11-kvartal 3-xonali 5/9 78 m² 650$ tel 94 128 44 60"


async def test_ingest_payload_creates_listing_property_photos_and_owner(
    db: AsyncSession, tmp_path: Path
) -> None:
    s = await _source(db)
    adapter = FakeAdapter([], None)
    result = await ingest_payload(
        db,
        s,
        _payload("1", OWNER, photos=["1", "2", "bad"]),
        adapter=adapter,
        cfg=CFG,
        photo_dir=tmp_path,
        now=NOW,
    )
    assert result.created and result.decision == "new" and result.property.status == "new"
    photos = (
        (
            await db.execute(
                select(ListingPhoto)
                .where(ListingPhoto.listing_id == result.listing.id)
                .order_by(ListingPhoto.position)
            )
        )
        .scalars()
        .all()
    )
    assert [p.download_error is None for p in photos] == [True, True, False]
    assert (
        result.property.probable_owner_contact_id is not None
        and result.property.district == "chilonzor"
    )


async def test_download_photos_false_hotlinks_without_downloading(
    db: AsyncSession, tmp_path: Path
) -> None:
    s = await _source(db)
    adapter = FakeAdapter([], None)
    urls = ["https://cdn.example/a.jpg", "https://cdn.example/b.jpg"]
    result = await ingest_payload(
        db,
        s,
        _payload("1", OWNER, photos=urls),
        adapter=adapter,
        cfg=CFG,
        photo_dir=tmp_path,
        now=NOW,
        download_photos=False,
    )
    photos = (
        (
            await db.execute(
                select(ListingPhoto)
                .where(ListingPhoto.listing_id == result.listing.id)
                .order_by(ListingPhoto.position)
            )
        )
        .scalars()
        .all()
    )
    # Not a single byte fetched, yet every photo is stored as a clean hotlink row: CDN url kept,
    # no re-hosted file/hash, and no error (so re-crawls don't retry and dedupe omits null phash).
    assert adapter.downloads == 0
    assert [p.source_url for p in photos] == urls
    assert all(
        p.storage_key is None and p.phash is None and p.download_error is None for p in photos
    )


async def test_run_source_end_to_end_with_dedupe(db: AsyncSession, tmp_path: Path) -> None:
    s = await _source(db)
    adapter = FakeAdapter(
        [
            _payload("1", OWNER, NOW - timedelta(days=1), photos=["1"]),
            _payload("2", AGENT, NOW, photos=["1"]),  # same photo, other phone → review
            _payload(
                "2b", "Chilonzor 2-xonali 3/9 455$ tel 90 811 24 37", NOW, photos=["1"]
            ),  # same phone + photo → attached
            _payload("3", OTHER, NOW),
        ],
        SeenWindow(ids={"1", "2", "2b", "3"}, oldest_posted_at=NOW - timedelta(days=1)),
    )
    run = await run_source(db, adapter, s, cfg=CFG, photo_dir=tmp_path, now=NOW)
    assert (run.found, run.new, run.changed, run.failed, run.removed) == (4, 4, 0, 0, 0)
    assert (await db.execute(select(func.count()).select_from(Property))).scalar_one() == 3
    owner_listing = (
        await db.execute(select(Listing).join(RawListing).where(RawListing.external_id == "1"))
    ).scalar_one()
    attached = (
        await db.execute(select(Listing).join(RawListing).where(RawListing.external_id == "2b"))
    ).scalar_one()
    assert attached.property_id == owner_listing.property_id
    await db.refresh(s)
    assert (
        s.last_run_at == NOW and s.next_run_at == NOW + timedelta(seconds=900) and s.status == "ok"
    )


async def test_second_run_skips_unchanged_and_updates_changed(
    db: AsyncSession, tmp_path: Path
) -> None:
    s = await _source(db)
    window = SeenWindow(ids={"1"}, oldest_posted_at=NOW - timedelta(days=1))
    first = await run_source(
        db, FakeAdapter([_payload("1", OWNER)], window), s, cfg=CFG, photo_dir=tmp_path, now=NOW
    )
    second = await run_source(
        db,
        FakeAdapter([_payload("1", OWNER)], window),
        s,
        cfg=CFG,
        photo_dir=tmp_path,
        now=NOW + timedelta(minutes=15),
    )
    third = await run_source(
        db,
        FakeAdapter([_payload("1", OWNER.replace("450$", "430$"))], window),
        s,
        cfg=CFG,
        photo_dir=tmp_path,
        now=NOW + timedelta(minutes=30),
    )
    assert (first.new, second.new, second.changed, third.changed) == (1, 0, 0, 1)
    assert (await db.execute(select(func.count()).select_from(Listing))).scalar_one() == 1
    listing = (await db.execute(select(Listing))).scalar_one()
    assert listing.price_usd_minor == 43000


async def test_failed_ref_does_not_stop_the_run(db: AsyncSession, tmp_path: Path) -> None:
    s = await _source(db)
    adapter = FakeAdapter([_payload("1", OWNER), _payload("2", OTHER)], None, fail_ids={"1"})
    run = await run_source(db, adapter, s, cfg=CFG, photo_dir=tmp_path, now=NOW)
    assert (run.found, run.new, run.failed) == (2, 1, 1)
    assert (await db.execute(select(func.count()).select_from(Listing))).scalar_one() == 1


async def test_removed_after_three_runs_and_property_flagged(
    db: AsyncSession, tmp_path: Path
) -> None:
    s = await _source(db)
    seen = SeenWindow(ids={"1"}, oldest_posted_at=NOW - timedelta(days=1))
    await run_source(
        db, FakeAdapter([_payload("1", OWNER)], seen), s, cfg=CFG, photo_dir=tmp_path, now=NOW
    )
    gone = SeenWindow(ids=set(), oldest_posted_at=NOW - timedelta(days=1))
    for i in range(1, 4):
        run = await run_source(
            db,
            FakeAdapter([], gone),
            s,
            cfg=CFG,
            photo_dir=tmp_path,
            now=NOW + timedelta(minutes=15 * i),
        )
    assert run.removed == 1
    prop = (await db.execute(select(Property))).scalar_one()
    assert prop.source_removed is True and prop.status == "new"


async def test_removal_recompute_touches_only_this_runs_removals(
    db: AsyncSession, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    s = await _source(db)
    seen_both = SeenWindow(ids={"1", "3"}, oldest_posted_at=NOW - timedelta(days=1))
    await run_source(
        db,
        FakeAdapter([_payload("1", OWNER), _payload("3", OTHER)], seen_both),
        s,
        cfg=CFG,
        photo_dir=tmp_path,
        now=NOW,
    )
    # listing 1 disappears and is removed after three misses
    gone_1 = SeenWindow(ids={"3"}, oldest_posted_at=NOW - timedelta(days=1))
    for i in range(1, 4):
        t1 = NOW + timedelta(minutes=15 * i)
        run = await run_source(
            db,
            FakeAdapter([_payload("3", OTHER)], gone_1),
            s,
            cfg=CFG,
            photo_dir=tmp_path,
            now=t1,
        )
    assert run.removed == 1
    prop_1 = (
        await db.execute(
            select(Property).join(Listing).join(RawListing).where(RawListing.external_id == "1")
        )
    ).scalar_one()
    # Set up call counter for recompute
    calls: list[uuid.UUID] = []
    real_recompute = pipeline.recompute

    async def counting_recompute(session: AsyncSession, prop: Property) -> None:
        calls.append(prop.id)
        await real_recompute(session, prop)

    monkeypatch.setattr(pipeline, "recompute", counting_recompute)
    # later, listing 3 disappears too; property 1 must not be recomputed again
    gone_all = SeenWindow(ids=set(), oldest_posted_at=NOW - timedelta(days=1))
    for i in range(4, 7):
        t2 = NOW + timedelta(minutes=15 * i)
        run = await run_source(
            db,
            FakeAdapter([], gone_all),
            s,
            cfg=CFG,
            photo_dir=tmp_path,
            now=t2,
        )
    assert run.removed == 1
    prop_3 = (
        await db.execute(
            select(Property).join(Listing).join(RawListing).where(RawListing.external_id == "3")
        )
    ).scalar_one()
    assert prop_1.id not in calls and prop_3.id in calls


async def test_discover_failure_is_recorded(db: AsyncSession, tmp_path: Path) -> None:
    class Broken(FakeAdapter):
        async def discover(self, source: Source) -> AsyncIterator[RawRef]:
            raise RuntimeError("flood")
            yield  # pragma: no cover

    s = await _source(db)
    with pytest.raises(RuntimeError, match="flood"):
        await run_source(db, Broken([], None), s, cfg=CFG, photo_dir=tmp_path, now=NOW)
    run = (await db.execute(select(CrawlRun))).scalar_one()
    await db.refresh(s)
    assert run.error == "flood" and run.finished_at is not None
    assert s.consecutive_failures == 1 and s.status == "failing"


async def test_parse_failure_keeps_raw_row_with_error(db: AsyncSession, tmp_path: Path) -> None:
    s = await _source(db)
    adapter = FakeAdapter([_payload("1", OWNER, structured={"rooms": "3-xonali"})], None)
    run = await run_source(db, adapter, s, cfg=CFG, photo_dir=tmp_path, now=NOW)
    assert run.failed == 1
    raw = (await db.execute(select(RawListing).where(RawListing.external_id == "1"))).scalar_one()
    assert raw.parse_error is not None and raw.parse_error.startswith("ValidationError")
    listing = (
        await db.execute(select(Listing).where(Listing.raw_listing_id == raw.id))
    ).scalar_one_or_none()
    assert listing is None


async def test_reappearing_listing_unflags_property(db: AsyncSession, tmp_path: Path) -> None:
    s = await _source(db)
    seen = SeenWindow(ids={"1"}, oldest_posted_at=NOW - timedelta(days=1))
    await run_source(
        db, FakeAdapter([_payload("1", OWNER)], seen), s, cfg=CFG, photo_dir=tmp_path, now=NOW
    )
    gone = SeenWindow(ids=set(), oldest_posted_at=NOW - timedelta(days=1))
    for i in range(1, 4):
        run = await run_source(
            db,
            FakeAdapter([], gone),
            s,
            cfg=CFG,
            photo_dir=tmp_path,
            now=NOW + timedelta(minutes=15 * i),
        )
    assert run.removed == 1
    prop = (await db.execute(select(Property))).scalar_one()
    assert prop.source_removed is True

    later = NOW + timedelta(minutes=90)
    seen_again = SeenWindow(ids={"1"}, oldest_posted_at=later - timedelta(days=1))
    await run_source(
        db,
        FakeAdapter([_payload("1", OWNER, later)], seen_again),
        s,
        cfg=CFG,
        photo_dir=tmp_path,
        now=later,
    )
    await db.refresh(prop)
    assert prop.source_removed is False


async def test_mark_seen_advances_property_last_seen_at(db: AsyncSession, tmp_path: Path) -> None:
    s = await _source(db)
    window = SeenWindow(ids={"1"}, oldest_posted_at=NOW - timedelta(days=1))
    await run_source(
        db, FakeAdapter([_payload("1", OWNER)], window), s, cfg=CFG, photo_dir=tmp_path, now=NOW
    )
    later = NOW + timedelta(hours=2)
    # The adapter finds nothing new to fetch this run, but the source's seen window still
    # covers "1" (e.g. it is within the channel's recent-history window without having
    # changed) — mark_seen still bumps listings.last_seen_at via its bulk UPDATE.
    await run_source(db, FakeAdapter([], window), s, cfg=CFG, photo_dir=tmp_path, now=later)
    prop = (await db.execute(select(Property))).scalar_one()
    assert prop.last_seen_at == later


async def test_failed_photo_is_retried_on_next_run(db: AsyncSession, tmp_path: Path) -> None:
    s = await _source(db)
    window = SeenWindow(ids={"1"}, oldest_posted_at=NOW - timedelta(days=1))
    adapter = FakeAdapter([_payload("1", OWNER, photos=["bad"])], window)
    await run_source(db, adapter, s, cfg=CFG, photo_dir=tmp_path, now=NOW)
    photo = (await db.execute(select(ListingPhoto))).scalar_one()
    assert photo.download_error is not None and photo.phash is None

    adapter.bad_photo_refs = set()
    later = NOW + timedelta(hours=1)
    await run_source(db, adapter, s, cfg=CFG, photo_dir=tmp_path, now=later)
    await db.refresh(photo)
    assert photo.download_error is None and photo.phash is not None


async def test_three_discover_failures_pause_the_source(db: AsyncSession, tmp_path: Path) -> None:
    class Broken(FakeAdapter):
        async def discover(self, source: Source) -> AsyncIterator[RawRef]:
            raise RuntimeError("flood")
            yield  # pragma: no cover

    s = await _source(db)
    for _ in range(3):
        with pytest.raises(RuntimeError, match="flood"):
            await run_source(db, Broken([], None), s, cfg=CFG, photo_dir=tmp_path, now=NOW)
    await db.refresh(s)
    assert s.consecutive_failures == 3
    assert s.status == "failing"
    assert s.paused_until == NOW + timedelta(hours=1)

    await run_source(db, FakeAdapter([], None), s, cfg=CFG, photo_dir=tmp_path, now=NOW)
    await db.refresh(s)
    assert s.consecutive_failures == 0
    assert s.status == "ok"


async def test_repeated_backoff_escalates_the_pause_and_success_clears_it(
    db: AsyncSession, tmp_path: Path
) -> None:
    s = await _source(db)
    for run_no, minutes in enumerate((1, 2, 4), start=1):
        await run_source(
            db,
            FakeAdapter([], None, backoff_on_discover=timedelta(minutes=1)),
            s,
            cfg=CFG,
            photo_dir=tmp_path,
            now=NOW,
        )
        assert (s.status, s.paused_until) == ("paused", NOW + timedelta(minutes=minutes))
        assert s.state["backoff_level"] == run_no
    assert s.consecutive_failures == 0  # a backoff is never a failure

    await run_source(db, FakeAdapter([], None), s, cfg=CFG, photo_dir=tmp_path, now=NOW)
    assert s.status == "ok" and "backoff_level" not in s.state


async def test_backoff_honours_a_retry_after_longer_than_the_level(
    db: AsyncSession, tmp_path: Path
) -> None:
    # a Telegram flood wait states how long the server wants; the escalating level is a
    # floor, never a ceiling
    s = await _source(db)
    await run_source(
        db,
        FakeAdapter([], None, backoff_on_discover=timedelta(hours=2)),
        s,
        cfg=CFG,
        photo_dir=tmp_path,
        now=NOW,
    )
    assert s.paused_until == NOW + timedelta(hours=2) and s.state["backoff_level"] == 1


async def test_seen_only_listing_unflags_property(db: AsyncSession, tmp_path: Path) -> None:
    s = await _source(db)
    seen = SeenWindow(ids={"1"}, oldest_posted_at=NOW - timedelta(days=1))
    await run_source(
        db, FakeAdapter([_payload("1", OWNER)], seen), s, cfg=CFG, photo_dir=tmp_path, now=NOW
    )
    gone = SeenWindow(ids=set(), oldest_posted_at=NOW - timedelta(days=1))
    for i in range(1, 4):
        run = await run_source(
            db,
            FakeAdapter([], gone),
            s,
            cfg=CFG,
            photo_dir=tmp_path,
            now=NOW + timedelta(minutes=15 * i),
        )
    assert run.removed == 1
    prop = (await db.execute(select(Property))).scalar_one()
    assert prop.source_removed is True
    later = NOW + timedelta(minutes=90)
    await run_source(
        db,
        FakeAdapter([], SeenWindow(ids={"1"}, oldest_posted_at=later - timedelta(days=1))),
        s,
        cfg=CFG,
        photo_dir=tmp_path,
        now=later,
    )
    await db.refresh(prop)
    assert prop.source_removed is False
    assert prop.last_seen_at == later
