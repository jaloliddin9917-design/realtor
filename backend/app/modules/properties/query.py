"""Read queries behind GET /properties and GET /properties/{id}.

The `cast`s below turn the plain `str` columns SQLAlchemy hands back into the closed
value sets the response schemas declare. They assert nothing: pydantic still validates
every one on construction, so a value outside the set raises here rather than reaching
the web as an unmodelled string.
"""

import uuid
from dataclasses import dataclass, field
from typing import Any, cast

from sqlalchemy import Select, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased, defer, selectinload

from app.core.settings import PHOTO_URL_PREFIX
from app.modules.contacts.models import Contact
from app.modules.contacts.service import contacts_for_listing
from app.modules.dedupe.models import DedupeReview
from app.modules.listings.models import Listing, ListingPhoto, RawListing, Source
from app.modules.listings.schemas import SourceKind
from app.modules.properties.models import Property, PropertyStatusEvent
from app.modules.properties.schemas import (
    ContactClassification,
    ContactOut,
    DuplicateOut,
    ListingOut,
    OwnerOut,
    PhotoOut,
    PriceOut,
    PropertyDetail,
    PropertyRow,
    PropertyStatus,
    SortKey,
    SourceRef,
    StatusEventOut,
)
from app.modules.properties.service import status_history


@dataclass
class PropertyFilters:
    district: list[str] = field(default_factory=list)
    rooms: list[int] = field(default_factory=list)
    price_min: int | None = None  # whole USD
    price_max: int | None = None
    status: list[PropertyStatus] = field(default_factory=list)
    source: str | None = None
    owner_only: bool = False
    removed: bool = False
    q: str | None = None
    sort: SortKey = "last_seen"
    page: int = 1
    page_size: int = 20


Owner = aliased(Contact, name="owner")

_SORTS: dict[str, tuple[Any, ...]] = {
    "last_seen": (Property.last_seen_at.desc(),),
    "first_seen": (Property.first_seen_at.desc(),),
    "price_asc": (Property.price_usd_min_minor.asc().nulls_last(),),
    "price_desc": (Property.price_usd_min_minor.desc().nulls_last(),),
}


def _first_photo() -> Any:
    return (
        select(ListingPhoto.storage_key)
        .join(Listing, Listing.id == ListingPhoto.listing_id)
        .where(Listing.property_id == Property.id, ListingPhoto.storage_key.is_not(None))
        .order_by(Listing.first_seen_at, Listing.id, ListingPhoto.position)
        .limit(1)
        .correlate(Property)
        .scalar_subquery()
    )


