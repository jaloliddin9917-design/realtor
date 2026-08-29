from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.contacts.models import Contact
from app.modules.contacts.service import contacts_for_listing
from app.modules.listings.models import Listing, ListingContact
from app.modules.properties.models import Property


def agency_score(
    distinct_properties: int,
    agent_marker: bool,
    owner_marker: bool,
    earliest_in_property: bool,
    lowest_price_in_property: bool,
) -> float:
    if distinct_properties >= 6:
        s = 0.6
    elif distinct_properties >= 3:
        s = 0.3
    else:
        s = 0.0
    if agent_marker:
        s += 0.3
    if owner_marker:
        s -= 0.3
    if earliest_in_property:
        s -= 0.1
    if lowest_price_in_property:
        s -= 0.1
    return round(min(1.0, max(0.0, s)), 4)


def classify(score: float) -> str:
    if score >= 0.6:
        return "agent"
    if score <= 0.3:
        return "owner"
    return "unknown"


async def _listings_of_contact(
    session: AsyncSession, contact: Contact, since: datetime
) -> list[Listing]:
    stmt = (
        select(Listing)
        .join(ListingContact, ListingContact.listing_id == Listing.id)
        .where(ListingContact.contact_id == contact.id, Listing.last_seen_at >= since)
    )
    return list((await session.execute(stmt)).scalars().all())


async def _earliest_and_cheapest_flags(
    session: AsyncSession, listing: Listing
) -> tuple[bool, bool]:
    if listing.property_id is None:
        return False, False
    siblings = list(
        (await session.execute(select(Listing).where(Listing.property_id == listing.property_id)))
        .scalars()
        .all()
    )
    if len(siblings) < 2:
        # Alone on its property: nothing to have posted earlier or cheaper than.
        return False, False
    posted = [s.posted_at for s in siblings if s.posted_at is not None]
    earliest = (
        listing.posted_at is not None and listing.posted_at == min(posted) if posted else False
    )
    prices = [s.price_usd_minor for s in siblings if s.price_usd_minor is not None]
    cheapest = (
        listing.price_usd_minor is not None and listing.price_usd_minor == min(prices)
        if prices
        else False
    )
    return earliest, cheapest


async def rescore_contact(session: AsyncSession, contact: Contact, now: datetime) -> Contact:
    listings = await _listings_of_contact(session, contact, now - timedelta(days=90))
    contact.distinct_property_count_90d = len(
        {x.property_id for x in listings if x.property_id is not None}
    )
    if contact.human_decision in ("owner", "agent"):
        contact.classification = contact.human_decision
        contact.agency_score = 0.0 if contact.human_decision == "owner" else 1.0
        await session.flush()
        return contact
    agent_marker = any(x.agent_marker for x in listings)
    owner_marker = any(x.owner_marker for x in listings)
    earliest = cheapest = False
    for listing in listings:
        e, c = await _earliest_and_cheapest_flags(session, listing)
        earliest, cheapest = earliest or e, cheapest or c
    contact.agency_score = agency_score(
        contact.distinct_property_count_90d, agent_marker, owner_marker, earliest, cheapest
    )
    contact.classification = classify(contact.agency_score)
    await session.flush()
    return contact


async def rescore_for_listing(session: AsyncSession, listing: Listing, now: datetime) -> None:
    for contact in await contacts_for_listing(session, listing.id):
        await rescore_contact(session, contact, now)


async def update_probable_owner(session: AsyncSession, prop: Property) -> None:
    stmt = (
        select(Contact)
        .join(ListingContact, ListingContact.contact_id == Contact.id)
        .join(Listing, Listing.id == ListingContact.listing_id)
        .where(Listing.property_id == prop.id)
        .order_by(Contact.agency_score.asc(), Contact.created_at.asc(), Contact.id.asc())
        .limit(1)
    )
    best = (await session.execute(stmt)).scalar_one_or_none()
    prop.probable_owner_contact_id = best.id if best else None
    prop.owner_confidence = round(1.0 - best.agency_score, 4) if best else None
    await session.flush()
