import uuid

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.contacts.models import Contact
from app.modules.listings.models import ListingContact


async def get_or_create(
    session: AsyncSession, kind: str, identifier: str, display_name: str | None = None
) -> Contact:
    stmt = insert(Contact).values(kind=kind, identifier=identifier, display_name=display_name)
    stmt = stmt.on_conflict_do_nothing(constraint="uq_contact_identity")
    await session.execute(stmt)
    contact = (
        await session.execute(
            select(Contact).where(Contact.kind == kind, Contact.identifier == identifier)
        )
    ).scalar_one()
    if display_name and contact.display_name != display_name:
        contact.display_name = display_name
        await session.flush()
    return contact


async def link(session: AsyncSession, listing_id: uuid.UUID, contact_id: uuid.UUID) -> None:
    stmt = (
        insert(ListingContact)
        .values(listing_id=listing_id, contact_id=contact_id)
        .on_conflict_do_nothing()
    )
    await session.execute(stmt)


async def contacts_for_listing(session: AsyncSession, listing_id: uuid.UUID) -> list[Contact]:
    stmt = (
        select(Contact)
        .join(ListingContact, ListingContact.contact_id == Contact.id)
        .where(ListingContact.listing_id == listing_id)
        .order_by(Contact.created_at)
    )
    return list((await session.execute(stmt)).scalars().all())
