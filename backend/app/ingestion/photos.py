import hashlib
import io
import uuid
from dataclasses import dataclass
from pathlib import Path

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
        img = ImageOps.exif_transpose(opened) or opened
        img = img.convert("RGB")
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
) -> ListingPhoto:
    stmt = select(ListingPhoto).where(
        ListingPhoto.listing_id == listing.id, ListingPhoto.position == position
    )
    photo = (await session.execute(stmt)).scalar_one_or_none()
    if photo is None:
        photo = ListingPhoto(listing_id=listing.id, position=position)
        session.add(photo)
    if data is None:
        _mark_failed(photo, error or "download failed")
    else:
        try:
            stored = store_photo(photo_dir, listing.id, position, data)
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
