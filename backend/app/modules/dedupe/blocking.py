from sqlalchemy import ColumnElement, and_, literal_column, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ingestion.photos import phash_bucket
from app.modules.listings.models import Listing, ListingContact, ListingPhoto
from app.modules.properties.models import Property

MAX_CANDIDATES = 50


async def find_candidates(session: AsyncSession, listing: Listing) -> list[Property]:
    conditions: list[ColumnElement[bool]] = []

    contact_ids = select(ListingContact.contact_id).where(ListingContact.listing_id == listing.id)
    conditions.append(
        Listing.id.in_(
            select(ListingContact.listing_id).where(ListingContact.contact_id.in_(contact_ids))
        )
    )

    hashes = (
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
    buckets = {phash_bucket(h) for h in hashes if h is not None}
    if buckets:
        # Render the shift/mask as literals, not bound parameters: ix_listing_photos_bucket
        # is a functional index on this exact expression, and PostgreSQL only matches a
        # functional index under a generic plan when the expression text lines up literally.
        bucket_expr = (ListingPhoto.phash.op(">>")(literal_column("48"))).op("&")(
            literal_column("65535")
        )
        conditions.append(
            Listing.id.in_(
                select(ListingPhoto.listing_id).where(
                    ListingPhoto.phash.is_not(None), bucket_expr.in_(buckets)
                )
            )
        )

    if all(
        v is not None
        for v in (listing.district, listing.rooms, listing.floor, listing.total_floors)
    ):
        conditions.append(
            and_(
                Listing.district == listing.district,
                Listing.rooms == listing.rooms,
                Listing.floor == listing.floor,
                Listing.total_floors == listing.total_floors,
            )
        )

    stmt = (
        select(Property)
        .join(Listing, Listing.property_id == Property.id)
        .where(or_(*conditions), Listing.id != listing.id, Listing.property_id.is_not(None))
        .distinct()
        .order_by(Property.last_seen_at.desc(), Property.id)
        .limit(MAX_CANDIDATES)
    )
    if listing.property_id is not None:
        stmt = stmt.where(Property.id != listing.property_id)
    return list((await session.execute(stmt)).scalars().all())