def select_rows(f: PropertyFilters, *, count: bool) -> Select[Any]:
    """Property rows with listing count, source kinds, probable owner, last status event and
    first photo key — or just `count(*)` over the same filters."""
    stats = (
        select(
            Listing.property_id.label("pid"),
            func.count(Listing.id).label("listing_count"),
            func.array_agg(Source.kind.distinct()).label("source_kinds"),
        )
        .join(RawListing, RawListing.id == Listing.raw_listing_id)
        .join(Source, Source.id == RawListing.source_id)
        .where(Listing.property_id.is_not(None))
        .group_by(Listing.property_id)
        .subquery("stats")
    )
    last_event = (
        select(
            PropertyStatusEvent.property_id.label("pid"),
            func.max(PropertyStatusEvent.id).label("event_id"),
        )
        .group_by(PropertyStatusEvent.property_id)
        .subquery("last_event")
    )
    # A property always has >=1 listing in M0 — a listing is attached to exactly one
    # property, once (dedupe.service.assign short-circuits to the existing property for
    # a listing that already has one), and is never deleted or moved afterwards — so the
    # inner join to `stats` below can never drop a property row; that's by design.
    stmt: Select[Any]
    if count:
        stmt = (
            select(func.count(Property.id))
            .select_from(Property)
            .join(stats, stats.c.pid == Property.id)
        )
        if f.owner_only:
            stmt = stmt.outerjoin(Owner, Owner.id == Property.probable_owner_contact_id)
    else:
        stmt = (
            select(
                Property,
                stats.c.listing_count,
                stats.c.source_kinds,
                Owner,
                PropertyStatusEvent,
                _first_photo().label("photo_key"),
            )
            .options(defer(Property.search_vector))
            .select_from(Property)
            .join(stats, stats.c.pid == Property.id)
            .outerjoin(Owner, Owner.id == Property.probable_owner_contact_id)
            .outerjoin(last_event, last_event.c.pid == Property.id)
            .outerjoin(PropertyStatusEvent, PropertyStatusEvent.id == last_event.c.event_id)
        )
    if f.district:
        stmt = stmt.where(Property.district.in_(f.district))
    if f.rooms:
        stmt = stmt.where(Property.rooms.in_(f.rooms))
    if f.price_min is not None:
        stmt = stmt.where(Property.price_usd_min_minor >= f.price_min * 100)
    if f.price_max is not None:
        stmt = stmt.where(Property.price_usd_min_minor <= f.price_max * 100)
    if f.status:
        stmt = stmt.where(Property.status.in_(f.status))
    if f.source:
        of_kind = (
            select(Listing.property_id)
            .join(RawListing, RawListing.id == Listing.raw_listing_id)
            .join(Source, Source.id == RawListing.source_id)
            .where(Source.kind == f.source)
        )
        stmt = stmt.where(Property.id.in_(of_kind))
    if f.owner_only:
        stmt = stmt.where(Owner.classification == "owner")
    if not f.removed:
        stmt = stmt.where(Property.source_removed.is_(False))
    if f.q:
        query = func.plainto_tsquery("simple", func.unaccent(f.q))
        stmt = stmt.where(Property.search_vector.op("@@")(query))
    return stmt


def event_out(event: PropertyStatusEvent | None) -> StatusEventOut | None:
    if event is None:
        return None
    return StatusEventOut(
        id=event.id,
        from_status=event.from_status,
        to_status=event.to_status,
        actor_type=event.actor_type,
        actor_id=event.actor_id,
        note=event.note,
        created_at=event.created_at,
    )


def _owner_out(contact: Contact | None, confidence: float | None) -> OwnerOut | None:
    if contact is None:
        return None
    return OwnerOut(
        contact_id=contact.id,
        kind=contact.kind,
        identifier=contact.identifier,
        display_name=contact.display_name,
        classification=cast(ContactClassification, contact.classification),
        agency_score=contact.agency_score,
        confidence=confidence,
    )


def row_from(
    prop: Property,
    listing_count: int,
    source_kinds: list[str],
    owner: Contact | None,
    event: PropertyStatusEvent | None,
    photo_key: str | None,
) -> PropertyRow:
    return PropertyRow(
        id=prop.id,
        status=cast(PropertyStatus, prop.status),
        district=prop.district,
        rooms=prop.rooms,
        floor=prop.floor,
        total_floors=prop.total_floors,
        area_sqm=prop.area_sqm,
        latitude=prop.latitude,
        longitude=prop.longitude,
        location_radius_m=prop.location_radius_m,
        location_label=prop.location_label,
        building_type=prop.building_type,
        is_furnished=prop.is_furnished,
        renovation=prop.renovation,
        year_built=prop.year_built,
        price_usd_min_minor=prop.price_usd_min_minor,
        source_removed=prop.source_removed,
        needs_recheck=prop.needs_recheck,
        first_seen_at=prop.first_seen_at,
        last_seen_at=prop.last_seen_at,
        listing_count=listing_count,
        source_kinds=sorted(source_kinds),
        probable_owner=_owner_out(owner, prop.owner_confidence),
        photo_url=f"{PHOTO_URL_PREFIX}/{photo_key}" if photo_key else None,
        last_status_event=event_out(event),
    )


