"""The lifespan disposes the engine even when startup fails after it is created."""

from pathlib import Path

import pytest

from app.api import app as app_module
from app.core.settings import Settings
from app.ingestion.registry import AdapterRegistry


class _FakeEngine:
    def __init__(self) -> None:
        self.disposed = False

    async def dispose(self) -> None:
        self.disposed = True


async def test_engine_is_disposed_when_startup_fails_after_it_is_created(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    settings: Settings,
    registry: AdapterRegistry,
) -> None:
    fake_engine = _FakeEngine()
    monkeypatch.setattr(app_module, "make_engine", lambda _url: fake_engine)
    settings.dedupe_config_path = tmp_path / "missing.yaml"

    app = app_module.create_app(settings, registry=registry)

    with pytest.raises(FileNotFoundError):
        async with app.router.lifespan_context(app):
            pass  # startup fails (missing dedupe config) before this is ever reached

    assert fake_engine.disposed is True
