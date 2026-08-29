from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path

import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ingestion.adapters.base import RawPayload, SourceAdapter
from app.ingestion.parse import parse_text
from app.ingestion.photos import save_listing_photo
from app.modules.contacts.scoring import rescore_for_listing, update_probable_owner
from app.modules.dedupe.config import DedupeConfig
from app.modules.dedupe.service import assign
from app.modules.listings.fx import rate_for
from app.modules.listings.models import CrawlRun, Listing, RawListing, Source
from app.modules.listings.service import apply_misses, mark_seen, persist_parsed, upsert_raw
from app.modules.properties.models import Property
from app.modules.properties.service import recompute

log = structlog.get_logger()


@dataclass
class IngestResult:
    listing: Listing
    property: Property
    created: bool
    changed: bool
    decision: str


async def ingest_payload(
    session: AsyncSession,
    source: Source,
    payload: RawPayload,
    *,
    adapter: SourceAdapter | None,
    cfg: DedupeConfig,
    photo_dir: Path,
    now: datetime,
    max_photos: int = 10,
) -> IngestResult:
    raw, changed = await upsert_raw(
        session, source.id, payload.external_id, payload.url, payload.payload, now
    )
    existing = (
        await session.execute(select(Listing).where(Listing.raw_listing_id == raw.id))
    ).scalar_one_or_none()
    created = existing is None

    day = (payload.posted_at or now).date()
    rate = await rate_for(session, day)
    parsed = parse_text(
        payload.text, sender_username=payload.sender_username, structured=payload.structured
    )
    listing = await persist_parsed(
        session,
        raw,
        parsed,
        posted_at=payload.posted_at,
        now=now,
        usd_rate=rate,
        contacts=payload.contact_hints,
    )

    if adapter is not None and (created or changed):
        for position, ref in enumerate(payload.photo_refs[:max_photos]):
            try:
                data = await adapter.download_photo(ref)
            except Exception as exc:  # noqa: BLE001 — a photo must never block the listing (§10)
                await save_listing_photo(
                    session, photo_dir, listing, position, None, error=str(exc)[:500]
                )
                continue
            await save_listing_photo(session, photo_dir, listing, position, data)

    result = await assign(session, listing, cfg, now)
    if not created and result.decision == "attached":
        await recompute(session, result.property)
    await rescore_for_listing(session, listing, now)
    await update_probable_owner(session, result.property)
    return IngestResult(
        listing=listing,
        property=result.property,
        created=created,
        changed=changed,
        decision=result.decision,
    )


async def run_source(
    session: AsyncSession,
    adapter: SourceAdapter,
    source: Source,
    *,
    cfg: DedupeConfig,
    photo_dir: Path,
    now: datetime,
) -> CrawlRun:
    run = CrawlRun(source_id=source.id, started_at=now)
    session.add(run)
    await session.flush()
    try:
        async for ref in adapter.discover(source):
            run.found += 1
            try:
                async with session.begin_nested():
                    existing = (
                        await session.execute(
                            select(RawListing).where(
                                RawListing.source_id == source.id,
                                RawListing.external_id == ref.external_id,
                            )
                        )
                    ).scalar_one_or_none()
                    payload = await adapter.fetch(ref)
                    result = await ingest_payload(
                        session,
                        source,
                        payload,
                        adapter=adapter,
                        cfg=cfg,
                        photo_dir=photo_dir,
                        now=now,
                    )
                    if existing is None:
                        run.new += 1
                    elif result.changed:
                        run.changed += 1
            except Exception as exc:  # noqa: BLE001 — one bad post never stops the batch (§10)
                run.failed += 1
                log.warning(
                    "ingest_failed", source=source.name, external_id=ref.external_id, error=str(exc)
                )

        window = await adapter.seen_window(source)
        if window is not None:
            await mark_seen(session, source.id, window, now)
            run.removed = await apply_misses(session, source.id, window, now)
            if run.removed:
                affected = (
                    (
                        await session.execute(
                            select(Property)
                            .join(Listing, Listing.property_id == Property.id)
                            .join(RawListing, RawListing.id == Listing.raw_listing_id)
                            .where(
                                RawListing.source_id == source.id, Listing.source_removed.is_(True)
                            )
                            .distinct()
                        )
                    )
                    .scalars()
                    .all()
                )
                for prop in affected:
                    await recompute(session, prop)
        source.consecutive_failures = 0
        source.status = "ok"
    except Exception as exc:  # noqa: BLE001
        run.error = str(exc)[:1000]
        source.consecutive_failures += 1
        source.status = "failing"
        if source.consecutive_failures >= 3:
            source.paused_until = now + timedelta(hours=1)
        run.finished_at = now
        source.last_run_at = now
        source.next_run_at = now + timedelta(seconds=source.interval_seconds)
        await session.flush()
        raise
    run.finished_at = now
    source.last_run_at = now
    source.next_run_at = now + timedelta(seconds=source.interval_seconds)
    await session.flush()
    return run
