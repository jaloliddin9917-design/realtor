"""The worker: run due sources sequentially, keep a heartbeat, run the daily maintenance jobs."""

import asyncio
import signal
import uuid
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import httpx
import structlog
from sqlalchemy import or_, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import make_engine, make_session_factory
from app.core.logging import configure_logging
from app.core.settings import Settings, get_settings
from app.ingestion.pipeline import run_source
from app.ingestion.registry import AdapterRegistry, build_registry
from app.modules.contacts.scoring import rescore_all
from app.modules.dedupe.config import DedupeConfig, load_config
from app.modules.listings.fx import refresh_rate
from app.modules.listings.models import CrawlRun, Source
from app.modules.listings.service import age_out
from app.modules.properties.service import recompute_many
from app.worker.models import WorkerHeartbeat

log = structlog.get_logger()


async def due_sources(session: AsyncSession, now: datetime) -> list[Source]:
    """Enabled sources whose schedule and backoff both allow a run now, earliest first."""
    stmt = (
        select(Source)
        .where(
            Source.enabled.is_(True),
            or_(Source.next_run_at.is_(None), Source.next_run_at <= now),
            or_(Source.paused_until.is_(None), Source.paused_until <= now),
        )
        .order_by(Source.next_run_at.asc().nulls_first(), Source.created_at)
    )
    return list((await session.execute(stmt)).scalars().all())


async def run_due_sources(
    session_factory: Callable[[], AsyncSession],
    registry: AdapterRegistry,
    *,
    cfg: DedupeConfig,
    photo_dir: Path,
    now: datetime,
) -> list[uuid.UUID]:
    """Run every due source, one session per source, and return the `CrawlRun` ids.

    `run_source`'s transaction contract (see its module docstring) is that the caller
    commits after it returns AND after it raises, since the except-clause inside it
    writes circuit-breaker bookkeeping before re-raising. So each source gets its own
    try/except/finally here: a failing source is logged, never allowed to stop the
    batch, and its session is committed regardless in the `finally`.
    """
    async with session_factory() as session:
        due = [s.id for s in await due_sources(session, now)]
    run_ids: list[uuid.UUID] = []
    for source_id in due:
        async with session_factory() as session:
            source = await session.get(Source, source_id)
            if source is None:
                continue
            run_id: uuid.UUID | None = None
            try:
                adapter = registry.for_source(source)
                run = await run_source(
                    session, adapter, source, cfg=cfg, photo_dir=photo_dir, now=now
                )
                run_id = run.id
                log.info(
                    "source_run",
                    source=source.name,
                    found=run.found,
                    new=run.new,
                    changed=run.changed,
                    failed=run.failed,
                    removed=run.removed,
                    error=run.error,
                )
            except Exception as exc:  # noqa: BLE001 — the bookkeeping is already on the session; commit it
                log.warning("source_run_failed", source=source.name, error=str(exc))
            finally:
                await (
                    session.commit()
                )  # the pipeline's contract: commit after return AND after raise
            if run_id is None:  # a failed run's row was written by run_source before it raised
                stmt = select(CrawlRun.id).where(
                    CrawlRun.source_id == source_id, CrawlRun.started_at == now
                )
                run_id = (await session.execute(stmt)).scalar_one_or_none()
            if run_id is not None:
                run_ids.append(run_id)
    return run_ids


def daily_due(last: datetime | None, now: datetime, tz: str, hour: int) -> bool:
    """True once local time is past `hour` and the job hasn't already run today (local)."""
    zone = ZoneInfo(tz)
    local_now = now.astimezone(zone)
    if local_now.hour < hour:
        return False
    return last is None or last.astimezone(zone).date() < local_now.date()


async def daily_jobs(
    session: AsyncSession, *, now: datetime, http: httpx.AsyncClient
) -> dict[str, int]:
    """Age out stale listings, rescore contacts, and refresh the FX rate.

    FX failure is logged and reported as `fx: 0`, never raised: age-out and rescoring
    are DB-only and should fail loudly, but a flaky exchange-rate endpoint must not
    block them or crash the worker.
    """
    affected = await age_out(session, now)
    aged = await recompute_many(session, affected)
    rescored = await rescore_all(session, now)
    fx = 0
    try:
        await refresh_rate(session, http)
        fx = 1
    except Exception as exc:  # noqa: BLE001 — keep the last rate; fx failure must never block the rest
        log.warning("fx_refresh_failed", error=str(exc))
    return {"aged_out_properties": aged, "rescored_contacts": rescored, "fx": fx}


async def heartbeat(session: AsyncSession, name: str, now: datetime) -> None:
    """Upsert `name`'s last-tick timestamp."""
    stmt = insert(WorkerHeartbeat).values(name=name, last_tick_at=now)
    stmt = stmt.on_conflict_do_update(
        index_elements=[WorkerHeartbeat.name], set_={"last_tick_at": now}
    )
    await session.execute(stmt)


async def tick(
    session_factory: Callable[[], AsyncSession],
    registry: AdapterRegistry,
    *,
    settings: Settings,
    cfg: DedupeConfig,
    http: httpx.AsyncClient,
    now: datetime,
) -> None:
    """One worker cycle: heartbeat, run due sources, then the daily jobs if they're due."""
    async with session_factory() as session:
        await heartbeat(session, "worker", now)
        await session.commit()
    await run_due_sources(session_factory, registry, cfg=cfg, photo_dir=settings.photo_dir, now=now)
    async with session_factory() as session:
        last = await session.get(WorkerHeartbeat, "daily")
        if daily_due(
            last.last_tick_at if last else None, now, settings.tz, settings.daily_job_hour
        ):
            result = await daily_jobs(session, now=now, http=http)
            await heartbeat(session, "daily", now)
            await session.commit()
            log.info("daily_jobs", **result)


async def main() -> None:
    """Entry point for `python -m app.worker`: tick forever until SIGINT/SIGTERM."""
    settings = get_settings()
    configure_logging(settings.log_level)
    engine = make_engine(settings.database_url)
    factory = make_session_factory(engine)
    registry = build_registry(settings)
    cfg = load_config(settings.dedupe_config_path)
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, stop.set)
    log.info("worker_start", tick_seconds=settings.worker_tick_seconds, adapters=registry.kinds)
    async with httpx.AsyncClient(timeout=30) as http:
        while not stop.is_set():
            try:
                await tick(
                    factory, registry, settings=settings, cfg=cfg, http=http, now=datetime.now(UTC)
                )
            except Exception as exc:  # noqa: BLE001 — a tick must never kill the worker
                log.error("tick_failed", error=str(exc))
            try:
                await asyncio.wait_for(stop.wait(), timeout=settings.worker_tick_seconds)
            except TimeoutError:
                continue
    await engine.dispose()
    log.info("worker_stop")
