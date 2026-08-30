"""Tests for `python -m app.cli`.

Each command commits for real (see `app.cli._run`), so `cli_env` points
`DATABASE_URL` at the real test database for the duration of the test and
removes whatever rows the test created afterwards. Nothing here touches the
network or a real Telegram session: the failure paths below (unknown source,
unsupported url, missing Telegram credentials) all return before any adapter
does network I/O, and `TelethonClient.login_interactive` is exercised at the
client-wrapper level with its underlying Telethon client stubbed out.
"""

import os
from collections.abc import AsyncIterator
from pathlib import Path

import pytest
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession
from typer.testing import CliRunner

from app.core.settings import get_settings
from app.modules.identity.models import User
from app.modules.listings.models import Source

runner = CliRunner()


@pytest.fixture
async def cli_env(engine: AsyncEngine) -> AsyncIterator[None]:
    url = get_settings().test_database_url
    os.environ["DATABASE_URL"] = url
    get_settings.cache_clear()
    yield
    async with AsyncSession(engine) as session:
        await session.execute(delete(User).where(User.phone_e164.in_(["+998900000101"])))
        await session.execute(delete(Source).where(Source.name.in_(["@cli_test", "olx-cli"])))
        await session.commit()
    os.environ.pop("DATABASE_URL", None)
    get_settings.cache_clear()


def test_create_user_and_list(cli_env: None) -> None:
    from app.cli import app

    result = runner.invoke(
        app,
        [
            "create-user",
            "--phone",
            "+998900000101",
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
        app, ["create-user", "--phone", "+998900000101", "--name", "Aziz", "--password", "x"]
    )
    assert again.exit_code != 0 and "exists" in again.output


def test_add_and_list_sources(cli_env: None) -> None:
    from app.cli import app

    assert runner.invoke(app, ["add-source", "telegram", "@cli_test"]).exit_code == 0
    assert (
        runner.invoke(
            app,
            [
                "add-source",
                "olx",
                "https://www.olx.uz/nedvizhimost/kvartiry/arenda-dolgosrochnaya/tashkent/",
                "--name",
                "olx-cli",
                "--interval",
                "600",
            ],
        ).exit_code
        == 0
    )
    listed = runner.invoke(app, ["list-sources"])
    assert (
        listed.exit_code == 0
        and "@cli_test" in listed.output
        and "olx-cli" in listed.output
        and "600" in listed.output
    )
    dup = runner.invoke(app, ["add-source", "telegram", "@cli_test"])
    assert dup.exit_code != 0 and "exists" in dup.output


def test_reparse_reports_counts_for_unknown_source(cli_env: None) -> None:
    from app.cli import app

    result = runner.invoke(app, ["reparse", "--source", "does-not-exist"])
    assert result.exit_code != 0 and "no source" in result.output


def test_run_source_reports_missing_source(cli_env: None) -> None:
    """`run-source` must reject an unknown name before ever building a registry
    (which would otherwise construct real network-capable adapters)."""
    from app.cli import app

    result = runner.invoke(app, ["run-source", "does-not-exist"])
    assert result.exit_code != 0 and "no source" in result.output


def test_add_listing_rejects_unsupported_url(cli_env: None) -> None:
    """`ingest_url` raises `ValueError` for a host it doesn't recognise, before any
    adapter or the database is touched; the CLI must turn that into a clean error
    instead of an unhandled traceback."""
    from app.cli import app

    result = runner.invoke(app, ["add-listing", "--url", "https://example.com/flat"])
    assert result.exit_code != 0 and "unsupported url" in result.output


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
