"""Operator commands: python -m app.cli <command>."""

import asyncio
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from typing import Any
from urllib.parse import urlsplit

import typer
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import make_engine, make_session_factory
from app.core.logging import configure_logging
from app.core.settings import get_settings
from app.ingestion.adapters.base import AdapterBackoff, ListingGone, LoginRequired, SourceAdapter
from app.ingestion.adapters.telegram.client import make_client
from app.ingestion.manual import HOST_KINDS, ingest_url
from app.ingestion.pipeline import process_raw, run_source
from app.ingestion.registry import AdapterRegistry, build_registry
from app.modules.dedupe.config import load_config
from app.modules.identity.models import User
from app.modules.identity.service import create_user as create_user_service
from app.modules.listings.models import RawListing, Source

app = typer.Typer(help="Realtor CRM operator commands", no_args_is_help=True)


def _run(fn: Callable[[AsyncSession], Awaitable[Any]]) -> Any:
    """Run `fn` against a fresh engine/session, built from the current settings.

    Reads `get_settings()` at call time (not at import time) so tests can point
    `DATABASE_URL` at the test database and `get_settings.cache_clear()` before
    invoking a command.
    """
    settings = get_settings()
    configure_logging(settings.log_level)

    async def go() -> Any:
        engine = make_engine(settings.database_url)
        factory = make_session_factory(engine)
        try:
            async with factory() as session:
                result = await fn(session)
                await session.commit()
                return result
        finally:
            await engine.dispose()

    return asyncio.run(go())


async def _require_source(session: AsyncSession, name: str) -> Source:
    """Look up a source by name, or print an error and exit 1.

    Shared by `run-source` and `reparse`, both of which take a source name on the
    command line and must fail the same way when it doesn't exist.
    """
    source = (await session.execute(select(Source).where(Source.name == name))).scalar_one_or_none()
    if source is None:
        typer.echo(f"no source named {name}", err=True)
        raise typer.Exit(code=1)
    return source


def _require_adapter(registry: AdapterRegistry, source: Source) -> SourceAdapter:
    """Build the adapter for `source`, or print an error and exit 1.

    `for_source` raises `ValueError` both for an unregistered kind and when a lazy
    factory cannot build (a Telegram source with no TELEGRAM_API_ID/TELEGRAM_API_HASH —
    the common case for an OLX-only deployment). Either way the operator wants the
    reason on one line, not a traceback.
    """
    try:
        return registry.for_source(source)
    except ValueError as exc:
        typer.echo(f"cannot build adapter for source {source.name}: {exc}", err=True)
        raise typer.Exit(code=1) from exc


def _require_adapter_of_kind(registry: AdapterRegistry, kind: str) -> SourceAdapter:
    """Same, for a kind resolved from a URL host rather than a stored source row."""
    try:
        return registry.get(kind)
    except (KeyError, ValueError) as exc:
        typer.echo(f"cannot build {kind} adapter: {exc}", err=True)
        raise typer.Exit(code=1) from exc


@app.command("create-user")
def create_user(
    phone: str = typer.Option(...),
    name: str = typer.Option(...),
    password: str = typer.Option(..., prompt=True, hide_input=True),
    role: str = typer.Option("agent"),
) -> None:
    if role not in ("admin", "agent"):
        raise typer.BadParameter("role must be admin or agent")

    async def go(session: AsyncSession) -> None:
        if (
            await session.execute(select(User).where(User.phone_e164 == phone))
        ).scalar_one_or_none():
            typer.echo(f"user {phone} already exists", err=True)
            raise typer.Exit(code=1)
        await create_user_service(
            session, phone_e164=phone, name=name, password=password, role=role
        )
        typer.echo(f"created {name} ({role}) {phone}")

    _run(go)


def _default_olx_name(url: str) -> str:
    """The last two non-empty path segments, joined by `-`; `olx` if the path is empty.

    E.g. `https://www.olx.uz/nedvizhimost/kvartiry/arenda-dolgosrochnaya/tashkent/` ->
    `arenda-dolgosrochnaya-tashkent`.
    """
    parts = [p for p in urlsplit(url).path.split("/") if p]
    return "-".join(parts[-2:]) if parts else "olx"


