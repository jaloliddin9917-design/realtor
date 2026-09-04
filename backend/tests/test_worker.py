from datetime import UTC, datetime, timedelta
from decimal import Decimal
from pathlib import Path

import httpx
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.settings import Settings
from app.ingestion.registry import AdapterRegistry
from app.modules.dedupe.config import load_config
from app.modules.listings.models import CrawlRun, FxRate, Source
from app.modules.listings.service import SeenWindow
from app.worker.loop import daily_due, daily_jobs, due_sources, heartbeat, run_due_sources, tick
from app.worker.models import WorkerHeartbeat
from tests.fakes import FakeAdapter, payload, savepoint_session_factory

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
            "olx": Broken([], None),  # type: ignore[dict-item]
        }
    )
    factory = await savepoint_session_factory(db)
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


async def test_run_due_sources_recovers_when_a_source_commit_fails(
    db: AsyncSession, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A per-source commit failure (e.g. a poisoned transaction from `run_source`'s own
    bookkeeping flush — `run_bookkeeping_failed` in pipeline.py) must be logged and
    rolled back without escaping the loop, so every other due source still runs.

    Regression for the previously-unguarded `finally: await session.commit()`, which
    let a failed commit raise out of `run_due_sources` and skip every remaining source.
    """
    first = Source(
        kind="telegram",
        name="first",
        config={"peer": "@first"},
        next_run_at=NOW - timedelta(minutes=2),
    )
    second = Source(
        kind="telegram",
        name="second",
        config={"peer": "@second"},
        next_run_at=NOW - timedelta(minutes=1),
    )
    db.add_all([first, second])
    await db.flush()
    base_factory = await savepoint_session_factory(db)
    calls = 0

    async def failing_commit() -> None:
        raise RuntimeError("commit boom")

    def factory() -> AsyncSession:
        nonlocal calls
        calls += 1
        session = base_factory()
        if calls == 2:  # the first per-source session; call 1 is due_sources' own snapshot read
            monkeypatch.setattr(session, "commit", failing_commit)
        return session

    registry = AdapterRegistry(
        {"telegram": FakeAdapter([payload("1", OWNER)], SeenWindow(set(), NOW - timedelta(days=1)))}
    )
    run_ids = await run_due_sources(factory, registry, cfg=CFG, photo_dir=tmp_path, now=NOW)
    second_run = (
        await db.execute(select(CrawlRun).where(CrawlRun.source_id == second.id))
    ).scalar_one()
    assert run_ids == [second_run.id]
    first_runs = (
        (await db.execute(select(CrawlRun).where(CrawlRun.source_id == first.id))).scalars().all()
    )
    assert first_runs == []  # rolled back: nothing persisted for the source whose commit failed


async def test_run_due_sources_marks_a_source_with_no_registered_adapter_misconfigured(
    db: AsyncSession, tmp_path: Path
) -> None:
    """A source whose adapter cannot be built is not a transient failure: retrying it
    every tick logs forever and never gets anywhere. It is parked as `misconfigured` for
    an hour instead — visible in `list-sources`, and out of `due_sources` meanwhile —
    without touching `consecutive_failures` (nothing actually failed to *run*)."""
    orphan = Source(kind="manual", name="orphan", config={})
    db.add(orphan)
    await db.flush()
    registry = AdapterRegistry({})  # no "manual" adapter registered
    factory = await savepoint_session_factory(db)
    run_ids = await run_due_sources(factory, registry, cfg=CFG, photo_dir=tmp_path, now=NOW)
    assert run_ids == []
    assert (await db.execute(select(CrawlRun))).scalars().all() == []
    await db.refresh(orphan)
    assert orphan.status == "misconfigured"
    assert orphan.paused_until == NOW + timedelta(hours=1)
    assert orphan.consecutive_failures == 0
    assert await due_sources(db, NOW + timedelta(minutes=30)) == []


async def test_run_due_sources_parks_a_telegram_source_missing_credentials(
    db: AsyncSession, tmp_path: Path
) -> None:
    """`registry.for_source` can raise `ValueError` not only for an unregistered kind
    but also when a *registered* kind's lazy factory fails to build (e.g. a Telegram
    source when TELEGRAM_API_ID/TELEGRAM_API_HASH aren't configured — see
    `app.ingestion.registry.AdapterRegistry`). That must be treated exactly like an
    unregistered kind: parked as `misconfigured`, never stopping the rest of the batch."""

    class Olx(FakeAdapter):
        kind = "olx"

    def missing_credentials() -> FakeAdapter:
        raise ValueError(
            "telegram credentials are not configured (TELEGRAM_API_ID / TELEGRAM_API_HASH)"
        )

    ok = Source(kind="olx", name="ok-olx", config={"url": "x"})
    broken = Source(kind="telegram", name="no-creds-telegram", config={"peer": "@x"})
    db.add_all([ok, broken])
    await db.flush()
    registry = AdapterRegistry(
        {"olx": Olx([payload("1", OWNER)], SeenWindow({"1"}, NOW - timedelta(days=1)))},
        factories={"telegram": missing_credentials},
    )
    factory = await savepoint_session_factory(db)
    run_ids = await run_due_sources(factory, registry, cfg=CFG, photo_dir=tmp_path, now=NOW)
    runs = {r.source_id: r for r in (await db.execute(select(CrawlRun))).scalars().all()}
    assert run_ids == [runs[ok.id].id]
    assert runs[ok.id].new == 1  # the healthy source still ran
    assert broken.id not in runs
    await db.refresh(broken)
    assert broken.status == "misconfigured"
    assert broken.paused_until == NOW + timedelta(hours=1)
    assert broken.consecutive_failures == 0


async def test_run_due_sources_stops_the_batch_between_sources_when_asked(
    db: AsyncSession, tmp_path: Path
) -> None:
    """A tick that finds many due sources used to run every one of them before the
    worker could react to SIGTERM. `should_stop` is checked before each source, so a
    shutdown waits for at most one source run instead of the whole batch."""
    first = Source(
        kind="telegram",
        name="first",
        config={"peer": "@first"},
        next_run_at=NOW - timedelta(minutes=2),
    )
    second = Source(
        kind="telegram",
        name="second",
        config={"peer": "@second"},
        next_run_at=NOW - timedelta(minutes=1),
    )
    db.add_all([first, second])
    await db.flush()
    registry = AdapterRegistry(
        {"telegram": FakeAdapter([payload("1", OWNER)], SeenWindow({"1"}, NOW - timedelta(days=1)))}
    )
    factory = await savepoint_session_factory(db)
    checks = 0

    def should_stop() -> bool:
        nonlocal checks
        checks += 1
        return checks > 1  # let the first source run, then stop

    run_ids = await run_due_sources(
        factory, registry, cfg=CFG, photo_dir=tmp_path, now=NOW, should_stop=should_stop
    )
    runs = (await db.execute(select(CrawlRun))).scalars().all()
    assert [r.source_id for r in runs] == [first.id]
    assert run_ids == [runs[0].id]
    await db.refresh(second)
    assert second.last_run_at is None  # never started


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

    # 40 days ago is past age_out's 30-day window (so the listing ages out) but still
    # inside rescore_all's fixed 90-day `last_seen_at` window — OWNER's phone number
    # does parse to a real contact (parse_text(...).phones == ["+998908112437"]), so
    # that contact is legitimately picked up by rescore_all. This is the point of the
    # test: it exercises daily_jobs' rescore_all call for real, so deleting that call
    # would make rescored_contacts come back 0 and fail the assertion below.
    await run_source(
        db,
        FakeAdapter([payload("1", OWNER)], None),
        s,
        cfg=CFG,
        photo_dir=tmp_path,
        now=NOW - timedelta(days=40),
    )
    async with _cbu_client() as client:
        result = await daily_jobs(db, now=NOW, http=client)
    assert result == {"aged_out_properties": 1, "rescored_contacts": 1, "fx": 1}
    # Decimal.__eq__ against a bare float compares exact binary values, and the float
    # 12345.67 is actually 12345.670000000000072759576141834259033203125 — so this must
    # compare against a Decimal, not the float literal, or it fails despite storing the
    # right rate.
    assert (await db.execute(select(FxRate))).scalar_one().usd_uzs == Decimal("12345.67")


async def test_tick_heartbeats_and_runs_daily_once(db: AsyncSession, tmp_path: Path) -> None:
    factory = await savepoint_session_factory(db)
    registry = AdapterRegistry({})
    settings = Settings(_env_file=None, photo_dir=tmp_path)
    async with _cbu_client() as client:
        await tick(factory, registry, settings=settings, cfg=CFG, http=client, now=NOW)
        # the first tick's daily jobs must have actually run, not just heartbeat "daily":
        # confirm the FX rate they fetched was persisted.
        assert (await db.execute(select(FxRate))).scalar_one().usd_uzs == Decimal("12345.67")
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
    worker_row = await db.get(WorkerHeartbeat, "worker")
    assert worker_row is not None
    await heartbeat(db, "worker", NOW + timedelta(minutes=2))
    await db.refresh(worker_row)
    assert worker_row.last_tick_at == NOW + timedelta(minutes=2)


async def test_tick_skips_daily_jobs_when_stopped(db: AsyncSession, tmp_path: Path) -> None:
    """A SIGTERM mid-batch (`should_stop` becomes true) must not be followed by the daily
    jobs: the worker heartbeat still records the tick, but `daily` must wait for a tick
    that runs to completion — NOW is past `daily_job_hour` in Tashkent, so without the
    should_stop check the daily jobs would otherwise run on this same tick."""
    factory = await savepoint_session_factory(db)
    registry = AdapterRegistry({})
    settings = Settings(_env_file=None, photo_dir=tmp_path)
    async with _cbu_client() as client:
        await tick(
            factory,
            registry,
            settings=settings,
            cfg=CFG,
            http=client,
            now=NOW,
            should_stop=lambda: True,
        )
    beats = {
        b.name: b.last_tick_at for b in (await db.execute(select(WorkerHeartbeat))).scalars().all()
    }
    assert beats == {"worker": NOW}
    assert (await db.execute(select(FxRate))).scalars().all() == []


def test_worker_process_has_complete_orm_metadata() -> None:
    """A worker-only process must register every model so string ForeignKeys resolve.

    Regression guard for the "could not find table 'users'" flush failure: the worker imports
    the ORM directly (not through the API's router graph), so it must pull in every model module
    — otherwise `properties.assigned_agent_id -> users` cannot be resolved. The in-process test
    suite can't catch this (conftest imports every model), so this runs a fresh subprocess that
    imports only the worker and forces mapper configuration.
    """
    import subprocess
    import sys

    result = subprocess.run(
        [
            sys.executable,
            "-c",
            "import app.worker.loop; "
            "from sqlalchemy.orm import configure_mappers; "
            "configure_mappers()",
        ],
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr
