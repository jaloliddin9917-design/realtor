from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.ingestion.parse import parse_text
from app.modules.contacts.models import Contact
from app.modules.contacts.scoring import (
    agency_score,
    classify,
    rescore_contact,
    rescore_for_listing,
    update_probable_owner,
)
from app.modules.contacts.service import contacts_for_listing
from app.modules.listings.models import Listing, Source
from app.modules.listings.service import persist_parsed, upsert_raw
from app.modules.properties.service import attach, create_from_listing

NOW = datetime(2026, 8, 29, 12, 0, tzinfo=UTC)


@pytest.mark.parametrize(
    ("args", "expected"),
    [
        ((1, False, False, False, False), 0.0),
        ((3, False, False, False, False), 0.3),
        ((6, False, False, False, False), 0.6),
        ((12, False, False, False, False), 0.6),
        ((1, True, False, False, False), 0.3),
        ((6, True, False, False, False), 0.9),
        ((1, False, True, True, True), 0.0),
        ((3, False, True, False, False), 0.0),
        ((6, True, True, True, True), 0.4),
    ],
)
def test_agency_score(args: tuple[int, bool, bool, bool, bool], expected: float) -> None:
    assert agency_score(*args) == pytest.approx(expected)


def test_classify() -> None:
    assert classify(0.6) == "agent" and classify(0.3) == "owner" and classify(0.45) == "unknown"


async def _source(db: AsyncSession) -> Source:
    s = Source(kind="telegram", name="@t", config={})
    db.add(s)
    await db.flush()
    return s


async def _listing(
    db: AsyncSession, s: Source, ext: str, text_: str, posted: datetime = NOW
) -> Listing:
    raw, _ = await upsert_raw(db, s.id, ext, None, {"text": text_}, NOW)
    return await persist_parsed(
        db, raw, parse_text(text_), posted_at=posted, now=NOW, usd_rate=None, contacts=[]
    )


async def test_phone_on_many_properties_becomes_agent(db: AsyncSession) -> None:
    s = await _source(db)
    for i in range(6):
        listing = await _listing(
            db, s, str(i), f"Yunusobod {i + 1}-kvartal 2-xonali 3/9 400$ tel 93 402 18 55"
        )
        await create_from_listing(db, listing, NOW)
    contact = (await contacts_for_listing(db, listing.id))[0]
    await rescore_contact(db, contact, NOW)
    assert contact.distinct_property_count_90d == 6
    assert contact.classification == "agent" and contact.agency_score == pytest.approx(0.6)


async def test_owner_markers_and_posting_order_pick_probable_owner(db: AsyncSession) -> None:
    s = await _source(db)
    owner = await _listing(
        db,
        s,
        "1",
        "Chilonzor 2-xonali 3/9 54 m² 450$ egasidan tel 90 811 24 37",
        NOW - timedelta(days=2),
    )
    prop = await create_from_listing(db, owner, NOW)
    agent = await _listing(
        db, s, "2", "Chilonzor 2-xonali 3/9 55 m² 480$ xizmat 50% tel 93 402 18 55", NOW
    )
    await attach(db, prop, agent, NOW)
    await rescore_for_listing(db, owner, NOW)
    await rescore_for_listing(db, agent, NOW)
    await update_probable_owner(db, prop)
    owner_contact = (await contacts_for_listing(db, owner.id))[0]
    assert prop.probable_owner_contact_id == owner_contact.id
    assert prop.owner_confidence == pytest.approx(1.0)
    assert owner_contact.classification == "owner"


async def test_human_decision_wins(db: AsyncSession) -> None:
    s = await _source(db)
    listing = await _listing(db, s, "1", "Sergeli 2-xonali 1/5 350$ rieltor tel 90 555 31 08")
    await create_from_listing(db, listing, NOW)
    contact: Contact = (await contacts_for_listing(db, listing.id))[0]
    contact.human_decision = "owner"
    await rescore_contact(db, contact, NOW)
    assert (contact.classification, contact.agency_score) == ("owner", 0.0)
