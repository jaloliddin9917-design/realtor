"""API models for sources, crawl runs and the FX banner."""

import uuid
from datetime import date as _date
from datetime import datetime
from decimal import Decimal
from typing import Any, Literal

from pydantic import BaseModel, Field

from app.modules.listings.models import CrawlRun, FxRate, Source


class CrawlRunOut(BaseModel):
    id: uuid.UUID
    started_at: datetime
    finished_at: datetime | None
    found: int
    new: int
    changed: int
    failed: int
    removed: int
    error: str | None

    @classmethod
    def from_run(cls, run: CrawlRun) -> "CrawlRunOut":
        return cls(
            id=run.id,
            started_at=run.started_at,
            finished_at=run.finished_at,
            found=run.found,
            new=run.new,
            changed=run.changed,
            failed=run.failed,
            removed=run.removed,
            error=run.error,
        )


class SourceOut(BaseModel):
    id: uuid.UUID
    kind: str
    name: str
    enabled: bool
    interval_seconds: int
    status: str
    last_run_at: datetime | None
    next_run_at: datetime | None
    paused_until: datetime | None
    consecutive_failures: int
    config: dict[str, Any]
    last_run: CrawlRunOut | None

    @classmethod
    def from_source(cls, source: Source, last_run: CrawlRun | None) -> "SourceOut":
        return cls(
            id=source.id,
            kind=source.kind,
            name=source.name,
            enabled=source.enabled,
            interval_seconds=source.interval_seconds,
            status=source.status,
            last_run_at=source.last_run_at,
            next_run_at=source.next_run_at,
            paused_until=source.paused_until,
            consecutive_failures=source.consecutive_failures,
            config=dict(source.config),
            last_run=CrawlRunOut.from_run(last_run) if last_run else None,
        )


class SourceCreateIn(BaseModel):
    kind: Literal["telegram"] = "telegram"
    peer: str = Field(min_length=2, max_length=120)
    name: str | None = Field(None, min_length=1, max_length=120)
    interval_seconds: int = Field(900, ge=60, le=86400)


class SourcePatchIn(BaseModel):
    enabled: bool


class FxOut(BaseModel):
    # `date` is aliased on import to `_date`: a plain `date` field here would shadow the
    # `date` *type* for mypy in the rest of this class body (e.g. `from_rate`'s `today`
    # parameter), since a class-body attribute declaration shadows same-named types for
    # later annotations in that class.
    date: _date
    usd_uzs: Decimal
    fetched_at: datetime
    stale: bool

    @classmethod
    def from_rate(cls, rate: FxRate, today: _date, stale_after_days: int) -> "FxOut":
        return cls(
            date=rate.date,
            usd_uzs=rate.usd_uzs,
            fetched_at=rate.fetched_at,
            stale=(today - rate.date).days > stale_after_days,
        )


class SourcesOut(BaseModel):
    items: list[SourceOut]
    fx: FxOut | None
