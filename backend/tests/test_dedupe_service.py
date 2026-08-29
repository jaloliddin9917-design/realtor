from datetime import UTC, datetime
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ingestion.parse import parse_text
from app.ingestion.photos import save_listing_photo
from app.modules.dedupe.blocking import find_candidates
from app.modules.dedupe.config import load_config
from app.modules.dedupe.models import DedupeReview
from app.modules.dedupe.service import assign, gather_inputs
from app.modules.listings.models import Listing, Source
from app.modules.listings.service import persist_parsed, upsert_raw
from app.modules.properties.service import create_from_listing
from tests.helpers import make_jpeg

NOW = datetime(2026, 8, 29, 12, 0, tzinfo=UTC)
CFG = load_config(Path(__file__).resolve().parents[1] / "config" / "dedupe.yaml")


def _jpeg(seed: int) -> bytes:
    return make_jpeg(400, 300, seed)


async def _source(db: AsyncSession) -> Source:
    s = Source(kind="telegram", name="@t", config={})
    db.add(s)
    await db.flush()
    return s


async def _listing(
    db: AsyncSession,
    source: Source,
    ext: str,
    text_: str,
    photo_seed: int | None = None,
    tmp: Path | None = None,
) -> Listing:
    raw, _ = await upsert_raw(db, source.id, ext, None, {"text": text_}, NOW)
    listing = await persist_parsed(
        db, raw, parse_text(text_), posted_at=NOW, now=NOW, usd_rate=None, contacts=[]
    )
    if photo_seed is not None and tmp is not None:
        await save_listing_photo(db, tmp, listing, 0, _jpeg(photo_seed))
    return listing


OWNER_TEXT = (
    "Chilonzor, Qatortol, 2-xonali, 3/9 qavat, 54 m², evro remont, mebel va texnika bilan, "
    "uzoq muddatga, faqat oilaga. 450$. Tel 90 811 24 37"
)
AGENT_TEXT = (
    "Chilonzor Qatortol 2 xonali 3/9 qavat 55 m² evro remont mebel texnika bor uzoq muddat "
    "oila uchun 480$ xizmat 50% tel 93 402 18 55"
)
OTHER_TEXT = "Yunusobod 11-kvartal 3-xonali 5/9 78 m² 650$ tel 94 128 44 60"


async def test_same_phone_blocks_and_merges(db: AsyncSession) -> None:
    s = await _source(db)
    a = await _listing(db, s, "1", OWNER_TEXT)
    prop = await create_from_listing(db, a, NOW)
    b = await _listing(db, s, "2", "Chilonzor 2-xonali 3/9 460$ tel 90 811 24 37")
    assert [p.id for p in await find_candidates(db, b)] == [prop.id]
    result = await assign(db, b, CFG, NOW)
    assert result.decision == "attached" and result.property.id == prop.id
    assert b.property_id == prop.id and prop.price_usd_min_minor == 45000


async def test_review_range_creates_separate_property_and_review_row(
    db: AsyncSession, tmp_path: Path
) -> None:
    s = await _source(db)
    a = await _listing(db, s, "1", OWNER_TEXT, photo_seed=1, tmp=tmp_path)
    prop = await create_from_listing(db, a, NOW)
    b = await _listing(
        db, s, "2", AGENT_TEXT, photo_seed=1, tmp=tmp_path
    )  # same photo, different phone
    inp = await gather_inputs(db, b, prop)
    assert (
        inp.shared_contact is False
        and inp.min_photo_distance is not None
        and inp.min_photo_distance <= 10
    )
    assert inp.rooms_floors_equal is True
    result = await assign(db, b, CFG, NOW)
    assert (
        result.decision == "review"
        and result.property.id != prop.id
        and result.candidate is not None
    )
    assert 0.5 <= result.score < 0.75
    review = (
        await db.execute(select(DedupeReview).where(DedupeReview.listing_id == b.id))
    ).scalar_one()
    assert review.candidate_property_id == prop.id and review.breakdown["photo"] == 0.3


async def test_unrelated_listing_becomes_new_property(db: AsyncSession) -> None:
    s = await _source(db)
    a = await _listing(db, s, "1", OWNER_TEXT)
    await create_from_listing(db, a, NOW)
    b = await _listing(db, s, "2", OTHER_TEXT)
    assert await find_candidates(db, b) == []
    result = await assign(db, b, CFG, NOW)
    assert result.decision == "new" and result.score == 0.0


async def test_assign_is_idempotent_for_attached_listing(db: AsyncSession) -> None:
    s = await _source(db)
    a = await _listing(db, s, "1", OWNER_TEXT)
    first = await assign(db, a, CFG, NOW)
    second = await assign(db, a, CFG, NOW)
    assert (
        first.decision == "new"
        and second.decision == "attached"
        and second.property.id == first.property.id
    )


async def test_attribute_key_blocks_without_phone_or_photo(db: AsyncSession) -> None:
    s = await _source(db)
    a = await _listing(db, s, "1", "Chilonzor 2-xonali 3/9 54 m² 450$")
    prop = await create_from_listing(db, a, NOW)
    b = await _listing(db, s, "2", "Chilonzor 2 xonali 3/9 qavat 54 kv 455$")
    assert [p.id for p in await find_candidates(db, b)] == [prop.id]