@app.command("add-source")
def add_source(
    kind: str = typer.Argument(..., help="telegram | olx"),
    target: str = typer.Argument(..., help="@peer or category url"),
    name: str | None = typer.Option(None),
    interval: int = typer.Option(900),
) -> None:
    if kind not in ("telegram", "olx"):
        raise typer.BadParameter("kind must be telegram or olx")
    config = {"peer": target} if kind == "telegram" else {"url": target}
    source_name = name or (target if kind == "telegram" else _default_olx_name(target))

    async def go(session: AsyncSession) -> None:
        if (
            await session.execute(select(Source).where(Source.name == source_name))
        ).scalar_one_or_none():
            typer.echo(f"source {source_name} already exists", err=True)
            raise typer.Exit(code=1)
        session.add(
            Source(
                kind=kind, name=source_name, config=config, interval_seconds=interval, enabled=True
            )
        )
        try:
            await session.commit()
        except IntegrityError:
            # Backstop for a race between two concurrent `add-source` calls: the
            # app-level check above raced and lost against another insert of the same
            # name between its SELECT and this commit. `sources.name` has a unique
            # constraint (`uq_sources_name`) for exactly this.
            await session.rollback()
            typer.echo(f"source {source_name} already exists", err=True)
            raise typer.Exit(code=1) from None
        typer.echo(f"added {kind} source {source_name} (every {interval}s)")

    _run(go)


@app.command("list-sources")
def list_sources() -> None:
    async def go(session: AsyncSession) -> None:
        rows = (await session.execute(select(Source).order_by(Source.created_at))).scalars().all()
        typer.echo(
            f"{'name':24} {'kind':9} {'on':3} {'status':15} {'interval':8} "
            f"{'last run':20} {'next run':20} fails"
        )
        for s in rows:
            last_run = str(s.last_run_at)[:19]
            next_run = str(s.next_run_at)[:19]
            typer.echo(
                f"{s.name:24} {s.kind:9} {'yes' if s.enabled else 'no':3} {s.status:15} "
                f"{s.interval_seconds:<8} {last_run:20} {next_run:20} {s.consecutive_failures}"
            )

    _run(go)


@app.command("run-source")
def run_source_cmd(name: str) -> None:
    async def go(session: AsyncSession) -> None:
        source = await _require_source(session, name)
        settings = get_settings()
        registry = build_registry(settings)
        try:
            adapter = _require_adapter(registry, source)
            try:
                run = await run_source(
                    session,
                    adapter,
                    source,
                    cfg=load_config(settings.dedupe_config_path),
                    photo_dir=settings.photo_dir,
                    now=datetime.now(UTC),
                )
            finally:
                await session.commit()  # bookkeeping survives even when run_source raised
        finally:
            await registry.aclose()
        typer.echo(
            f"found={run.found} new={run.new} changed={run.changed} "
            f"failed={run.failed} removed={run.removed} error={run.error}"
        )

    _run(go)


@app.command("reparse")
def reparse(
    source: str = typer.Option(..., "--source"), limit: int | None = typer.Option(None)
) -> None:
    """Reparse a source's already-stored raw listings without touching the network.

    `process_raw` accepts `adapter: SourceAdapter | None`; passing `None` here (rather
    than the registry's real adapter) skips the photo-download branch entirely, which
    is exactly what a network-free reparse needs — only `adapter.rebuild_payload`
    (documented as never touching the network) is used, to turn the stored raw payload
    back into a `RawPayload`.

    `seen=False` for the same reason: a reparse observes nothing at the source, so it
    must not refresh `last_seen_at`/`miss_count`/`source_removed`/`removed_at` (spec
    §3.5 resurrection is for a listing genuinely *seen again*). Without it, one reparse
    would un-remove every delisted listing of the source and reset its age-out clock.
    """

    async def go(session: AsyncSession) -> None:
        src = await _require_source(session, source)
        settings = get_settings()
        registry = build_registry(settings)
        try:
            adapter = _require_adapter(registry, src)
            cfg = load_config(settings.dedupe_config_path)
            stmt = (
                select(RawListing)
                .where(RawListing.source_id == src.id)
                .order_by(RawListing.fetched_at)
            )
            raws = (
                (await session.execute(stmt.limit(limit) if limit is not None else stmt))
                .scalars()
                .all()
            )
            done = failed = 0
            for raw in raws:
                try:
                    async with session.begin_nested():
                        payload = await adapter.rebuild_payload(raw)
                        await process_raw(
                            session,
                            src,
                            raw,
                            payload,
                            created=False,
                            changed=True,
                            adapter=None,
                            cfg=cfg,
                            photo_dir=settings.photo_dir,
                            now=datetime.now(UTC),
                            max_photos=10,
                            seen=False,
                        )
                        done += 1
                except Exception as exc:  # noqa: BLE001 — one bad row must not stop the batch
                    failed += 1
                    raw.parse_error = f"{type(exc).__name__}: {exc}"[:1000]
        finally:
            await registry.aclose()
        typer.echo(f"reparsed {done} listings, {failed} failed")

    _run(go)


