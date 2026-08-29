import uuid
from collections.abc import Sequence
from datetime import datetime

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.listings.models import Listing
from app.modules.properties.models import Property, PropertyStatusEvent

STATUSES = ("new", "active", "inactive")
ACTOR_TYPES = ("crawler", "agent", "admin", "bot")


async def _listings_of(session: AsyncSession, prop: Property) -> list[Listing]:
    stmt = select(Listing).where(Listing.property_id == prop.id)
    return list((await session.execute(stmt)).scalars().all())


async def recompute(session: AsyncSession, prop: Property) -> None:
    listings = await _listings_of(session, prop)
    if not listings:
        return
    best = max(
        listings,
        key=lambda x: (x.parse_confidence, x.posted_at or x.created_at, x.created_at, x.id),
    )
    prop.district, prop.rooms, prop.floor = best.district, best.rooms, best.floor
    prop.total_floors, prop.area_sqm = best.total_floors, best.area_sqm
    prices = [x.price_usd_minor for x in listings if x.price_usd_minor is not None]
    prop.price_usd_min_minor = min(prices) if prices else None
    prop.first_seen_at = min(x.first_seen_at for x in listings)
    prop.last_seen_at = max(x.last_seen_at for x in listings)
    prop.source_removed = all(x.source_removed for x in listings)
    corpus = " ".join(f"{x.title} {x.description} {x.address_text or ''}" for x in listings)
    await session.flush()
    await session.execute(
        text(
            "UPDATE properties SET search_vector = "
            "to_tsvector('simple', unaccent(:corpus)) WHERE id = :id"
        ),
        {"corpus": corpus, "id": prop.id},
    )


async def recompute_many(session: AsyncSession, property_ids: Sequence[uuid.UUID]) -> int:
    count = 0
    for pid in property_ids:
        prop = await session.get(Property, pid)
        if prop is not None:
            await recompute(session, prop)
            count += 1
    return count


async def attach(session: AsyncSession, prop: Property, listing: Listing, now: datetime) -> None:
    listing.property_id = prop.id
    await session.flush()
    await recompute(session, prop)


async def create_from_listing(session: AsyncSession, listing: Listing, now: datetime) -> Property:
    prop = Property(
        status="new", first_seen_at=listing.first_seen_at, last_seen_at=listing.last_seen_at
    )
    session.add(prop)
    await session.flush()
    session.add(
        PropertyStatusEvent(
            property_id=prop.id, from_status=None, to_status="new", actor_type="crawler"
        )
    )
    await attach(session, prop, listing, now)
    return prop


async def status_history(
    session: AsyncSession, property_id: uuid.UUID
) -> list[PropertyStatusEvent]:
    stmt = (
        select(PropertyStatusEvent)
        .where(PropertyStatusEvent.property_id == property_id)
        .order_by(PropertyStatusEvent.created_at.desc(), PropertyStatusEvent.id.desc())
    )
    return list((await session.execute(stmt)).scalars().all())


async def set_status(
    session: AsyncSession,
    prop: Property,
    status: str,
    *,
    actor_type: str,
    actor_id: uuid.UUID | None = None,
    note: str | None = None,
) -> PropertyStatusEvent:
    if status not in STATUSES:
        raise ValueError(f"unknown status {status!r}")
    if actor_type not in ACTOR_TYPES:
        raise ValueError(f"unknown actor_type {actor_type!r}")
    if status == prop.status:
        history = await status_history(session, prop.id)
        if history:
            return history[0]
    event = PropertyStatusEvent(
        property_id=prop.id,
        from_status=None if status == prop.status else prop.status,
        to_status=status,
        actor_type=actor_type,
        actor_id=actor_id,
        note=note,
    )
    prop.status = status
    session.add(event)
    await session.flush()
    return event
