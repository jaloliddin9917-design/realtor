"""Tests for `python -m app.cli`.

Each command commits for real (see `app.cli._run`), so `cli_env` points
`DATABASE_URL` at the real test database for the duration of the test and
removes whatever rows the test created afterwards. Nothing here touches the
network or a real Telegram session: the failure paths below (unknown source,
unsupported url, missing Telegram credentials) all return before any adapter
does network I/O, and `TelethonClient.login_interactive` is exercised at the
client-wrapper level with its underlying Telethon client stubbed out.
"""

import asyncio
import os
from collections.abc import AsyncIterator
from datetime import UTC, date, datetime
from decimal import Decimal
from pathlib import Path

import httpx
import pytest
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession
from typer.testing import CliRunner

from app import cli as cli_module
from app.core.settings import get_settings
from app.ingestion.adapters.telegram import TelegramAdapter
from app.ingestion.adapters.telegram.client import TgMessage
from app.ingestion.registry import AdapterRegistry
from app.modules.identity.models import User
from app.modules.listings.models import FxRate, RawListing, Source
from tests.fakes import FakeTelegramClient

runner = CliRunner()

# Fixed literals `cli_env` creates and cleans up; kept in one place so the cleanup and
# the tests that use these names/phone can never drift out of sync.
CLI_TEST_PHONE = "+998900000101"
CLI_TEST_TELEGRAM_SOURCE = "@cli_test"
CLI_TEST_OLX_SOURCE = "olx-cli"
CLI_TEST_REPARSE_SOURCE = "cli-reparse-test"
CLI_TEST_OLX_DEFAULT_NAME = "arenda-dolgosrochnaya-tashkent"
FX_TEST_DATE = date(2020, 1, 1)  # sentinel row refresh-fx test writes + cleans up
CLI_TEST_SOURCE_NAMES = [
    CLI_TEST_TELEGRAM_SOURCE,
    CLI_TEST_OLX_SOURCE,
    CLI_TEST_REPARSE_SOURCE,
    CLI_TEST_OLX_DEFAULT_NAME,
]


async def _delete_cli_test_rows(engine: AsyncEngine) -> None:
    async with AsyncSession(engine) as session:
        await session.execute(delete(User).where(User.phone_e164 == CLI_TEST_PHONE))
        await session.execute(delete(Source).where(Source.name.in_(CLI_TEST_SOURCE_NAMES)))
        await session.execute(delete(FxRate).where(FxRate.date == FX_TEST_DATE))
        await session.commit()


@pytest.fixture
async def cli_env(engine: AsyncEngine) -> AsyncIterator[None]:
    url = get_settings().test_database_url
    os.environ["DATABASE_URL"] = url
    get_settings.cache_clear()
    # Clean up before too: a previous run that was interrupted mid-test (Ctrl-C, a
    # crash) can leave these fixed rows committed, which would otherwise make the next
    # run's "already exists" checks fail for the wrong reason.
    await _delete_cli_test_rows(engine)
    yield
    await _delete_cli_test_rows(engine)
    os.environ.pop("DATABASE_URL", None)
    get_settings.cache_clear()


def test_create_user_and_list(cli_env: None) -> None:
    from app.cli import app

    result = runner.invoke(
        app,
        [
            "create-user",
            "--phone",
            CLI_TEST_PHONE,
            "--name",
            "Aziz",
            "--password",
            "s3cret",
            "--role",
            "agent",
        ],
    )
    assert result.exit_code == 0, result.output
    assert "Aziz" in result.output and "agent" in result.output
    again = runner.invoke(
        app, ["create-user", "--phone", CLI_TEST_PHONE, "--name", "Aziz", "--password", "x"]
    )
    assert again.exit_code != 0 and "exists" in again.output


def test_add_and_list_sources(cli_env: None) -> None:
    from app.cli import app

    assert runner.invoke(app, ["add-source", "telegram", CLI_TEST_TELEGRAM_SOURCE]).exit_code == 0
    assert (
        runner.invoke(
            app,
            [
                "add-source",
                "olx",
                "https://www.olx.uz/nedvizhimost/kvartiry/arenda-dolgosrochnaya/tashkent/",
                "--name",
                CLI_TEST_OLX_SOURCE,
                "--interval",
                "600",
            ],
        ).exit_code
        == 0
    )
    listed = runner.invoke(app, ["list-sources"])
    assert (
        listed.exit_code == 0
        and CLI_TEST_TELEGRAM_SOURCE in listed.output
        and CLI_TEST_OLX_SOURCE in listed.output
        and "600" in listed.output
    )
    dup = runner.invoke(app, ["add-source", "telegram", CLI_TEST_TELEGRAM_SOURCE])
    assert dup.exit_code != 0 and "exists" in dup.output