@app.command("telegram-login")
def telegram_login() -> None:
    settings = get_settings()
    if not settings.telegram_api_id or not settings.telegram_api_hash:
        typer.echo(
            "set TELEGRAM_API_ID and TELEGRAM_API_HASH (my.telegram.org) in backend/.env first",
            err=True,
        )
        raise typer.Exit(code=1)

    async def go() -> None:
        client = make_client(settings)
        try:
            await client.login_interactive()
            typer.echo(f"session saved to {settings.telegram_session_path}")
        finally:
            # `start()` leaves a live MTProto connection behind; without disconnecting,
            # the command hangs on its reader task instead of returning to the shell.
            await client.disconnect()

    asyncio.run(go())


@app.command("add-listing")
def add_listing(url: str = typer.Option(..., "--url")) -> None:
    # Rejecting an unrecognised host here, before `_run`/`build_registry` ever runs,
    # means a bad URL never pays for constructing a Telegram client (which needs
    # TELEGRAM_API_ID/TELEGRAM_API_HASH configured) or an OLX HTTP client just to be
    # told "no" — `ingest_url` would otherwise raise this same ValueError, but only
    # after `build_registry` already ran.
    kind = HOST_KINDS.get(urlsplit(url).netloc.lower())
    if kind is None:
        typer.echo(f"error: unsupported url: {url}", err=True)
        raise typer.Exit(code=1)

    async def go(session: AsyncSession) -> None:
        settings = get_settings()
        registry = build_registry(settings)
        try:
            # Resolve the adapter up front so a credentials problem is reported as one
            # ("cannot build telegram adapter: ..."), not as a URL problem. `ingest_url`
            # then re-reads the same cached instance from the registry.
            _require_adapter_of_kind(registry, kind)
            try:
                result = await ingest_url(
                    session,
                    url,
                    registry,
                    cfg=load_config(settings.dedupe_config_path),
                    photo_dir=settings.photo_dir,
                    now=datetime.now(UTC),
                )
            except (ListingGone, AdapterBackoff, LoginRequired) as e:
                # A recognised host and a well-formed link, but the adapter cannot serve
                # it right now: the listing is gone, the source is asking us to back off,
                # or the Telegram session needs a human to log in again. None of these
                # three is a `ValueError`, so they need their own clause — same clean
                # one-line report as the branch below, not a traceback.
                typer.echo(f"error: {e}", err=True)
                raise typer.Exit(code=1) from e
            except ValueError as e:
                # The host precheck above only rejects an unrecognised host; a recognised
                # one can still fail deeper, e.g. the Telegram adapter's `fetch_by_url`
                # raises `InvalidListingUrl` for a `t.me` channel link with no message id.
                # Printed verbatim: prefixing it with "unsupported url:" doubled the
                # phrase and named the wrong culprit.
                typer.echo(f"error: {e}", err=True)
                raise typer.Exit(code=1) from e
        finally:
            await registry.aclose()
        typer.echo(
            f"property {result.property.id} ({result.decision}); listing {result.listing.id}"
        )

    _run(go)


if __name__ == "__main__":
    app()
