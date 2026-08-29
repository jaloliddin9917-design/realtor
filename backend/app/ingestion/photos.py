import hashlib
import io
import uuid
from dataclasses import dataclass
from pathlib import Path

import imagehash
from PIL import Image
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


def hamming(a: int, b: int) -> int:
    return bin((a ^ b) & _MASK).count("1")


def store_photo(
    photo_dir: Path, listing_id: uuid.UUID, position: int, data: bytes, max_side: int = 1280
) -> StoredPhoto:
    img = Image.open(io.BytesIO(data)).convert("RGB")
    img.thumbnail((max_side, max_side), Image.Resampling.LANCZOS)
    key = f"{listing_id}/{position}.jpg"
    target = photo_dir / key
    target.parent.mkdir(parents=True, exist_ok=True)
    img.save(target, format="JPEG", quality=85, optimize=True)
    return StoredPhoto(
        storage_key=key,
        sha256=hashlib.sha256(data).hexdigest(),
        phash=phash_to_signed(str(imagehash.phash(img))),
        width=img.width,
        height=img.height,
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
        photo.download_error = error or "download failed"
    else:
        stored = store_photo(photo_dir, listing.id, position, data)
        photo.storage_key, photo.sha256, photo.phash = (
            stored.storage_key,
            stored.sha256,
            stored.phash,
        )
        photo.width, photo.height, photo.download_error = stored.width, stored.height, None
    await session.flush()
    return photo