def test_add_source_olx_default_name_comes_from_url(cli_env: None) -> None:
    """With no `--name`, an OLX source's default name is the last two non-empty path
    segments of its URL, joined by `-` — not the fixed literal "olx" every OLX source
    used to collide on."""
    from app.cli import app

    result = runner.invoke(
        app,
        [
            "add-source",
            "olx",
            "https://www.olx.uz/nedvizhimost/kvartiry/arenda-dolgosrochnaya/tashkent/",
        ],
    )
    assert result.exit_code == 0, result.output
    assert CLI_TEST_OLX_DEFAULT_NAME in result.output
    listed = runner.invoke(app, ["list-sources"])
    assert listed.exit_code == 0 and CLI_TEST_OLX_DEFAULT_NAME in listed.output


def test_reparse_reports_counts_for_unknown_source(cli_env: None) -> None:
    from app.cli import app

    result = runner.invoke(app, ["reparse", "--source", "does-not-exist"])
    assert result.exit_code != 0 and "no source" in result.output


def test_reparse_limit_zero_reparses_nothing(cli_env: None) -> None:
    """`--limit 0` must limit to zero rows, not mean "no limit" — the old
    `stmt.limit(limit) if limit else stmt` treated the int `0` as falsy.

    The raw listing's payload is deliberately empty: `rebuild_payload` would raise on
    it if the (buggy) old code tried to reparse the row, keeping this test's failure
    mode obvious either way and never touching `properties`/`listings`.

    A plain `def` (not `async def`), like every other test here that calls
    `runner.invoke` on a command backed by `app.cli._run`: that helper calls
    `asyncio.run(...)` itself, which raises if the test function is already running
    inside pytest-asyncio's own event loop. The row setup below builds its own
    throwaway engine inside its own `asyncio.run` (mirroring `_run` itself) rather
    than reusing the session-scoped `engine` fixture, whose pooled connections are
    bound to a different event loop than a fresh `asyncio.run` call spins up.
    """
    from app.cli import app
    from app.core.db import make_engine

    async def seed() -> None:
        engine = make_engine(get_settings().database_url)
        try:
            async with AsyncSession(engine) as session:
                source = Source(
                    kind="manual", name=CLI_TEST_REPARSE_SOURCE, config={}, enabled=False
                )
                session.add(source)
                await session.flush()
                session.add(
                    RawListing(
                        source_id=source.id,
                        external_id="reparse-1",
                        url=None,
                        payload={},
                        content_hash="h" * 8,
                        fetched_at=datetime.now(UTC),
                    )
                )
                await session.commit()
        finally:
            await engine.dispose()

    asyncio.run(seed())

    result = runner.invoke(app, ["reparse", "--source", CLI_TEST_REPARSE_SOURCE, "--limit", "0"])
    assert result.exit_code == 0, result.output
    assert "reparsed 0 listings, 0 failed" in result.output


def test_run_source_reports_missing_source(cli_env: None) -> None:
    """`run-source` must reject an unknown name before ever building a registry
    (which would otherwise construct real network-capable adapters)."""
    from app.cli import app

    result = runner.invoke(app, ["run-source", "does-not-exist"])
    assert result.exit_code != 0 and "no source" in result.output


def test_add_listing_rejects_unsupported_url(cli_env: None) -> None:
    """`ingest_url` raises `InvalidListingUrl` for a host it doesn't recognise, before
    any adapter or the database is touched; the CLI must turn that into a clean error
    instead of an unhandled traceback."""
    from app.cli import app

    result = runner.invoke(app, ["add-listing", "--url", "https://example.com/flat"])
    assert result.exit_code != 0 and "unsupported url" in result.output


def test_add_listing_rejects_telegram_link_without_message_id(
    cli_env: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A `t.me` URL passes the `HOST_KINDS` host precheck (the host is recognised), but
    the Telegram adapter's own `_TME` regex rejects a channel link with no message id —
    that `InvalidListingUrl` from `fetch_by_url` must become a clean CLI error, not an
    unhandled traceback. The fake client's every method raises `AssertionError` if
    called, proving the regex check happens before any client call.

    The message is printed as-is: prefixing it with "unsupported url:" doubled up
    ("unsupported url: not a t.me message link: ...") and blamed the wrong thing — the
    host *is* supported, the link just has no message id. The registry is closed on the
    way out, so the CLI never leaves an adapter's connection behind.
    """
    client = FakeTelegramClient()
    registry = AdapterRegistry({"telegram": TelegramAdapter(client)})
    monkeypatch.setattr(cli_module, "build_registry", lambda settings, **kw: registry)

    result = runner.invoke(cli_module.app, ["add-listing", "--url", "https://t.me/somechannel"])
    assert result.exit_code == 1
    assert result.output.strip() == "error: not a t.me message link: https://t.me/somechannel"
    assert client.disconnected


class _ChannelWithNoSuchMessage(FakeTelegramClient):
    """Like `FakeTelegramClient`, but `connect`/`is_user_authorized`/`resolve_peer`
    succeed and `get_messages` reports no such message — enough to drive `fetch_by_url`
    into `ListingGone` without ever touching a real Telegram session."""

    async def connect(self) -> None:
        pass

    async def is_user_authorized(self) -> bool:
        return True

    async def resolve_peer(self, peer: str | int) -> tuple[int, str | None]:
        return (-1001234, "somechannel")

    async def get_messages(self, chat_id: int, ids: list[int]) -> list[TgMessage]:
        return []


def test_add_listing_reports_a_deleted_telegram_message_as_gone(
    cli_env: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A well-formed `t.me/<channel>/<id>` link whose message has been deleted raises
    `ListingGone`, not a `ValueError` — it needs its own handler in `add_listing`, or
    this prints an unhandled traceback instead of a clean one-line error."""
    client = _ChannelWithNoSuchMessage()
    registry = AdapterRegistry({"telegram": TelegramAdapter(client)})
    monkeypatch.setattr(cli_module, "build_registry", lambda settings, **kw: registry)

    result = runner.invoke(cli_module.app, ["add-listing", "--url", "https://t.me/somechannel/42"])
    assert result.exit_code == 1
    assert result.output.strip() == "error: message not found: https://t.me/somechannel/42"
    assert client.disconnected


def test_run_source_reports_an_adapter_that_cannot_be_built(
    cli_env: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A Telegram source with no API credentials makes `registry.for_source` raise the
    lazy factory's `ValueError`; `run-source` must report it, not traceback."""
    from app.cli import app

    assert runner.invoke(app, ["add-source", "telegram", CLI_TEST_TELEGRAM_SOURCE]).exit_code == 0
    monkeypatch.setenv("TELEGRAM_API_ID", "0")
    monkeypatch.setenv("TELEGRAM_API_HASH", "")
    get_settings.cache_clear()
    try:
        result = runner.invoke(app, ["run-source", CLI_TEST_TELEGRAM_SOURCE])
    finally:
        get_settings.cache_clear()
    assert result.exit_code == 1
    assert f"cannot build adapter for source {CLI_TEST_TELEGRAM_SOURCE}" in result.output
    assert "TELEGRAM_API_ID" in result.output
    assert not isinstance(result.exception, ValueError)


def test_reparse_reports_an_adapter_that_cannot_be_built(
    cli_env: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Same for `reparse`, which builds the adapter only for `rebuild_payload`."""
    from app.cli import app

    assert runner.invoke(app, ["add-source", "telegram", CLI_TEST_TELEGRAM_SOURCE]).exit_code == 0
    monkeypatch.setenv("TELEGRAM_API_ID", "0")
    monkeypatch.setenv("TELEGRAM_API_HASH", "")
    get_settings.cache_clear()
    try:
        result = runner.invoke(app, ["reparse", "--source", CLI_TEST_TELEGRAM_SOURCE])
    finally:
        get_settings.cache_clear()
    assert result.exit_code == 1
    assert f"cannot build adapter for source {CLI_TEST_TELEGRAM_SOURCE}" in result.output
    assert not isinstance(result.exception, ValueError)


def test_telegram_login_requires_api_credentials(monkeypatch: pytest.MonkeyPatch) -> None:
    """Without `TELEGRAM_API_ID`/`TELEGRAM_API_HASH`, `telegram-login` must refuse
    before constructing a client — it never reaches the database either."""
    from app.cli import app

    monkeypatch.setenv("TELEGRAM_API_ID", "0")
    monkeypatch.setenv("TELEGRAM_API_HASH", "")
    get_settings.cache_clear()
    try:
        result = runner.invoke(app, ["telegram-login"])
        assert result.exit_code != 0
        assert "TELEGRAM_API_ID" in result.output
    finally:
        get_settings.cache_clear()


async def test_telethon_client_login_interactive_calls_client_start(tmp_path: Path) -> None:
    from app.ingestion.adapters.telegram.client import TelethonClient

    client = TelethonClient(str(tmp_path / "cli-test-session"), 1, "hash")
    started = False

    async def fake_start() -> None:
        nonlocal started
        started = True

    client._client.start = fake_start  # type: ignore[method-assign]
    await client.login_interactive()
    assert started


def test_refresh_fx(cli_env: None, monkeypatch: pytest.MonkeyPatch) -> None:
    from app.cli import app

    async def fake_fetch(_client: httpx.AsyncClient) -> tuple[date, Decimal]:
        return FX_TEST_DATE, Decimal("11800.00")

    # patch the network call the command reaches through refresh_rate — no CBU request
    monkeypatch.setattr("app.modules.listings.fx.fetch_cbu_rate", fake_fetch)
    result = runner.invoke(app, ["refresh-fx"])
    assert result.exit_code == 0, result.output
    assert "11800.00" in result.output
