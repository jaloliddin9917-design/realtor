"""Read + decide behind the duplicates review queue (GET/POST /duplicates).

A `DedupeReview` pairs one listing (`listing_id`, which the scorer had just spun off into its
own property) against a pre-existing candidate property (`candidate_property_id`) it might
duplicate. Side A renders that triggering listing; side B renders the candidate property's
best listing (same ranking as `availability.query._best_listing`). Everything each side needs
beyond the listing row — source, photos, and the property's probable-owner contact — is
gathered in a few `IN (...)` queries and assembled in Python, mirroring `properties.query` /
`availability.query`. `now` is a parameter so tests can freeze the 30-day "recently decided"
window.
"""

import uuid
from collections import defaultdict
from datetime import datetime, timedelta
from typing import cast

import structlog
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.problems import ApiError
from app.core.settings import PHOTO_URL_PREFIX
from app.modules.contacts.models import Contact
from app.modules.contacts.scoring import rescore_property_contacts
from app.modules.dedupe.config import DedupeConfig
from app.modules.dedupe.models import DedupeReview
from app.modules.dedupe.schemas import (
    SIGNAL_ORDER,
    BreakdownItem,
    DecidedRecentOut,
    Decision,
    DuplicateOwnerOut,
    DuplicatePairOut,
    DuplicateQueueOut,
    DuplicateSideOut,
    ThresholdsOut,
)
from app.modules.identity.models import User
from app.modules.listings.models import Listing, RawListing
from app.modules.listings.schemas import SourceKind
from app.modules.properties.models import Property
from app.modules.properties.schemas import ContactClassification, PriceOut, SourceRef
from app.modules.properties.service import recompute

RECENT_DECISION_DAYS = 30

log = structlog.get_logger()


def _breakdown(raw: dict[str, object]) -> list[BreakdownItem]:
    """The stored `{signal: points}` JSONB as an ordered, typed list (missing key -> 0).

    A `details` sub-map (written by the scorer alongside the points) names what a signal
    matched on — currently the shared phone for `contact` — surfaced as `detail`.
    """
    raw_details = raw.get("details")
    details = raw_details if isinstance(raw_details, dict) else {}
    items: list[BreakdownItem] = []
    for signal in SIGNAL_ORDER:
        value = raw.get(signal)
        points = float(value) if isinstance(value, (int, float)) else 0.0
        detail = details.get(signal)
        items.append(
            BreakdownItem(
                signal=signal, points=points, detail=detail if isinstance(detail, str) else None
            )
        )
    return items


def _best_listing(listings: list[Listing]) -> Listing | None:
    """Highest-confidence, then newest — same ranking as `availability.query._best_listing`."""
    if not listings:
        return None
    return max(
        listings,
        key=lambda x: (x.parse_confidence, x.posted_at or x.created_at, x.created_at, x.id),
    )


def _owner_out(contact: Contact | None) -> DuplicateOwnerOut | None:
    if contact is None:
        return None
    return DuplicateOwnerOut(
        phone=contact.identifier if contact.kind == "phone" else None,
        classification=cast(ContactClassification, contact.classification),
        home_count=contact.distinct_property_count_90d,
    )


def _side_out(
    property_id: uuid.UUID | None, listing: Listing, owner: Contact | None
) -> DuplicateSideOut:
    """Render one property side from its representative listing (source + photos preloaded)."""
    raw = listing.raw
    return DuplicateSideOut(
        property_id=property_id,
        source=SourceRef(
            id=raw.source.id, kind=cast(SourceKind, raw.source.kind), name=raw.source.name
        ),
        external_id=raw.external_id,
        url=raw.url,
        title=listing.title,
        description=listing.description,
        price=PriceOut(
            amount_minor=listing.price_amount_minor,
            currency=listing.price_currency,
            usd_minor=listing.price_usd_minor,
        ),
        rooms=listing.rooms,
        floor=listing.floor,
        total_floors=listing.total_floors,
        area_sqm=listing.area_sqm,
        district=listing.district,
        address_text=listing.address_text,
        posted_at=listing.posted_at,
        first_seen_at=listing.first_seen_at,
        owner=_owner_out(owner),
        photos=[f"{PHOTO_URL_PREFIX}/{p.storage_key}" for p in listing.photos if p.storage_key],
    )


async def _listings_by_id(
    session: AsyncSession, listing_ids: list[uuid.UUID]
) -> dict[uuid.UUID, Listing]:
    if not listing_ids:
        return {}
    stmt = (
        select(Listing)
        .options(
            selectinload(Listing.raw).selectinload(RawListing.source),
            selectinload(Listing.photos),
        )
        .where(Listing.id.in_(listing_ids))
    )
    return {row.id: row for row in (await session.execute(stmt)).scalars()}


