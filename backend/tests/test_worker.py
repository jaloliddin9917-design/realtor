from datetime import UTC, datetime, timedelta
from decimal import Decimal
from pathlib import Path

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.settings import Settings
from app.ingestion.registry import AdapterRegistry
from app.modules.dedupe.config import load_config
from app.modules.listings.models import CrawlRun, FxRate, Source
from app.modules.listings.service import SeenWindow
from app.worker.loop import daily_due, daily_jobs, due_sources, heartbeat, run_due_sources, tick
from app.worker.models import WorkerHeartbeat
from tests.fakes import FakeAdapter, payload, test_session_factory

CFG = load_config(Path(__file__).resolve().parents[1] / "config" / "dedupe.yaml")
NOW = datetime(2026, 8, 30, 12, 0, tzinfo=UTC)  # 17:00 in Tashkent
OWNER = "Chilonzor 2-xonali 3/9 54 m² 450$ egasidan tel 90 811 24 37"


def _cbu_client() -> httpx.AsyncClient:
    body = [{"Ccy": "USD", "Rate": "12345.67", "Date": "30.08.2026"}]
    return httpx.AsyncClient(
        transport=httpx.MockTransport(lambda r: httpx.Response(200, json=body))
    )


async def test_due_sources_filters_and_orders(db: AsyncSession) -> None:
    a = Source(kind="telegram", name="a", config={}, next_run_at=None)
    b = Source(kind="telegram", name="b", config={}, next_run_at=NOW - timedelta(minutes=1))
    c = Source(kind="telegram", name="c", config={}, next_run_at=NOW + timedelta(minutes=1))
    d = Source(
        kind="telegram",
        name="d",
        config={},
        next_run_at=None,
        paused_until=NOW + timedelta(hours=1),
    )
    e = Source(kind="telegram", name="e", config={}, enabled=False)
    db.add_all([a, b, c, d, e])
    await db.flush()
    assert [s.name for s in await due_sources(db, NOW)] == ["a", "b"]


async def test_run_due_sources_commits_even_when_a_source_fails(
    db: AsyncSession, tmp_path: Path
) -> None:
    ok = Source(kind="telegram", name="ok", config={"peer": "@ok"})
    broken = Source(kind="olx", name="broken", config={"url": "x"})
    db.add_all([ok, broken])
    await db.flush()

    class Broken(FakeAdapter):
        kind = "olx"

        async def discover(self, source: Source):  # type: ignore[no-untyped-def]
            raise RuntimeError("flood")
            yield  # pragma: no cover

    registry = AdapterRegistry(
        {
            "telegram": FakeAdapter(
                [payload("1", OWNER)], SeenWindow({"1"}, NOW - timedelta(days=1))
            ),
            "olx": Broken([], None),
        }
    )  # type: ignore[dict-item]
    factory = await test_session_factory(db)
    run_ids = await run_due_sources(factory, registry, cfg=CFG, photo_dir=tmp_path, now=NOW)
    assert len(run_ids) == 2
    runs = {r.source_id: r for r in (await db.execute(select(CrawlRun))).scalars().all()}
    assert runs[ok.id].new == 1 and runs[broken.id].error == "flood"
    await db.refresh(broken)
    assert (
        broken.consecutive_failures == 1
        and broken.status == "failing"
        and broken.next_run_at == NOW + timedelta(seconds=900)
    )


async def test_run_due_sources_skips_a_source_with_no_registered_adapter(
    db: AsyncSession, tmp_path: Path
) -> None:
    orphan = Source(kind="manual", name="orphan", config={})
    db.add(orphan)
    await db.flush()
    registry = AdapterRegistry({})  # no "manual" adapter registered
    factory = await test_session_factory(db)
    run_ids = await run_due_sources(factory, registry, cfg=CFG, photo_dir=tmp_path, now=NOW)
    assert run_ids == []
    assert (await db.execute(select(CrawlRun))).scalars().all() == []
    await db.refresh(orphan)
    assert orphan.consecutive_failures == 0 and orphan.status == "ok"


def test_daily_due_uses_local_date_and_hour() -> None:
    assert daily_due(None, NOW, "Asia/Tashkent", 3)
    assert not daily_due(NOW - timedelta(hours=1), NOW, "Asia/Tashkent", 3)  # already ran today
    assert daily_due(NOW - timedelta(days=1), NOW, "Asia/Tashkent", 3)
    early = datetime(2026, 8, 30, 21, 30, tzinfo=UTC)  # 02:30 next day in Tashkent, before 03:00
    assert not daily_due(NOW - timedelta(days=1), early, "Asia/Tashkent", 3)


async def test_daily_jobs_age_out_rescore_and_fx(db: AsyncSession, tmp_path: Path) -> None:
    s = Source(kind="telegram", name="s", config={})
    db.add(s)
    await db.flush()
    from app.ingestion.pipeline import run_source

    # 100 days ago clears both age_out's 30-day window and rescore_all's fixed 90-day
    # window (unlike the 40 days first tried here, which ages the listing out but still
    # falls inside rescore_all's 90-day window — OWNER's phone number does parse to a
    # real contact, so that left rescored_contacts == 1, not 0).
    await run_source(
        db,
        FakeAdapter([payload("1", OWNER)], None),
        s,
        cfg=CFG,
        photo_dir=tmp_path,
        now=NOW - timedelta(days=100),
    )
    async with _cbu_client() as client:
        result = await daily_jobs(db, now=NOW, http=client)
    assert result == {"aged_out_properties": 1, "rescored_contacts": 0, "fx": 1}
    # Decimal.__eq__ against a bare float compares exact binary values, and the float
    # 12345.67 is actually 12345.670000000000072759576141834259033203125 — so this must
    # compare against a Decimal, not the float literal, or it fails despite storing the
    # right rate.
    assert (await db.execute(select(FxRate))).scalar_one().usd_uzs == Decimal("12345.67")


async def test_tick_heartbeats_and_runs_daily_once(db: AsyncSession, tmp_path: Path) -> None:
    factory = await test_session_factory(db)
    registry = AdapterRegistry({})
    settings = Settings(_env_file=None, photo_dir=tmp_path)
    async with _cbu_client() as client:
        await tick(factory, registry, settings=settings, cfg=CFG, http=client, now=NOW)
        await tick(
            factory,
            registry,
            settings=settings,
            cfg=CFG,
            http=client,
            now=NOW + timedelta(minutes=1),
        )
    beats = {
        b.name: b.last_tick_at for b in (await db.execute(select(WorkerHeartbeat))).scalars().all()
    }
    assert (
        beats["worker"] == NOW + timedelta(minutes=1) and beats["daily"] == NOW
    )  # daily ran on the first tick only
    await heartbeat(db, "worker", NOW + timedelta(minutes=2))
