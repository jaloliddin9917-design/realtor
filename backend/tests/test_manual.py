from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ingestion.manual import (
    ManualAdapter,
    ManualListingForm,
    ensure_manual_source,
    form_payload,
    ingest_form,
    ingest_url,
    pick_source,
)
from app.ingestion.pipeline import run_source, store_raw
from app.ingestion.registry import AdapterRegistry
from app.modules.contacts.service import contacts_for_listing
from app.modules.dedupe.config import load_config
from app.modules.listings.models import ListingPhoto, RawListing, Source
from app.modules.listings.service import SeenWindow
from tests.fakes import FakeAdapter, UrlFake, payload
from tests.helpers import make_jpeg

CFG = load_config(Path(__file__).resolve().parents[1] / "config" / "dedupe.yaml")
NOW = datetime(2026, 8, 30, 12, 0, tzinfo=UTC)


async def test_ingest_url_routes_by_host_and_prefers_the_enabled_source(
    db: AsyncSession, tmp_path: Path
) -> None:
    olx_source = Source(kind="olx", name="olx", config={"url": "x"}, enabled=True)
    db.add(olx_source)
    await db.flush()
    olx = UrlFake(
        "olx", payload("65000001", "Chilonzor 2-xonali 3/9 450$ tel 90 811 24 37", photos=["1"])
    )
    tg = UrlFake("telegram", payload("-100:5", "Yunusobod 3-xonali 650$"))
    registry = AdapterRegistry({"olx": olx, "telegram": tg})  # type: ignore[dict-item]
    result = await ingest_url(
        db,
        "https://www.olx.uz/d/obyavlenie/x-ID1.html",
        registry,
        cfg=CFG,
        photo_dir=tmp_path,
        now=NOW,
    )
    assert result.created and olx.urls == ["https://www.olx.uz/d/obyavlenie/x-ID1.html"]
    raw = (await db.execute(select(RawListing))).scalar_one()
    assert raw.source_id == olx_source.id and raw.external_id == "65000001"
    assert (await db.execute(select(ListingPhoto))).scalars().one().phash is not None
    result2 = await ingest_url(
        db, "https://t.me/toshkent_ijara/5", registry, cfg=CFG, photo_dir=tmp_path, now=NOW
    )
    manual = (
        await pick_source(db, "manual")
        or (await db.execute(select(Source).where(Source.kind == "manual"))).scalar_one()
    )
    assert (
        result2.listing.raw.source_id == manual.id
    )  # no enabled telegram source → the manual source
    with pytest.raises(ValueError):
        await ingest_url(
            db, "https://example.com/flat", registry, cfg=CFG, photo_dir=tmp_path, now=NOW
        )


async def test_manually_added_listing_is_not_missed_by_the_crawlers_removal_sweep(
    db: AsyncSession, tmp_path: Path
) -> None:
    """A pasted link is attributed to the crawled source of that kind (so a later crawl
    of the same ad updates that row instead of duplicating it) — but the crawler never
    walked it: it may be in another category, or past `olx_max_pages`. Counting it as
    missed would flag a perfectly live ad `source_removed` after three runs, so
    `apply_misses` only sweeps rows the crawler itself brought in (`ingested_via`).

    Once a crawl *does* reach the ad, the row becomes a crawled one and is swept
    normally from then on.
    """
    crawled = Source(kind="olx", name="olx-crawled", config={"url": "x"}, enabled=True)
    db.add(crawled)
    await db.flush()
    ad = payload("65000042", "Chilonzor 2-xonali 3/9 qavat 54 m² 450$ tel 90 811 24 37")
    registry = AdapterRegistry({"olx": UrlFake("olx", ad)})  # type: ignore[dict-item]
    result = await ingest_url(
        db,
        "https://www.olx.uz/d/obyavlenie/x-ID42.html",
        registry,
        cfg=CFG,
        photo_dir=tmp_path,
        now=NOW,
    )
    listing = result.listing
    assert listing.raw.source_id == crawled.id and listing.raw.ingested_via == "manual"

    nothing = SeenWindow(ids=set(), oldest_posted_at=NOW - timedelta(days=1))
    for run in range(1, 4):
        await run_source(
            db,
            FakeAdapter([], nothing),
            crawled,
            cfg=CFG,
            photo_dir=tmp_path,
            now=NOW + timedelta(hours=run),
        )
    await db.refresh(listing)
    assert (listing.miss_count, listing.source_removed) == (0, False)

    raw, _, _ = await store_raw(db, crawled, ad, NOW + timedelta(hours=4))
    assert raw.ingested_via == "crawl"  # the crawl took the row over
    for run in range(5, 8):
        await run_source(
            db,
            FakeAdapter([], nothing),
            crawled,
            cfg=CFG,
            photo_dir=tmp_path,
            now=NOW + timedelta(hours=run),
        )
    await db.refresh(listing)
    assert (listing.miss_count, listing.source_removed) == (3, True)


