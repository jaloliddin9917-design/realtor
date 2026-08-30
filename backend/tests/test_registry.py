"""Tests for `app.ingestion.registry`: adapter lookup and settings-driven construction.

None of these touch the network or the database: `build_registry` itself never does
(see the assertions below), so every test here is a plain, synchronous unit test.
"""

import pytest

from app.core.settings import Settings
from app.ingestion.adapters.olx import OlxAdapter
from app.ingestion.adapters.telegram import TelegramAdapter
from app.ingestion.manual import ManualAdapter
from app.ingestion.registry import AdapterRegistry, build_registry
from app.modules.listings.models import Source
from tests.fakes import FakeTelegramClient


def test_get_raises_key_error_for_unknown_kind() -> None:
    registry = AdapterRegistry({"manual": ManualAdapter()})
    with pytest.raises(KeyError):
        registry.get("olx")


def test_kinds_lists_the_registered_kinds_sorted() -> None:
    registry = AdapterRegistry(
        {"telegram": ManualAdapter(), "olx": ManualAdapter(), "manual": ManualAdapter()}
    )
    assert registry.kinds == ["manual", "olx", "telegram"]


def test_for_source_returns_the_adapter_registered_under_the_sources_kind() -> None:
    manual = ManualAdapter()
    registry = AdapterRegistry({"manual": manual})
    source = Source(kind="manual", name="manual", config={}, enabled=False)
    assert registry.for_source(source) is manual


def test_build_registry_wires_adapters_from_settings_without_touching_network_or_db() -> None:
    settings = Settings(
        _env_file=None, olx_request_interval=1.5, olx_max_pages=7, olx_photo_interval=0.25
    )
    registry = build_registry(settings, telegram_client=FakeTelegramClient())
    assert registry.kinds == ["manual", "olx", "telegram"]
    olx = registry.get("olx")
    assert isinstance(olx, OlxAdapter)
    assert olx.limiter.min_interval == settings.olx_request_interval
    assert olx.max_pages == settings.olx_max_pages
    # photos come from the CDN, on their own (much faster) budget — not the page one
    assert olx.photo_limiter is not olx.limiter
    assert olx.photo_limiter.min_interval == settings.olx_photo_interval
    assert isinstance(registry.get("telegram"), TelegramAdapter)
    assert isinstance(registry.get("manual"), ManualAdapter)


async def test_aclose_closes_built_adapters_and_never_builds_a_deferred_one() -> None:
    """The worker and the CLI own the registry's lifetime: closing it must release the
    OLX HTTP client and the Telegram connection. It must not *build* an adapter to close
    it — asking a lazy Telegram factory for a client at shutdown could raise (missing
    credentials) instead of shutting down."""
    closed: list[str] = []

    class Closes(ManualAdapter):
        async def aclose(self) -> None:
            closed.append("built")

    def never() -> ManualAdapter:
        raise AssertionError("aclose must not build a deferred adapter")

    registry = AdapterRegistry(
        {"olx": Closes(), "manual": ManualAdapter()},  # ManualAdapter has no aclose at all
        factories={"telegram": never},
    )
    await registry.aclose()
    assert closed == ["built"]


def test_build_registry_defers_telegram_construction_until_first_use() -> None:
    """No `telegram_client` injected and no TELEGRAM_API_ID/TELEGRAM_API_HASH configured
    must not stop an OLX-only deployment: `build_registry` itself must never call
    `make_client` (which would raise) — only actually asking for the Telegram adapter
    should fail."""
    settings = Settings(_env_file=None, telegram_api_id=0, telegram_api_hash="")
    registry = build_registry(settings)
    assert isinstance(registry.get("olx"), OlxAdapter)
    assert "telegram" in registry.kinds
    with pytest.raises(ValueError, match="credentials are not configured"):
        registry.get("telegram")


def test_registry_builds_a_factory_only_once_and_caches_the_result() -> None:
    calls = 0

    def factory() -> ManualAdapter:
        nonlocal calls
        calls += 1
        return ManualAdapter()

    registry = AdapterRegistry({}, factories={"telegram": factory})
    first = registry.get("telegram")
    second = registry.get("telegram")
    assert first is second
    assert calls == 1
