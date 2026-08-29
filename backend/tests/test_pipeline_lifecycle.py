from datetime import timedelta
from pathlib import Path

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ingestion.pipeline import run_source
from app.modules.contacts.models import Contact
from app.modules.dedupe.config import load_config
from app.modules.listings.models import Listing, ListingPhoto, Source
from app.modules.listings.service import SeenWindow, age_out
from app.modules.properties.models import Property
from app.modules.properties.service import recompute_many
from tests.fakes import NOW, FakeAdapter, payload

CFG = load_config(Path(__file__).resolve().parents[1] / "config" / "dedupe.yaml")
OWNER = (
    "Chilonzor, Qatortol, 2-xonali, 3/9 qavat, 54 m², evro remont. Egasidan. 450$. Tel 90 811 24 37"
)
AGENT = "Chilonzor Qatortol 2 xonali 3/9 qavat 55 m² evro remont 480$ xizmat 50% tel 93 402 18 55"


async def _source(db: AsyncSession) -> Source:
    s = Source(kind="telegram", name="@t", config={"peer": "@t"}, interval_seconds=900)
    db.add(s)
    await db.flush()
    return s


async def test_listing_gone_marks_removed_without_counting_a_failure(
    db: AsyncSession, tmp_path: Path
) -> None:
    s = await _source(db)
    window = SeenWindow(ids={"1"}, oldest_posted_at=NOW - timedelta(days=1))
    await run_source(
        db, FakeAdapter([payload("1", OWNER)], window), s, cfg=CFG, photo_dir=tmp_path, now=NOW
    )
    run = await run_source(
        db,
        FakeAdapter([payload("1", OWNER)], window, gone_ids={"1"}),
        s,
        cfg=CFG,
        photo_dir=tmp_path,
        now=NOW + timedelta(minutes=15),
    )
    assert (run.failed, run.removed) == (0, 1)
    listing = (await db.execute(select(Listing))).scalar_one()
    prop = (await db.execute(select(Property))).scalar_one()
    assert (
        listing.source_removed
        and listing.removed_at == NOW + timedelta(minutes=15)
        and prop.source_removed
    )


async def test_backoff_pauses_source_without_failure(db: AsyncSession, tmp_path: Path) -> None:
    s = await _source(db)
    run = await run_source(
        db,
        FakeAdapter([], None, backoff_on_discover=timedelta(minutes=7)),
        s,
        cfg=CFG,
        photo_dir=tmp_path,
        now=NOW,
    )
    assert run.error == "flood wait" and run.finished_at == NOW
    assert (s.consecutive_failures, s.status, s.paused_until) == (
        0,
        "paused",
        NOW + timedelta(minutes=7),
    )
    assert s.next_run_at == NOW + timedelta(seconds=900)


async def test_login_required_pauses_an_hour(db: AsyncSession, tmp_path: Path) -> None:
    s = await _source(db)
    run = await run_source(
        db, FakeAdapter([], None, login_required=True), s, cfg=CFG, photo_dir=tmp_path, now=NOW
    )
    assert run.error == "session revoked"
    assert (s.status, s.paused_until, s.consecutive_failures) == (
        "login_required",
        NOW + timedelta(hours=1),
        0,
    )


async def test_changed_payload_with_fewer_photos_prunes_extra_rows(
    db: AsyncSession, tmp_path: Path
) -> None:
    s = await _source(db)
    await run_source(
        db,
        FakeAdapter([payload("1", OWNER, photos=["1", "2", "3"])], None),
        s,
        cfg=CFG,
        photo_dir=tmp_path,
        now=NOW,
    )
    await run_source(
        db,
        FakeAdapter([payload("1", OWNER + " (yangilandi)", photos=["1"])], None),
        s,
        cfg=CFG,
        photo_dir=tmp_path,
        now=NOW + timedelta(hours=1),
    )
    positions = (
        (await db.execute(select(ListingPhoto.position).order_by(ListingPhoto.position)))
        .scalars()
        .all()
    )
    assert positions == [0]
    listing = (await db.execute(select(Listing))).scalar_one()
    assert not (tmp_path / f"{listing.id}" / "1.jpg").exists()


async def test_attach_rescores_every_contact_of_the_property(
    db: AsyncSession, tmp_path: Path
) -> None:
    s = await _source(db)
    # Same posting channel (shared telegram contact) so the pair merges: contact 0.5 +
    # photo 0.3 + rooms/floors 0.1 + area 0.05 + price 0.05 = 1.0 ≥ merge_threshold.
    # The first poster is an agent (marker +0.3); once the second listing attaches, the
    # first listing is the earliest in the property (−0.1) → 0.3 becomes 0.2 — a change
    # only property-wide rescoring produces (the new listing's own contacts rescored).
    agent_text = (
        "Chilonzor, Qatortol, 2-xonali, 3/9 qavat, 54 m², evro remont. Rieltor. "
        "450$. Tel 90 811 24 37"
    )
    first = payload(
        "1",
        agent_text,
        NOW - timedelta(days=1),
        photos=["1"],
        username="chilonzor_arenda",
    )
    await run_source(
        db, FakeAdapter([first], None), s, cfg=CFG, photo_dir=tmp_path, now=NOW - timedelta(days=1)
    )
    agent = (
        await db.execute(select(Contact).where(Contact.identifier == "+998908112437"))
    ).scalar_one()
    assert (
        agent.agency_score == pytest.approx(0.3) and agent.classification == "owner"
    )  # ≤ 0.3, alone on its property
    second = payload(
        "2",
        "Chilonzor 2-xonali 3/9 54 m² 430$ tel 93 402 18 55",
        NOW,
        photos=["1"],
        username="chilonzor_arenda",
    )
    run = await run_source(
        db, FakeAdapter([first, second], None), s, cfg=CFG, photo_dir=tmp_path, now=NOW
    )
    assert run.new == 1
    assert (await db.execute(select(func.count()).select_from(Property))).scalar_one() == 1
    await db.refresh(agent)
    assert agent.agency_score == pytest.approx(
        0.2
    )  # rescored after the attach: earliest of two listings
    other = (
        await db.execute(select(Contact).where(Contact.identifier == "+998934021855"))
    ).scalar_one()
    assert other.agency_score == pytest.approx(0.0)  # cheapest of two, clamped at 0


async def test_age_out_returns_affected_properties(db: AsyncSession, tmp_path: Path) -> None:
    s = await _source(db)
    await run_source(
        db, FakeAdapter([payload("1", OWNER)], None), s, cfg=CFG, photo_dir=tmp_path, now=NOW
    )
    affected = await age_out(db, NOW + timedelta(days=31))
    assert len(affected) == 1
    assert await recompute_many(db, affected) == 1
    prop = (await db.execute(select(Property))).scalar_one()
    assert prop.source_removed is True