async def _best_by_property(
    session: AsyncSession, property_ids: list[uuid.UUID]
) -> dict[uuid.UUID, Listing]:
    if not property_ids:
        return {}
    stmt = (
        select(Listing)
        .options(
            selectinload(Listing.raw).selectinload(RawListing.source),
            selectinload(Listing.photos),
        )
        .where(Listing.property_id.in_(property_ids))
    )
    grouped: dict[uuid.UUID, list[Listing]] = defaultdict(list)
    for row in (await session.execute(stmt)).scalars():
        if row.property_id is not None:
            grouped[row.property_id].append(row)
    best: dict[uuid.UUID, Listing] = {}
    for pid, group in grouped.items():
        chosen = _best_listing(group)
        if chosen is not None:
            best[pid] = chosen
    return best


async def _build_pairs(
    session: AsyncSession, reviews: list[DedupeReview]
) -> list[DuplicatePairOut]:
    """Turn review rows into two-sided pairs, batching every follow-up read."""
    if not reviews:
        return []
    side_a = await _listings_by_id(session, [r.listing_id for r in reviews])
    side_b = await _best_by_property(session, [r.candidate_property_id for r in reviews])

    prop_ids: set[uuid.UUID] = set()
    for review in reviews:
        listing_a = side_a.get(review.listing_id)
        if listing_a is not None and listing_a.property_id is not None:
            prop_ids.add(listing_a.property_id)
        prop_ids.add(review.candidate_property_id)
    props: dict[uuid.UUID, Property] = {}
    if prop_ids:
        props = {
            p.id: p
            for p in (
                await session.execute(select(Property).where(Property.id.in_(prop_ids)))
            ).scalars()
        }
    owner_ids = {p.probable_owner_contact_id for p in props.values() if p.probable_owner_contact_id}
    owners: dict[uuid.UUID, Contact] = {}
    if owner_ids:
        owners = {
            c.id: c
            for c in (
                await session.execute(select(Contact).where(Contact.id.in_(owner_ids)))
            ).scalars()
        }

    def owner_of(property_id: uuid.UUID | None) -> Contact | None:
        prop = props.get(property_id) if property_id is not None else None
        if prop is None or prop.probable_owner_contact_id is None:
            return None
        return owners.get(prop.probable_owner_contact_id)

    pairs: list[DuplicatePairOut] = []
    for review in reviews:
        listing_a = side_a.get(review.listing_id)
        listing_b = side_b.get(review.candidate_property_id)
        if listing_a is None or listing_b is None:
            # Both always exist under M0 invariants (the review's own listing, and a
            # candidate property that had listings to score against). Skip rather than
            # 500 the whole page if a datum is somehow missing.
            log.warning("dedupe_review_side_missing", review_id=str(review.id))
            continue
        a_prop_id = listing_a.property_id
        pairs.append(
            DuplicatePairOut(
                id=review.id,
                score=review.score,
                created_at=review.created_at,
                a=_side_out(a_prop_id, listing_a, owner_of(a_prop_id)),
                b=_side_out(
                    review.candidate_property_id,
                    listing_b,
                    owner_of(review.candidate_property_id),
                ),
                breakdown=_breakdown(review.breakdown),
                decision=cast(Decision | None, review.decision),
                decided_by=review.decided_by,
                decided_at=review.decided_at,
            )
        )
    return pairs


async def _decided_recent(session: AsyncSession, now: datetime) -> DecidedRecentOut:
    """Count reviews decided in the trailing window and the share that were merges."""
    since = now - timedelta(days=RECENT_DECISION_DAYS)
    total, merged = (
        await session.execute(
            select(
                func.count(),
                func.count().filter(DedupeReview.decision == "merge"),
            ).where(DedupeReview.decision.is_not(None), DedupeReview.decided_at >= since)
        )
    ).one()
    count = int(total)
    merged_pct = round(int(merged) * 100 / count) if count else 0
    return DecidedRecentOut(days=RECENT_DECISION_DAYS, count=count, merged_pct=merged_pct)


