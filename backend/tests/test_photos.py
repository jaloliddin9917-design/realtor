import uuid
from datetime import UTC, datetime
from pathlib import Path

from sqlalchemy.ext.asyncio import AsyncSession

from app.ingestion.photos import (
    hamming,
    phash_bucket,
    phash_to_signed,
    save_listing_photo,
    store_photo,
)
from app.modules.listings.models import Listing, RawListing, Source
from tests.helpers import make_jpeg as _jpeg


def test_store_photo_resizes_and_hashes(tmp_path: Path) -> None:
    listing_id = uuid.uuid4()
    stored = store_photo(tmp_path, listing_id, 0, _jpeg(2000, 1000))
    assert (stored.width, stored.height) == (1280, 640)
    assert stored.storage_key == f"{listing_id}/0.jpg"
    assert (tmp_path / stored.storage_key).exists()
    assert len(stored.sha256) == 64
    assert -(1 << 63) <= stored.phash < (1 << 63)


def test_same_image_scaled_has_near_zero_hamming(tmp_path: Path) -> None:
    a = store_photo(tmp_path, uuid.uuid4(), 0, _jpeg(1600, 1200))
    b = store_photo(tmp_path, uuid.uuid4(), 0, _jpeg(800, 600))
    assert hamming(a.phash, b.phash) <= 6
    assert phash_bucket(a.phash) == phash_bucket(b.phash)


def test_different_images_are_far_apart(tmp_path: Path) -> None:
    a = store_photo(tmp_path, uuid.uuid4(), 0, _jpeg(800, 600, seed=0))
    b = store_photo(tmp_path, uuid.uuid4(), 0, _jpeg(800, 600, seed=97))
    assert hamming(a.phash, b.phash) > 10


def test_phash_signed_conversion_round_trips_bucket() -> None:
    signed = phash_to_signed("ffff000000000000")
    assert signed < 0
    assert phash_bucket(signed) == 0xFFFF
    assert phash_bucket(phash_to_signed("0001000000000000")) == 1


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


async def test_save_listing_photo_is_idempotent_and_records_errors(
    db: AsyncSession, tmp_path: Path
) -> None:
    listing = await _listing(db)
    first = await save_listing_photo(db, tmp_path, listing, 0, _jpeg(400, 300))
    again = await save_listing_photo(db, tmp_path, listing, 0, _jpeg(400, 300))
    failed = await save_listing_photo(db, tmp_path, listing, 1, None, error="timeout")
    assert first.id == again.id and first.phash is not None
    assert failed.download_error == "timeout" and failed.phash is None


async def test_failed_retry_clears_previous_success_fields(
    db: AsyncSession, tmp_path: Path
) -> None:
    listing = await _listing(db)
    first = await save_listing_photo(db, tmp_path, listing, 0, _jpeg(400, 300))
    assert first.phash is not None and first.storage_key is not None
    failed = await save_listing_photo(db, tmp_path, listing, 0, None, error="timeout")
    assert failed.id == first.id and failed.download_error == "timeout"
    assert (
        failed.phash,
        failed.storage_key,
        failed.sha256,
        failed.width,
        failed.height,
    ) == (None, None, None, None, None)


async def test_undecodable_bytes_are_recorded_not_raised(db: AsyncSession, tmp_path: Path) -> None:
    listing = await _listing(db)
    photo = await save_listing_photo(db, tmp_path, listing, 0, b"definitely not an image")
    assert photo.phash is None and photo.storage_key is None
    assert photo.download_error is not None and photo.download_error.startswith(
        "undecodable image:"
    )
