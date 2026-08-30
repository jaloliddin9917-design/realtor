"""Drive a `SourceAdapter` to ingest raw posts into listings, properties, and dedupe state.

Transaction contract: neither `run_source` nor `ingest_payload` commits. The caller owns
the session and MUST commit after `run_source` returns, AND after it raises — on
failure, the except-clause below writes circuit-breaker and run bookkeeping
(`source.status`, `source.consecutive_failures`, `source.paused_until`, `run.error`,
...) before re-raising, and rolling back instead of committing at that point discards
that bookkeeping, so the circuit breaker can never trip.
"""

from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path

import structlog
from sqlalchemy import exists, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.ingestion.adapters.base import (
    AdapterBackoff,
    ListingGone,
    LoginRequired,
    RawPayload,
    SourceAdapter,
)
from app.ingestion.http import bump_backoff, reset_backoff
from app.ingestion.parse import parse_text
from app.ingestion.photos import prune_photos, save_listing_photo
from app.modules.contacts.scoring import (
    rescore_for_listing,
    rescore_property_contacts,
    update_probable_owner,
)
from app.modules.dedupe.config import DedupeConfig
from app.modules.dedupe.service import assign
from app.modules.listings.fx import rate_for
from app.modules.listings.models import CrawlRun, Listing, ListingPhoto, RawListing, Source
from app.modules.listings.service import (
    SeenWindow,
    apply_misses,
    mark_seen,
    persist_parsed,
    upsert_raw,
)
from app.modules.properties.models import Property
from app.modules.properties.service import recompute

log = structlog.get_logger()


@dataclass
class IngestResult:
    """The outcome of ingesting one payload.

    `listing.raw` is NOT loaded: `persist_parsed` sets `Listing.raw_listing_id` (the FK
    column) but never assigns the `raw` relationship itself. A caller that touches
    `listing.raw` synchronously must first `await session.refresh(listing, ["raw"])`
    (or otherwise eager-load it), or SQLAlchemy raises `MissingGreenlet` under
    `AsyncSession`.
    """

    listing: Listing
    property: Property
    created: bool
    changed: bool
    decision: str


async def store_raw(
    session: AsyncSession,
    source: Source,
    payload: RawPayload,
    now: datetime,
    ingested_via: str = "crawl",
) -> tuple[RawListing, bool, bool]:
    """Upsert the raw payload only; does not parse or touch listings/properties.

    Returns (raw, created, changed): `created` is True when no Listing has ever been
    successfully parsed from this raw row yet (so a previous parse failure also counts
    as `created`, i.e. still eligible for a fresh photo download on retry); `changed` is
    upsert_raw's content-hash comparison against the previously stored payload.

    `ingested_via` is written on insert AND on update: a crawl that finally reaches an
    ad someone had added by hand takes the row over, so from then on the removal sweep
    (`apply_misses`) treats it like any other crawled ad.
    """
    raw, changed = await upsert_raw(
        session,
        source.id,
        payload.external_id,
        payload.url,
        payload.payload,
        now,
        ingested_via=ingested_via,
    )
    existing = (
        await session.execute(select(Listing).where(Listing.raw_listing_id == raw.id))
    ).scalar_one_or_none()
    created = existing is None
    return raw, created, changed


