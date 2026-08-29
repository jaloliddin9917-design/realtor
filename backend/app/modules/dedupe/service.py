import re
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import bindparam, select, text
from sqlalchemy.dialects.postgresql import ARRAY, TEXT
from sqlalchemy.ext.asyncio import AsyncSession

from app.ingestion.photos import hamming
from app.modules.contacts.service import contacts_for_listing
from app.modules.dedupe.blocking import find_candidates
from app.modules.dedupe.config import DedupeConfig
from app.modules.dedupe.models import DedupeReview
from app.modules.dedupe.scoring import ScoreBreakdown, ScoreInput, score
from app.modules.listings.models import Listing, ListingContact, ListingPhoto
from app.modules.properties.models import Property
from app.modules.properties.service import attach, create_from_listing

_STRIP = re.compile(
    r"(https?://\S+|www\.\S+|\bt\.me/\S+)"  # urls
    r"|(\+?\d[\d\s()-]{6,}\d)"  # phones
    r"|([\$€]\s?\d[\d\s.,]*)"  # currency-first prices
    r"|(\d[\d\s.,]*(?:\$|so'm|сум|сўм|у\.е\.?|usd))"  # currency-last prices
    r"|[\U0001F300-\U0001FAFF\U0001F1E6-\U0001F1FF☀-➿⬀-⯿]",  # emoji and symbols
    re.IGNORECASE,
)


def strip_for_similarity(text: str) -> str:
    return re.sub(r"\s+", " ", _STRIP.sub(" ", text)).strip().lower()


@dataclass
class AssignResult:
    property: Property
    decision: str  # attached | review | new
    score: float
    candidate: Property | None


async def _property_listings(session: AsyncSession, prop: Property) -> list[Listing]:
    return list(
        (await session.execute(select(Listing).where(Listing.property_id == prop.id)))
        .scalars()
        .all()
    )


async def gather_inputs(session: AsyncSession, listing: Listing, prop: Property) -> ScoreInput:
    others = await _property_listings(session, prop)
    other_ids = [o.id for o in others]

    my_contacts = {c.id for c in await contacts_for_listing(session, listing.id)}
    their_contacts = set(
        (
            await session.execute(
                select(ListingContact.contact_id).where(ListingContact.listing_id.in_(other_ids))
            )
        )
        .scalars()
        .all()
    )
    shared_contact = bool(my_contacts & their_contacts)

    my_hashes = (
        (
            await session.execute(
                select(ListingPhoto.phash).where(
                    ListingPhoto.listing_id == listing.id, ListingPhoto.phash.is_not(None)
                )
            )
        )
        .scalars()
        .all()
    )
    their_hashes = (
        (
            await session.execute(
                select(ListingPhoto.phash).where(
                    ListingPhoto.listing_id.in_(other_ids), ListingPhoto.phash.is_not(None)
                )
            )
        )
        .scalars()
        .all()
    )
    distances = [
        hamming(a, b) for a in my_hashes for b in their_hashes if a is not None and b is not None
    ]
    min_photo_distance = min(distances) if distances else None

    mine = strip_for_similarity(listing.description)
    similarity: float | None = None
    stripped = [strip_for_similarity(o.description) for o in others if o.description]
    if mine and stripped:
        stmt = text("SELECT max(similarity(:mine, s)) FROM unnest(:others) AS s").bindparams(
            bindparam("mine", value=mine), bindparam("others", value=stripped, type_=ARRAY(TEXT))
        )
        similarity = (await session.execute(stmt)).scalar_one()

    rooms_floors_equal = (
        listing.rooms is not None
        and listing.floor is not None
        and listing.total_floors is not None
        and (listing.rooms, listing.floor, listing.total_floors)
        == (prop.rooms, prop.floor, prop.total_floors)
    )
    area_ratio = listing.area_sqm / prop.area_sqm if listing.area_sqm and prop.area_sqm else None
    price_ratio = (
        listing.price_usd_minor / prop.price_usd_min_minor
        if listing.price_usd_minor and prop.price_usd_min_minor
        else None
    )
    return ScoreInput(
        shared_contact, min_photo_distance, similarity, rooms_floors_equal, area_ratio, price_ratio
    )


async def assign(
    session: AsyncSession, listing: Listing, cfg: DedupeConfig, now: datetime
) -> AssignResult:
    if listing.property_id is not None:
        prop = (
            await session.execute(select(Property).where(Property.id == listing.property_id))
        ).scalar_one()
        return AssignResult(prop, "attached", 1.0, None)

    best: tuple[float, Property, ScoreBreakdown] | None = None
    for candidate in await find_candidates(session, listing):
        breakdown = score(await gather_inputs(session, listing, candidate), cfg)
        if best is None or breakdown.total > best[0]:
            best = (breakdown.total, candidate, breakdown)

    if best is not None and best[0] >= cfg.merge_threshold:
        await attach(session, best[1], listing, now)
        return AssignResult(best[1], "attached", best[0], None)

    prop = await create_from_listing(session, listing, now)
    if best is not None and best[0] >= cfg.review_threshold:
        session.add(
            DedupeReview(
                listing_id=listing.id,
                candidate_property_id=best[1].id,
                score=best[0],
                breakdown=best[2].parts,
            )
        )
        await session.flush()
        return AssignResult(prop, "review", best[0], best[1])
    return AssignResult(prop, "new", best[0] if best else 0.0, None)
