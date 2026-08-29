from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ingestion.adapters.base import RawPayload, RawRef
from app.ingestion.pipeline import ingest_payload, run_source
from app.modules.dedupe.config import load_config
from app.modules.listings.models import CrawlRun, Listing, ListingPhoto, RawListing, Source
from app.modules.listings.service import SeenWindow
from app.modules.properties.models import Property
from tests.helpers import make_jpeg

NOW = datetime(2026, 8, 29, 12, 0, tzinfo=UTC)
CFG = load_config(Path(__file__).resolve().parents[1] / "config" / "dedupe.yaml")


def _jpeg(seed: int = 1) -> bytes:
    return make_jpeg(300, 200, seed)


class FakeAdapter:
    kind = "telegram"

    def __init__(
        self,
        payloads: list[RawPayload],
        window: SeenWindow | None,
        fail_ids: set[str] | None = None,
    ) -> None:
        self.payloads = payloads
        self.window = window
        self.fail_ids = fail_ids or set()
        self.downloads = 0

    async def discover(self, source: Source) -> AsyncIterator[RawRef]:
        for p in self.payloads:
            yield RawRef(external_id=p.external_id, url=p.url, posted_at=p.posted_at, meta={})

    async def fetch(self, ref: RawRef) -> RawPayload:
        if ref.external_id in self.fail_ids:
            raise RuntimeError("boom")
        return next(p for p in self.payloads if p.external_id == ref.external_id)

    async def seen_window(self, source: Source) -> SeenWindow | None:
        return self.window

    async def download_photo(self, ref: Any) -> bytes:
        self.downloads += 1
        if ref == "bad":
            raise RuntimeError("404")
        return _jpeg(int(ref))


def _payload(
    ext: str,
    text: str,
    posted: datetime = NOW,
    photos: list[Any] | None = None,
    username: str | None = None,
) -> RawPayload:
    return RawPayload(
        external_id=ext,
        url=f"https://t.me/t/{ext}",
        posted_at=posted,
        text=text,
        structured=None,
        sender_username=username,
        contact_hints=[],
        photo_refs=photos or [],
        payload={"text": text, "id": ext},
    )


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


async def test_discover_failure_is_recorded(db: AsyncSession, tmp_path: Path) -> None:
    class Broken(FakeAdapter):
        async def discover(self, source: Source) -> AsyncIterator[RawRef]:
            raise RuntimeError("flood")
            yield  # pragma: no cover

    s = await _source(db)
    try:
        await run_source(db, Broken([], None), s, cfg=CFG, photo_dir=tmp_path, now=NOW)
    except RuntimeError:
        pass
    run = (await db.execute(select(CrawlRun))).scalar_one()
    await db.refresh(s)
    assert run.error == "flood" and run.finished_at is not None
    assert s.consecutive_failures == 1 and s.status == "failing"
