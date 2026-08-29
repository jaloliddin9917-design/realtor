import hashlib
import json
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta
from decimal import Decimal
from typing import Any, cast

from sqlalchemy import CursorResult, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.ingestion.parse import ParsedListing
from app.modules.contacts import service as contacts_service
from app.modules.listings.fx import to_usd_minor
from app.modules.listings.models import Listing, RawListing


@dataclass
class SeenWindow:
    ids: set[str]
    oldest_posted_at: datetime | None


def content_hash(payload: dict[str, Any]) -> str:
    canonical = json.dumps(
        payload, sort_keys=True, ensure_ascii=False, separators=(",", ":"), default=str
    )
    return hashlib.sha256(canonical.encode()).hexdigest()


async def upsert_raw(
    session: AsyncSession,
    source_id: uuid.UUID,
    external_id: str,
    url: str | None,
    payload: dict[str, Any],
    fetched_at: datetime,
) -> tuple[RawListing, bool]:
    digest = content_hash(payload)
    stmt = select(RawListing).where(
        RawListing.source_id == source_id, RawListing.external_id == external_id
    )
    raw = (await session.execute(stmt)).scalar_one_or_none()
    if raw is None:
        raw = RawListing(
            source_id=source_id,
            external_id=external_id,
            url=url,
            payload=payload,
            content_hash=digest,
            fetched_at=fetched_at,
        )
        session.add(raw)
        await session.flush()
        return raw, True
    changed = raw.content_hash != digest
    raw.fetched_at = fetched_at
    if changed:
        raw.payload, raw.content_hash, raw.url = payload, digest, url or raw.url
    await session.flush()
    return raw, changed


async def persist_parsed(
    session: AsyncSession,
    raw: RawListing,
    parsed: ParsedListing,
    *,
    posted_at: datetime | None,
    now: datetime,
    usd_rate: Decimal | None,
    contacts: list[tuple[str, str]] | None = None,
) -> Listing:
    extra = contacts or []
    listing = (
        await session.execute(select(Listing).where(Listing.raw_listing_id == raw.id))
    ).scalar_one_or_none()
    if listing is None:
        listing = Listing(raw_listing_id=raw.id, first_seen_at=now, last_seen_at=now)
        session.add(listing)
    listing.title = parsed.title
    listing.description = parsed.description
    listing.price_amount_minor = parsed.price_amount_minor
    listing.price_currency = parsed.price_currency
    listing.price_usd_minor = to_usd_minor(
        parsed.price_amount_minor, parsed.price_currency, usd_rate
    )
    listing.rooms, listing.floor, listing.total_floors = (
        parsed.rooms,
        parsed.floor,
        parsed.total_floors,
    )
    listing.area_sqm, listing.district = parsed.area_sqm, parsed.district
    listing.posted_at = posted_at
    listing.last_seen_at = now
    listing.miss_count = 0
    listing.owner_marker, listing.agent_marker = parsed.owner_marker, parsed.agent_marker
    listing.parse_confidence = parsed.parse_confidence
    raw.parse_error = None
    await session.flush()
    identities: list[tuple[str, str]] = [("phone", p) for p in parsed.phones]
    if parsed.telegram_username:
        identities.append(("telegram", parsed.telegram_username))
    identities.extend(extra)
    for kind, identifier in identities:
        contact = await contacts_service.get_or_create(session, kind, identifier)
        await contacts_service.link(session, listing.id, contact.id)
    await session.flush()
    return listing


async def mark_seen(
    session: AsyncSession, source_id: uuid.UUID, window: SeenWindow, now: datetime
) -> int:
    stmt = (
        update(Listing)
        .where(
            Listing.raw_listing_id == RawListing.id,
            RawListing.source_id == source_id,
            RawListing.external_id.in_(window.ids),
        )
        .values(last_seen_at=now, miss_count=0)
    )
    result = cast(CursorResult[Any], await session.execute(stmt))
    return int(result.rowcount or 0)


async def apply_misses(
    session: AsyncSession,
    source_id: uuid.UUID,
    window: SeenWindow,
    now: datetime,
    max_misses: int = 3,
) -> int:
    if window.oldest_posted_at is None:
        return 0
    stmt = (
        select(Listing)
        .join(RawListing, RawListing.id == Listing.raw_listing_id)
        .where(
            RawListing.source_id == source_id,
            Listing.source_removed.is_(False),
            Listing.posted_at >= window.oldest_posted_at,
            RawListing.external_id.not_in(window.ids),
        )
    )
    removed = 0
    for listing in (await session.execute(stmt)).scalars().all():
        listing.miss_count += 1
        if listing.miss_count >= max_misses:
            listing.source_removed, listing.removed_at = True, now
            removed += 1
    await session.flush()
    return removed


async def age_out(session: AsyncSession, now: datetime, days: int = 30) -> int:
    cutoff = now - timedelta(days=days)
    stmt = (
        update(Listing)
        .where(Listing.source_removed.is_(False), Listing.last_seen_at < cutoff)
        .values(source_removed=True, removed_at=now)
    )
    result = cast(CursorResult[Any], await session.execute(stmt))
    return int(result.rowcount or 0)