async def list_pending_pairs(
    session: AsyncSession, cfg: DedupeConfig, now: datetime
) -> DuplicateQueueOut:
    """Every undecided review pair, best score first, plus the config thresholds and a
    small "recently decided" summary the screen shows above the queue."""
    reviews = list(
        (
            await session.execute(
                select(DedupeReview)
                .where(DedupeReview.decision.is_(None))
                .order_by(DedupeReview.score.desc(), DedupeReview.id)
            )
        )
        .scalars()
        .all()
    )
    return DuplicateQueueOut(
        items=await _build_pairs(session, reviews),
        thresholds=ThresholdsOut(
            review_threshold=cfg.review_threshold, merge_threshold=cfg.merge_threshold
        ),
        decided_recent=await _decided_recent(session, now),
    )


async def _merge_into_candidate(
    session: AsyncSession, review: DedupeReview, user: User, now: datetime
) -> None:
    """Fold side A (the triggering listing's property) into side B (the pre-existing
    candidate, the survivor).

    Every listing on A is reattached to B; B's rollups and owner/contact scoring are
    refreshed exactly as an attach in `pipeline.process_raw` would; A is retired. Pending
    reviews are then tidied so none still points at the retired property or at itself.
    Runs inside the request transaction (the router commits).
    """
    survivor_id = review.candidate_property_id  # B — the pre-existing property
    source_id = (
        await session.execute(select(Listing.property_id).where(Listing.id == review.listing_id))
    ).scalar_one_or_none()  # A — the property the triggering listing currently sits on
    if source_id is None or source_id == survivor_id:
        return  # nothing to merge (already one property, or the listing is orphaned)

    survivor = await session.get(Property, survivor_id)
    source_prop = await session.get(Property, source_id)
    if survivor is None or source_prop is None:
        return

    # Move every listing off A onto B, then refresh B just like an attach does.
    await session.execute(
        update(Listing)
        .where(Listing.property_id == source_id)
        .values(property_id=survivor_id)
        .execution_options(synchronize_session=False)
    )
    await session.flush()
    await recompute(session, survivor)
    await rescore_property_contacts(session, survivor, now)

    # A now has zero listings, so it already vanishes from every list/map/queue view via the
    # stats inner-join; source_removed is belt-and-suspenders. NOT hard-deleted: the cascade
    # to property_status_events would hit that table's append-only trigger.
    source_prop.source_removed = True

    # Keep the queue sane: repoint any still-pending review aimed at the retired property to
    # the survivor ...
    await session.execute(
        update(DedupeReview)
        .where(DedupeReview.candidate_property_id == source_id, DedupeReview.decision.is_(None))
        .values(candidate_property_id=survivor_id)
        .execution_options(synchronize_session=False)
    )
    # ... then auto-decide any pending review the move just turned into a self-pair (a listing
    # now on B scored against candidate B), so it drops out of the queue rather than rendering
    # a property against itself. The current review is decided by the caller below.
    self_pair_ids = list(
        (
            await session.execute(
                select(DedupeReview.id)
                .join(Listing, Listing.id == DedupeReview.listing_id)
                .where(
                    DedupeReview.decision.is_(None),
                    DedupeReview.candidate_property_id == survivor_id,
                    Listing.property_id == survivor_id,
                    DedupeReview.id != review.id,
                )
            )
        )
        .scalars()
        .all()
    )
    if self_pair_ids:
        await session.execute(
            update(DedupeReview)
            .where(DedupeReview.id.in_(self_pair_ids))
            .values(decision="merge", decided_by=user.id, decided_at=now)
            .execution_options(synchronize_session=False)
        )
    await session.flush()


async def decide_review(
    session: AsyncSession,
    review_id: uuid.UUID,
    user: User,
    decision: Decision,
    now: datetime,
) -> DuplicatePairOut:
    """Record a merge/separate decision. 404 if unknown; 409 if already decided.

    On "merge" the two properties are actually merged (A's listings reattached to the
    surviving candidate B, A retired); on "separate" only the decision is recorded. Either
    way the pair leaves the pending queue.
    """
    review = await session.get(DedupeReview, review_id)
    if review is None:
        raise ApiError(404, "not_found", "review not found")
    if review.decision is not None:
        raise ApiError(409, "dedupe.already_decided", "review has already been decided")
    review.decision = decision
    review.decided_by = user.id
    review.decided_at = now
    await session.flush()
    # Build the response from the two sides as they stood at decision time — the merge below
    # reattaches A's listings onto B, after which both sides would render the survivor.
    pairs = await _build_pairs(session, [review])
    if not pairs:  # both sides exist under M0 invariants; guard the `-O` path anyway.
        raise RuntimeError(f"review {review_id} has an unbuildable pair")
    if decision == "merge":
        await _merge_into_candidate(session, review, user, now)
    return pairs[0]
