import hashlib
import io
import uuid
from dataclasses import dataclass
from pathlib import Path

import anyio.to_thread
import imagehash
from PIL import Image, ImageOps
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.listings.models import Listing, ListingPhoto

_MASK = (1 << 64) - 1


@dataclass
class StoredPhoto:
    storage_key: str
    sha256: str
    phash: int
    width: int
    height: int


def phash_to_signed(hex_hash: str) -> int:
    value = int(hex_hash, 16) & _MASK
    return value - (1 << 64) if value >= (1 << 63) else value


def phash_bucket(phash: int) -> int:
    return ((phash & _MASK) >> 48) & 0xFFFF


def _mark_failed(photo: ListingPhoto, error: str) -> None:
    photo.download_error = error[:500]
    photo.storage_key = photo.sha256 = photo.phash = photo.width = photo.height = None


def hamming(a: int, b: int) -> int:
    return bin((a ^ b) & _MASK).count("1")


def store_photo(
    photo_dir: Path, listing_id: uuid.UUID, position: int, data: bytes, max_side: int = 1280
) -> StoredPhoto:
    with Image.open(io.BytesIO(data)) as opened:
        # `exif_transpose` returns a *new* image when the EXIF orientation is not 1, and
        # `convert` another one on top of it; without closing the intermediate, every
        # rotated photo leaks a decoded buffer for the rest of the run.
        transposed = ImageOps.exif_transpose(opened) or opened
        try:
            img = transposed.convert("RGB")
        finally:
            if transposed is not opened:
                transposed.close()
        with img:
            img.thumbnail((max_side, max_side), Image.Resampling.LANCZOS)
            key = f"{listing_id}/{position}.jpg"
            target = photo_dir / key
            target.parent.mkdir(parents=True, exist_ok=True)
            img.save(target, format="JPEG", quality=85, optimize=True)
            hashed = phash_to_signed(str(imagehash.phash(img)))
            width, height = img.width, img.height
    return StoredPhoto(
        storage_key=key,
        sha256=hashlib.sha256(data).hexdigest(),
        phash=hashed,
        width=width,
        height=height,
    )


async def save_listing_photo(
    session: AsyncSession,
    photo_dir: Path,
    listing: Listing,
    position: int,
    data: bytes | None,
    error: str | None = None,
    source_url: str | None = None,
) -> ListingPhoto:
    stmt = select(ListingPhoto).where(
        ListingPhoto.listing_id == listing.id, ListingPhoto.position == position
    )
    photo = (await session.execute(stmt)).scalar_one_or_none()
    if photo is None:
        photo = ListingPhoto(listing_id=listing.id, position=position)
        session.add(photo)
    # The source URL is known even when the download fails — keep it so the image can still be
    # hotlinked (a failed re-host doesn't mean the CDN URL is unusable).
    if source_url is not None:
        photo.source_url = source_url
    if data is None:
        _mark_failed(photo, error or "download failed")
    else:
        try:
            # decode, resize, perceptual-hash and write to disk: hundreds of
            # milliseconds of CPU and blocking file IO per photo, on the same event loop
            # that serves the API (`POST /listings/manual*`) and the worker's other
            # sources — so it runs in a thread, never inline.
            stored = await anyio.to_thread.run_sync(
                store_photo, photo_dir, listing.id, position, data
            )
        except (OSError, ValueError, Image.DecompressionBombError) as exc:
            # undecodable/truncated bytes, an oversized "bomb" image, or the photo dir
            # not writable
            _mark_failed(photo, f"undecodable image: {exc}")
        else:
            photo.storage_key = stored.storage_key
            photo.sha256 = stored.sha256
            photo.phash = stored.phash
            photo.width = stored.width
            photo.height = stored.height
            photo.download_error = None
    await session.flush()
    return photo


async def prune_photos(session: AsyncSession, photo_dir: Path, listing: Listing, keep: int) -> int:
    """Delete `ListingPhoto` rows (and their files) at or past `keep`.

    Called after a changed payload re-ingest with fewer photos than before, so stale
    rows/files from the previous version of the post don't linger.
    """
    stmt = select(ListingPhoto).where(
        ListingPhoto.listing_id == listing.id, ListingPhoto.position >= keep
    )
    extra = list((await session.execute(stmt)).scalars().all())
    for photo in extra:
        if photo.storage_key:
            (photo_dir / photo.storage_key).unlink(missing_ok=True)
        await session.delete(photo)
    await session.flush()
    return len(extra)