async def process_raw(
    session: AsyncSession,
    source: Source,
    raw: RawListing,
    payload: RawPayload,
    *,
    created: bool,
    changed: bool,
    adapter: SourceAdapter | None,
    cfg: DedupeConfig,
    photo_dir: Path,
    now: datetime,
    max_photos: int = 10,
    seen: bool = True,
) -> IngestResult:
    """Parse → persist → photos → dedupe one already-stored raw payload.

    `seen` is threaded straight to `persist_parsed`: True when the payload was just
    observed at the source (a crawl, a pasted link), False for a network-free reparse of
    stored rows, which observes nothing and so must not touch the sighting fields.
    """
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
        seen=seen,
    )

    if adapter is not None:
        needs_photos = created or changed
        if not needs_photos:
            needs_photos = bool(
                (
                    await session.execute(
                        select(
                            exists().where(
                                ListingPhoto.listing_id == listing.id,
                                ListingPhoto.download_error.is_not(None),
                            )
                        )
                    )
                ).scalar_one()
            )
        if needs_photos:
            for position, ref in enumerate(payload.photo_refs[:max_photos]):
                try:
                    data = await adapter.download_photo(ref)
                except Exception as exc:  # noqa: BLE001 — a photo must never block the listing (§10)
                    await save_listing_photo(
                        session, photo_dir, listing, position, None, error=str(exc)[:500]
                    )
                    continue
                await save_listing_photo(session, photo_dir, listing, position, data)
        if changed:
            await prune_photos(
                session, photo_dir, listing, keep=len(payload.photo_refs[:max_photos])
            )

    result = await assign(session, listing, cfg, now)
    if result.decision == "attached":
        # The listing joined an existing property — every contact on the property (not
        # just this listing's own) may now have a different earliest/cheapest flag, so
        # all of them need rescoring, not only the contacts newly linked here.
        await rescore_property_contacts(session, result.property, now)
    if not created:
        # Any re-ingest of an already-known listing refreshes its property's aggregates
        # (last_seen_at, price, source_removed, ...) — not just when this call happened
        # to attach to an existing property.
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
    ingested_via: str = "crawl",
) -> IngestResult:
    raw, created, changed = await store_raw(session, source, payload, now, ingested_via)
    return await process_raw(
        session,
        source,
        raw,
        payload,
        created=created,
        changed=changed,
        adapter=adapter,
        cfg=cfg,
        photo_dir=photo_dir,
        now=now,
        max_photos=max_photos,
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
    gone_this_run: set[str] = set()
    try:
        async for ref in adapter.discover(source):
            run.found += 1

            # Savepoint 1: fetch + store the raw payload only. If anything downstream
            # (parsing, photos, dedupe) fails, the raw row must still survive so the
            # post isn't silently lost — that requires it to live in its own savepoint.
            try:
                existing_raw = (
                    await session.execute(
                        select(RawListing).where(
                            RawListing.source_id == source.id,
                            RawListing.external_id == ref.external_id,
                        )
                    )
                ).scalar_one_or_none()
                payload = await adapter.fetch(ref)
                async with session.begin_nested():
                    raw, created, changed = await store_raw(session, source, payload, now)
            except ListingGone:
                run.removed += await _mark_gone(session, source, ref.external_id, now)
                gone_this_run.add(ref.external_id)
                continue
            except (AdapterBackoff, LoginRequired):
                raise
            except Exception as exc:  # noqa: BLE001 — one bad post never stops the batch (§10)
                run.failed += 1
                log.warning(
                    "ingest_failed", source=source.name, external_id=ref.external_id, error=str(exc)
                )
                continue

            if existing_raw is None:
                run.new += 1

            # Savepoint 2: parse → persist → photos → dedupe. A failure here rolls back
            # only this savepoint, leaving the raw row (and its content_hash) intact so
            # the next run retries the parse instead of re-fetching from scratch.
            try:
                async with session.begin_nested():
                    result = await process_raw(
                        session,
                        source,
                        raw,
                        payload,
                        created=created,
                        changed=changed,
                        adapter=adapter,
                        cfg=cfg,
                        photo_dir=photo_dir,
                        now=now,
                    )
                if existing_raw is not None and result.changed:
                    run.changed += 1
            except Exception as exc:  # noqa: BLE001 — one bad post never stops the batch (§10)
                raw.parse_error = f"{type(exc).__name__}: {exc}"[:1000]
                await session.flush()
                run.failed += 1
                log.warning(
                    "ingest_failed", source=source.name, external_id=ref.external_id, error=str(exc)
                )
                continue

        window = await adapter.seen_window(source)
        if window is not None:
            # A listing whose `fetch` raised ListingGone this run was already marked
            # source_removed above; mark_seen's bulk UPDATE unconditionally un-removes
            # anything in the window, so it must not see those ids, or it would silently
            # undo the removal just recorded.
            seen_window = (
                SeenWindow(ids=window.ids - gone_this_run, oldest_posted_at=window.oldest_posted_at)
                if gone_this_run
                else window
            )
            await mark_seen(session, source.id, seen_window, now)
            # mark_seen only touches listings.last_seen_at; a listing seen again this run
            # but not re-fetched (e.g. it's within the source's window without having
            # changed) never goes through process_raw/recompute, so the owning
            # property's last_seen_at would otherwise go stale. Propagate directly.
            #
            # The source filter picks *which* properties this run may have changed; the
            # aggregate itself must span every listing of those properties, whatever
            # source each came from — `properties.source_removed` is "all of this
            # property's listings are gone" (spec §3.5), not "all of the ones this
            # source happens to own". Aggregating per source instead makes a property
            # merged from OLX + Telegram and delisted on OLX only flip to removed on
            # every OLX run and back on every Telegram run.
            await session.execute(
                text(
                    "UPDATE properties p "
                    "SET last_seen_at = GREATEST(p.last_seen_at, sub.max_seen), "
                    "    source_removed = sub.all_removed "
                    "FROM (SELECT l.property_id, max(l.last_seen_at) AS max_seen, "
                    "      bool_and(l.source_removed) AS all_removed "
                    "FROM listings l "
                    "WHERE l.property_id IN ("
                    "  SELECT l2.property_id FROM listings l2 "
                    "  JOIN raw_listings r ON r.id = l2.raw_listing_id "
                    "  WHERE r.source_id = :source_id AND l2.property_id IS NOT NULL) "
                    "GROUP BY l.property_id) sub "
                    "WHERE p.id = sub.property_id "
                    "AND (p.last_seen_at < sub.max_seen OR p.source_removed <> sub.all_removed)"
                ),
                {"source_id": source.id},
            )
            # += : a ListingGone this run may already have counted removals above; this
            # tallies misses on top of those instead of clobbering them.
            run.removed += await apply_misses(session, source.id, window, now)
            if run.removed:
                affected = (
                    (
                        await session.execute(
                            select(Property)
                            .join(Listing, Listing.property_id == Property.id)
                            .join(RawListing, RawListing.id == Listing.raw_listing_id)
                            .where(
                                RawListing.source_id == source.id,
                                Listing.source_removed.is_(True),
                                Listing.removed_at == now,
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
        reset_backoff(source)
    except AdapterBackoff as exc:
        # Escalation lives here, not in the adapter: a blocked detail page or photo has
        # no `source` to bump, and a backoff is not counted as a failure, so without a
        # rising pause the worker would retry a blocked source every interval forever.
        # max(): the source's own retry_after (a Telegram flood wait) is a floor to obey,
        # never a ceiling to shorten.
        level, delay = bump_backoff(source)
        log.warning(
            "source_backoff",
            source=source.name,
            backoff_level=level + 1,
            reason=exc.reason,
            retry_after=str(max(exc.retry_after, delay)),
        )
        _pause(source, run, now, max(exc.retry_after, delay), "paused", exc.reason)
    except LoginRequired as exc:
        _pause(source, run, now, timedelta(hours=1), "login_required", str(exc) or "login required")
    except Exception as exc:  # noqa: BLE001
        run.error = str(exc)[:1000]
        source.consecutive_failures += 1
        source.status = "failing"
        if source.consecutive_failures >= 3:
            source.paused_until = now + timedelta(hours=1)
        run.finished_at = now
        source.last_run_at = now
        source.next_run_at = now + timedelta(seconds=source.interval_seconds)
        try:
            await session.flush()
        except Exception as flush_exc:  # noqa: BLE001 — never let bookkeeping mask the real failure
            # `flush_exc`, not `exc`: the run's own failure is re-raised below and logged
            # by the caller, whereas this flush error is the only record that the
            # circuit-breaker bookkeeping never made it to the database.
            log.warning("run_bookkeeping_failed", source=source.name, error=str(flush_exc))
        raise
    run.finished_at = now
    source.last_run_at = now
    source.next_run_at = now + timedelta(seconds=source.interval_seconds)
    await session.flush()
    return run


async def _mark_gone(session: AsyncSession, source: Source, external_id: str, now: datetime) -> int:
    stmt = (
        select(Listing)
        .join(RawListing, RawListing.id == Listing.raw_listing_id)
        .where(
            RawListing.source_id == source.id,
            RawListing.external_id == external_id,
            Listing.source_removed.is_(False),
        )
    )
    listing = (await session.execute(stmt)).scalar_one_or_none()
    if listing is None:
        return 0
    listing.source_removed, listing.removed_at = True, now
    await session.flush()
    if listing.property_id is not None:
        prop = await session.get(Property, listing.property_id)
        if prop is not None:
            await recompute(session, prop)
    return 1


def _pause(
    source: Source, run: CrawlRun, now: datetime, retry_after: timedelta, status: str, reason: str
) -> None:
    run.error = reason[:1000]
    source.status = status
    source.paused_until = now + retry_after
