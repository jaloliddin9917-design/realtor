"""One flat, two sources: `properties.source_removed` is a property-wide fact.

Spec §3.5: "a property whose listings are **all** `source_removed` gets
`properties.source_removed = true`", and a listing seen again clears it
(resurrection). Both statements are about *every* listing of the property, whatever
source each one came from — so a run of one source may never decide the flag from its
own listings alone.
"""

from datetime import timedelta
from pathlib import Path

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ingestion.pipeline import run_source
from app.modules.dedupe.config import load_config
from app.modules.listings.models import Listing, RawListing, Source
from app.modules.listings.service import SeenWindow
from app.modules.properties.models import Property
from tests.fakes import NOW, FakeAdapter, payload

CFG = load_config(Path(__file__).resolve().parents[1] / "config" / "dedupe.yaml")

# The same ad, cross-posted: identical text → same phone (contact 0.50) and the same
# description (0.15), plus rooms/floors 0.10, area 0.05 and price 0.05 = 0.85 ≥ the
# 0.75 merge threshold, so the two listings become one property.
FLAT = (
    "Chilonzor, Qatortol, 2-xonali, 3/9 qavat, 54 m², evro remont. Egasidan. 450$. Tel 90 811 24 37"
)


class OlxFake(FakeAdapter):
    kind = "olx"


def _window(ids: set[str]) -> SeenWindow:
    return SeenWindow(ids=ids, oldest_posted_at=NOW - timedelta(days=1))


async def _listing_of(db: AsyncSession, source: Source) -> Listing:
    stmt = (
        select(Listing)
        .join(RawListing, RawListing.id == Listing.raw_listing_id)
        .where(RawListing.source_id == source.id)
    )
    return (await db.execute(stmt)).scalar_one()


async def test_property_removal_follows_every_source_not_just_the_one_that_ran(
    db: AsyncSession, tmp_path: Path
) -> None:
    olx = Source(kind="olx", name="olx-cross", config={"url": "x"}, interval_seconds=900)
    tg = Source(kind="telegram", name="@cross", config={"peer": "@cross"}, interval_seconds=900)
    db.add_all([olx, tg])
    await db.flush()
    olx_seen, tg_seen, nothing = _window({"olx-1"}), _window({"tg-1"}), _window(set())

    await run_source(
        db,
        OlxFake([payload("olx-1", FLAT)], olx_seen),
        olx,
        cfg=CFG,
        photo_dir=tmp_path,
        now=NOW,
    )
    await run_source(
        db, FakeAdapter([payload("tg-1", FLAT)], tg_seen), tg, cfg=CFG, photo_dir=tmp_path, now=NOW
    )
    assert (await db.execute(select(func.count()).select_from(Property))).scalar_one() == 1
    prop = (await db.execute(select(Property))).scalar_one()

    # Delisted on OLX only. Four alternating rounds: the third OLX run trips the
    # 3-miss rule, and every run after it must leave the property alone — the Telegram
    # listing is still live, so the property is not removed from *its* sources.
    for round_ in range(1, 5):
        at = NOW + timedelta(hours=round_)
        await run_source(db, OlxFake([], nothing), olx, cfg=CFG, photo_dir=tmp_path, now=at)
        await db.refresh(prop)
        assert prop.source_removed is False, f"after olx run {round_}"
        await run_source(
            db,
            FakeAdapter([payload("tg-1", FLAT)], tg_seen),
            tg,
            cfg=CFG,
            photo_dir=tmp_path,
            now=at,
        )
        await db.refresh(prop)
        assert prop.source_removed is False, f"after telegram run {round_}"
    assert (await _listing_of(db, olx)).source_removed is True
    assert (await _listing_of(db, tg)).source_removed is False

    # Now it goes from Telegram too: with every listing removed, so is the property.
    for round_ in range(5, 8):
        await run_source(
            db,
            FakeAdapter([], nothing),
            tg,
            cfg=CFG,
            photo_dir=tmp_path,
            now=NOW + timedelta(hours=round_),
        )
    await db.refresh(prop)
    assert prop.source_removed is True

    # Re-listed on Telegram (spec §3.5 resurrection): one live listing is enough.
    await run_source(
        db,
        FakeAdapter([payload("tg-1", FLAT)], tg_seen),
        tg,
        cfg=CFG,
        photo_dir=tmp_path,
        now=NOW + timedelta(hours=9),
    )
    await db.refresh(prop)
    assert prop.source_removed is False
    assert (await _listing_of(db, olx)).source_removed is True  # still gone from OLX
