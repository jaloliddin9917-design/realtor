"""Admin: sources, adding a Telegram channel (validated through Telethon), crawl history."""

import uuid
from datetime import UTC, datetime
from typing import Protocol, runtime_checkable

from fastapi import APIRouter
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.api.deps import AdminUser, RegistryDep, SessionDep
from app.api.problems import ApiError
from app.ingestion.adapters.base import AdapterBackoff, LoginRequired
from app.modules.listings.models import CrawlRun, FxRate, Source
from app.modules.listings.schemas import (
    CrawlRunOut,
    FxOut,
    SourceCreateIn,
    SourceOut,
    SourcePatchIn,
    SourcesOut,
)

router = APIRouter(tags=["sources"])
FX_STALE_DAYS = 7
RUNS_LIMIT = 20


@runtime_checkable
class PeerResolver(Protocol):
    async def resolve_peer(self, peer: str | int) -> tuple[int, str | None]: ...


async def _last_runs(session: SessionDep, source_ids: list[uuid.UUID]) -> dict[uuid.UUID, CrawlRun]:
    if not source_ids:
        return {}
    # DISTINCT ON (source_id), ordered started_at DESC, id DESC: picks one deterministic
    # row per source even when two runs share the same started_at (matches source_runs'
    # tie-break below).
    stmt = (
        select(CrawlRun)
        .distinct(CrawlRun.source_id)
        .where(CrawlRun.source_id.in_(source_ids))
        .order_by(CrawlRun.source_id, CrawlRun.started_at.desc(), CrawlRun.id.desc())
    )
    return {run.source_id: run for run in (await session.execute(stmt)).scalars()}


async def _fx(session: SessionDep) -> FxOut | None:
    rate = (
        await session.execute(select(FxRate).order_by(FxRate.date.desc()).limit(1))
    ).scalar_one_or_none()
    if rate is None:
        return None
    return FxOut.from_rate(rate, datetime.now(UTC).date(), FX_STALE_DAYS)


async def _require_source(session: SessionDep, source_id: uuid.UUID) -> Source:
    source = await session.get(Source, source_id)
    if source is None:
        raise ApiError(404, "not_found", "source not found")
    return source


@router.get("/sources", response_model=SourcesOut)
async def list_sources(session: SessionDep, _: AdminUser) -> SourcesOut:
    sources = list((await session.execute(select(Source).order_by(Source.name))).scalars().all())
    runs = await _last_runs(session, [s.id for s in sources])
    return SourcesOut(
        items=[SourceOut.from_source(s, runs.get(s.id)) for s in sources], fx=await _fx(session)
    )


@router.post(
    "/sources",
    response_model=SourceOut,
    status_code=201,
    responses={
        409: {"description": "name taken"},
        422: {"description": "peer cannot be resolved"},
        503: {"description": "telegram unavailable"},
    },
)
async def create_source(
    body: SourceCreateIn, session: SessionDep, _: AdminUser, registry: RegistryDep
) -> SourceOut:
    try:
        adapter = registry.get(body.kind)
    except (KeyError, ValueError) as exc:
        raise ApiError(
            503, "source.misconfigured", f"{body.kind} adapter unavailable: {exc}"
        ) from exc
    if not isinstance(adapter, PeerResolver):
        raise ApiError(503, "source.misconfigured", f"{body.kind} adapter cannot resolve peers")
    try:
        chat_id, username = await adapter.resolve_peer(body.peer)
    except LoginRequired as exc:
        raise ApiError(503, "source.login_required", str(exc)) from exc
    except AdapterBackoff as exc:
        raise ApiError(503, "source.unavailable", str(exc)) from exc
    except Exception as exc:  # Telethon raises several error types for a bad peer
        raise ApiError(
            422, "source.peer_unresolved", f"cannot resolve {body.peer!r}: {exc}"
        ) from exc
    name = body.name or (f"@{username}" if username else body.peer)
    source = Source(
        kind=body.kind,
        name=name,
        config={"peer": body.peer, "chat_id": chat_id, "username": username},
        interval_seconds=body.interval_seconds,
        enabled=True,
    )
    session.add(source)
    try:
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        raise ApiError(409, "source.exists", f"source {name!r} already exists") from exc
    return SourceOut.from_source(source, None)


@router.patch(
    "/sources/{source_id}",
    response_model=SourceOut,
    responses={404: {"description": "unknown source"}},
)
async def patch_source(
    source_id: uuid.UUID, body: SourcePatchIn, session: SessionDep, _: AdminUser
) -> SourceOut:
    source = await _require_source(session, source_id)
    if body.enabled and not source.enabled:
        source.next_run_at = None  # due on the next worker tick
        source.paused_until = None
    source.enabled = body.enabled
    await session.commit()
    runs = await _last_runs(session, [source.id])
    return SourceOut.from_source(source, runs.get(source.id))


@router.get(
    "/sources/{source_id}/runs",
    response_model=list[CrawlRunOut],
    responses={404: {"description": "unknown source"}},
)
async def source_runs(source_id: uuid.UUID, session: SessionDep, _: AdminUser) -> list[CrawlRunOut]:
    await _require_source(session, source_id)
    stmt = (
        select(CrawlRun)
        .where(CrawlRun.source_id == source_id)
        .order_by(CrawlRun.started_at.desc(), CrawlRun.id.desc())
        .limit(RUNS_LIMIT)
    )
    return [CrawlRunOut.from_run(run) for run in (await session.execute(stmt)).scalars()]