async def list_properties(
    session: AsyncSession, f: PropertyFilters
) -> tuple[list[PropertyRow], int]:
    total = (await session.execute(select_rows(f, count=True))).scalar_one()
    stmt = (
        select_rows(f, count=False)
        .order_by(*_SORTS[f.sort], Property.id)
        .offset((f.page - 1) * f.page_size)
        .limit(f.page_size)
    )
    rows = (await session.execute(stmt)).all()
    return [row_from(*row) for row in rows], int(total)


# --- detail (Task 5) -------------------------------------------------------------------


async def _listing_out(session: AsyncSession, listing: Listing) -> ListingOut:
    raw = listing.raw
    contacts = await contacts_for_listing(session, listing.id)
    return ListingOut(
        id=listing.id,
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
        area_sqm=listing.area_sqm,
        floor=listing.floor,
        total_floors=listing.total_floors,
        district=listing.district,
        latitude=listing.latitude,
        longitude=listing.longitude,
        location_radius_m=listing.location_radius_m,
        location_precise=listing.location_precise,
        location_label=listing.location_label,
        building_type=listing.building_type,
        is_furnished=listing.is_furnished,
        renovation=listing.renovation,
        year_built=listing.year_built,
        attributes=listing.attributes,
        address_text=listing.address_text,
        posted_at=listing.posted_at,
        first_seen_at=listing.first_seen_at,
        last_seen_at=listing.last_seen_at,
        source_removed=listing.source_removed,
        owner_marker=listing.owner_marker,
        agent_marker=listing.agent_marker,
        parse_confidence=listing.parse_confidence,
        photos=[
            PhotoOut(
                position=p.position,
                url=f"{PHOTO_URL_PREFIX}/{p.storage_key}",
                width=p.width,
                height=p.height,
            )
            for p in listing.photos
            if p.storage_key
        ],
        contacts=[
            ContactOut(
                id=c.id,
                kind=c.kind,
                identifier=c.identifier,
                display_name=c.display_name,
                classification=cast(ContactClassification, c.classification),
                agency_score=c.agency_score,
            )
            for c in contacts
        ],
    )


async def _duplicates(
    session: AsyncSession, property_id: uuid.UUID, listing_ids: list[uuid.UUID]
) -> list[DuplicateOut]:
    """Review rows where one of our listings was scored against another property, or another
    listing was scored against us — collapsed to the best score per other property."""
    if not listing_ids:
        return []
    ours = select(
        DedupeReview.candidate_property_id.label("pid"), DedupeReview.score.label("score")
    ).where(DedupeReview.listing_id.in_(listing_ids))
    theirs = (
        select(Listing.property_id.label("pid"), DedupeReview.score.label("score"))
        .select_from(DedupeReview)
        .join(Listing, Listing.id == DedupeReview.listing_id)
        .where(DedupeReview.candidate_property_id == property_id, Listing.property_id.is_not(None))
    )
    best: dict[uuid.UUID, float] = {}
    for pid, score in (await session.execute(ours.union_all(theirs))).all():
        if pid != property_id:
            best[pid] = max(best.get(pid, 0.0), float(score))
    return [
        DuplicateOut(property_id=pid, score=score)
        for pid, score in sorted(best.items(), key=lambda kv: (-kv[1], str(kv[0])))
    ]


async def load_property_detail(
    session: AsyncSession, property_id: uuid.UUID
) -> PropertyDetail | None:
    stmt = select_rows(PropertyFilters(removed=True), count=False).where(Property.id == property_id)
    row = (await session.execute(stmt)).first()
    if row is None:
        return None
    base = row_from(*row)
    listings = list(
        (
            await session.execute(
                select(Listing)
                .options(
                    selectinload(Listing.photos),
                    selectinload(Listing.raw).selectinload(RawListing.source),
                )
                .where(Listing.property_id == property_id)
                .order_by(Listing.first_seen_at, Listing.id)
            )
        )
        .scalars()
        .all()
    )
    return PropertyDetail(
        **base.model_dump(),
        listings=[await _listing_out(session, x) for x in listings],
        status_events=[
            e for e in (event_out(x) for x in await status_history(session, property_id)) if e
        ],
        duplicates=await _duplicates(session, property_id, [x.id for x in listings]),
    )