async def test_ingest_form_builds_listing_with_photos_and_phone(
    db: AsyncSession, tmp_path: Path
) -> None:
    form = ManualListingForm(
        title="Mirobod, Oybek",
        description="3-xonali, 4/5 qavat, 80 m²",
        price_amount_minor=70000,
        price_currency="USD",
        rooms=3,
        floor=4,
        total_floors=5,
        area_sqm=80.0,
        district="mirobod",
        phone="97 715 60 02",
    )
    result = await ingest_form(
        db,
        form,
        [make_jpeg(300, 200, 1), make_jpeg(300, 200, 2)],
        cfg=CFG,
        photo_dir=tmp_path,
        now=NOW,
    )
    listing = result.listing
    assert (
        listing.price_usd_minor,
        listing.rooms,
        listing.floor,
        listing.total_floors,
        listing.area_sqm,
        listing.district,
    ) == (70000, 3, 4, 5, 80.0, "mirobod")
    assert listing.raw.external_id.startswith("form:") and listing.raw.payload["photo_count"] == 2
    photos = (
        (await db.execute(select(ListingPhoto).order_by(ListingPhoto.position))).scalars().all()
    )
    assert [p.phash is not None for p in photos] == [True, True]
    manual = await ensure_manual_source(db)
    assert listing.raw.source_id == manual.id and manual.enabled is False
    assert [(c.kind, c.identifier) for c in await contacts_for_listing(db, listing.id)] == [
        ("phone", "+998977156002")
    ]


async def test_ensure_manual_source_is_idempotent(db: AsyncSession) -> None:
    a = await ensure_manual_source(db)
    b = await ensure_manual_source(db)
    assert (
        a.id == b.id
        and (await db.execute(select(Source).where(Source.kind == "manual"))).scalars().one().name
        == "manual"
    )


async def test_ingest_url_rejects_telegram_me(db: AsyncSession, tmp_path: Path) -> None:
    """`telegram.me` is a dead route: `TelegramAdapter.fetch_by_url` only ever accepts
    `t.me` links, so it must be treated like any other unsupported host, not routed to
    the telegram adapter at all. An empty registry is enough — a correct fix never
    calls into it for this host.
    """
    registry = AdapterRegistry({})
    with pytest.raises(ValueError, match="unsupported url"):
        await ingest_url(
            db, "https://telegram.me/x/5", registry, cfg=CFG, photo_dir=tmp_path, now=NOW
        )


async def test_manual_adapter_rebuild_payload_round_trips_stored_form(
    db: AsyncSession, tmp_path: Path
) -> None:
    form = ManualListingForm(
        title="Chilonzor",
        description="2-xonali, 3/9 qavat",
        price_amount_minor=45000,
        price_currency="USD",
        rooms=2,
        floor=3,
        total_floors=9,
        area_sqm=54.0,
        district="chilonzor",
        phone="90 811 24 37",
    )
    photos = [make_jpeg(300, 200, 1), make_jpeg(300, 200, 2)]
    result = await ingest_form(db, form, photos, cfg=CFG, photo_dir=tmp_path, now=NOW)
    raw = (
        await db.execute(select(RawListing).where(RawListing.id == result.listing.raw_listing_id))
    ).scalar_one()
    original = form_payload(raw.external_id, form, len(photos), NOW)
    rebuilt = await ManualAdapter().rebuild_payload(raw)
    assert rebuilt.external_id == original.external_id
    assert rebuilt.text == original.text
    assert rebuilt.structured == original.structured
    assert rebuilt.contact_hints == original.contact_hints
    assert rebuilt.photo_refs == original.photo_refs


async def test_ingest_form_with_zero_photos_never_calls_download_photo(
    db: AsyncSession, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    calls: list[Any] = []
    real_download = ManualAdapter.download_photo

    async def counting_download_photo(self: ManualAdapter, ref: Any) -> bytes:
        calls.append(ref)
        return await real_download(self, ref)

    monkeypatch.setattr(ManualAdapter, "download_photo", counting_download_photo)
    form = ManualListingForm(title="Sergeli", description="1-xonali kvartira")
    result = await ingest_form(db, form, [], cfg=CFG, photo_dir=tmp_path, now=NOW)
    assert result.created
    assert calls == []
    assert (await db.execute(select(ListingPhoto))).scalars().all() == []


async def test_ingest_form_with_unnormalisable_phone_creates_no_contact(
    db: AsyncSession, tmp_path: Path
) -> None:
    form = ManualListingForm(title="Sergeli", description="1-xonali kvartira", phone="12345")
    assert form_payload("form:x", form, 0, NOW).contact_hints == []
    result = await ingest_form(db, form, [], cfg=CFG, photo_dir=tmp_path, now=NOW)
    assert await contacts_for_listing(db, result.listing.id) == []
