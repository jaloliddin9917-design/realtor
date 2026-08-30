"""Tests for `app.ingestion.registry`: adapter lookup and settings-driven construction.

None of these touch the network or the database: `build_registry` itself never does
(see the assertions below), so every test here is a plain, synchronous unit test.
"""

from collections.abc import AsyncIterator
from datetime import datetime

import pytest

from app.core.settings import Settings
from app.ingestion.adapters.olx import OlxAdapter
from app.ingestion.adapters.telegram import TelegramAdapter
from app.ingestion.adapters.telegram.client import TgMessage
from app.ingestion.manual import ManualAdapter
from app.ingestion.registry import AdapterRegistry, build_registry
from app.modules.listings.models import Source


class FakeTelegramClient:
    """A `TelegramClientLike` double that fails loudly if `build_registry` ever calls it.

    `build_registry` only stores the client on `TelegramAdapter`; construction itself
    must never touch the network, so every method here raises if actually invoked.
    """

    async def connect(self) -> None:
        raise AssertionError("network touched during registry construction")

    async def is_user_authorized(self) -> bool:
        raise AssertionError("network touched during registry construction")

    async def resolve_peer(self, peer: str | int) -> tuple[int, str | None]:
        raise AssertionError("network touched during registry construction")

    async def iter_messages(
        self,
        chat_id: int,
        *,
        min_id: int = 0,
        offset_date: datetime | None = None,
        reverse: bool = False,
        limit: int | None = None,
    ) -> AsyncIterator[TgMessage]:
        raise AssertionError("network touched during registry construction")
        yield  # pragma: no cover — never reached; keeps this an async generator

    async def get_messages(self, chat_id: int, ids: list[int]) -> list[TgMessage]:
        raise AssertionError("network touched during registry construction")

    async def download_photo(self, chat_id: int, message_id: int) -> bytes:
        raise AssertionError("network touched during registry construction")


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
    settings = Settings(_env_file=None, olx_request_interval=1.5, olx_max_pages=7)
    registry = build_registry(settings, telegram_client=FakeTelegramClient())
    assert registry.kinds == ["manual", "olx", "telegram"]
    olx = registry.get("olx")
    assert isinstance(olx, OlxAdapter)
    assert olx.limiter.min_interval == settings.olx_request_interval
    assert olx.max_pages == settings.olx_max_pages
    assert isinstance(registry.get("telegram"), TelegramAdapter)
    assert isinstance(registry.get("manual"), ManualAdapter)
