from datetime import UTC, datetime
from pathlib import Path

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ingestion.adapters.base import RawPayload
from app.ingestion.manual import (
    ManualListingForm,
    ensure_manual_source,
    ingest_form,
    ingest_url,
    pick_source,
)
from app.ingestion.registry import AdapterRegistry
from app.modules.dedupe.config import load_config
from app.modules.listings.models import ListingPhoto, RawListing, Source
from tests.fakes import FakeAdapter, payload
from tests.helpers import make_jpeg

CFG = load_config(Path(__file__).resolve().parents[1] / "config" / "dedupe.yaml")
NOW = datetime(2026, 8, 30, 12, 0, tzinfo=UTC)


class UrlFake(FakeAdapter):
    def __init__(self, kind: str, p: RawPayload) -> None:
        super().__init__([p], None)
        self.kind = kind
        self.urls: list[str] = []

    async def fetch_by_url(self, url: str) -> RawPayload:
        self.urls.append(url)
        return self.payloads[0]


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
    from app.modules.contacts.service import contacts_for_listing

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
