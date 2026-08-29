import io
from datetime import UTC, datetime, timedelta
from pathlib import Path

from PIL import Image
from sqlalchemy import event, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.ingestion.parse import parse_text
from app.ingestion.photos import store_photo
from app.modules.dedupe.blocking import MAX_CANDIDATES, find_candidates
from app.modules.dedupe.service import gather_inputs
from app.modules.listings.models import Listing, Source
from app.modules.listings.service import persist_parsed, upsert_raw
from app.modules.properties.service import create_from_listing

NOW = datetime(2026, 8, 30, 12, 0, tzinfo=UTC)


async def _source(db: AsyncSession) -> Source:
    s = Source(kind="telegram", name="@t", config={})
    db.add(s)
    await db.flush()
    return s


async def _listing(
    db: AsyncSession, s: Source, ext: str, text_: str, now: datetime = NOW
) -> Listing:
    raw, _ = await upsert_raw(db, s.id, ext, None, {"text": text_}, now)
    return await persist_parsed(
        db, raw, parse_text(text_), posted_at=now, now=now, usd_rate=None, contacts=[]
    )


async def test_new_index_and_unique_exist(db: AsyncSession) -> None:
    idx = {
        r[0]
        for r in (
            await db.execute(
                text(
                    "SELECT indexname FROM pg_indexes "
                    "WHERE tablename IN ('listing_contacts','listing_photos')"
                )
            )
        ).all()
    }
    assert "ix_listing_contacts_contact_id" in idx
    assert "uq_listing_photos_listing_position" in idx


async def test_find_candidates_is_bounded_and_ordered(db: AsyncSession) -> None:
    s = await _source(db)
    # 60 properties sharing one agency phone, seen at different times
    for i in range(60):
        listing = await _listing(
            db,
            s,
            str(i),
            f"Yunusobod {i}-kvartal 2-xonali 3/9 400$ tel 93 402 18 55",
            NOW - timedelta(hours=i),
        )
        await create_from_listing(db, listing, NOW - timedelta(hours=i))
    probe = await _listing(db, s, "probe", "Chilonzor 2-xonali 3/9 420$ tel 93 402 18 55")
    candidates = await find_candidates(db, probe)
    assert len(candidates) == MAX_CANDIDATES == 50
    seen = [c.last_seen_at for c in candidates]
    assert seen == sorted(seen, reverse=True)  # newest first


async def test_similarity_is_one_query(db: AsyncSession) -> None:
    s = await _source(db)
    a = await _listing(
        db, s, "1", "Chilonzor Qatortol 2-xonali evro remont mebel texnika bilan uzoq muddatga"
    )
    prop = await create_from_listing(db, a, NOW)
    for i in range(3):
        sib = await _listing(
            db, s, f"sib{i}", f"Chilonzor Qatortol 2-xonali evro remont mebel texnika bilan {i}"
        )
        sib.property_id = prop.id
    await db.flush()
    b = await _listing(
        db, s, "2", "Chilonzor Qatortol 2 xonali evro remont mebel texnika bor uzoq muddat"
    )
    statements: list[str] = []

    def _record(conn, cursor, statement, parameters, context, executemany):  # type: ignore[no-untyped-def]
        statements.append(statement)

    conn = await db.connection()
    event.listen(conn.sync_connection, "before_cursor_execute", _record)
    try:
        inp = await gather_inputs(db, b, prop)
    finally:
        event.remove(conn.sync_connection, "before_cursor_execute", _record)
    assert inp.description_similarity is not None and inp.description_similarity > 0.5
    assert sum("similarity(" in st for st in statements) == 1


def _jpeg_with_orientation(tmp: Path) -> bytes:
    img = Image.new("RGB", (400, 200), (200, 30, 30))
    exif = img.getexif()
    exif[0x0112] = 6  # Orientation: rotate 90° CW on display
    buf = io.BytesIO()
    img.save(buf, format="JPEG", exif=exif.tobytes())
    return buf.getvalue()


def test_store_photo_applies_exif_orientation(tmp_path: Path) -> None:
    import uuid

    stored = store_photo(tmp_path, uuid.uuid4(), 0, _jpeg_with_orientation(tmp_path))
    assert (stored.width, stored.height) == (200, 400)  # transposed
