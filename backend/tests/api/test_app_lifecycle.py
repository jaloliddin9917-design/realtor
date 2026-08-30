"""Startup: the JWT secret guard, and disposing the engine when startup fails."""

from pathlib import Path

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import app as app_module
from app.core.settings import Settings
from app.ingestion.registry import AdapterRegistry

INSECURE_DEFAULT = "change-me"


class _FakeEngine:
    def __init__(self) -> None:
        self.disposed = False

    async def dispose(self) -> None:
        self.disposed = True


def test_insecure_jwt_secrets_are_recognised() -> None:
    """Empty, the shipped placeholder, and anything under 32 bytes are all insecure."""
    assert Settings.model_fields["jwt_secret"].default == INSECURE_DEFAULT
    for secret in (INSECURE_DEFAULT, "", "x" * 31):
        assert Settings(_env_file=None, jwt_secret=secret).jwt_secret_is_insecure is True
    assert Settings(_env_file=None, jwt_secret="x" * 32).jwt_secret_is_insecure is False


async def test_startup_refuses_an_insecure_jwt_secret(
    db: AsyncSession, settings: Settings, registry: AdapterRegistry
) -> None:
    settings.jwt_secret = INSECURE_DEFAULT
    app = app_module.create_app(settings, session_factory=lambda: db, registry=registry)

    with pytest.raises(RuntimeError, match="JWT_SECRET is insecure"):
        async with app.router.lifespan_context(app):
            pass


async def test_startup_allows_an_insecure_jwt_secret_when_the_flag_is_set(
    db: AsyncSession, settings: Settings, registry: AdapterRegistry
) -> None:
    settings.jwt_secret = INSECURE_DEFAULT
    settings.allow_insecure_jwt_secret = True
    app = app_module.create_app(settings, session_factory=lambda: db, registry=registry)

    async with app.router.lifespan_context(app):
        assert app.state.settings.jwt_secret == INSECURE_DEFAULT


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


async def test_engine_is_disposed_when_session_factory_creation_fails(
    monkeypatch: pytest.MonkeyPatch,
    settings: Settings,
    registry: AdapterRegistry,
) -> None:
    fake_engine = _FakeEngine()
    monkeypatch.setattr(app_module, "make_engine", lambda _url: fake_engine)

    def _boom(_engine: object) -> None:
        raise RuntimeError("boom")

    monkeypatch.setattr(app_module, "make_session_factory", _boom)

    app = app_module.create_app(settings, registry=registry)

    with pytest.raises(RuntimeError, match="boom"):
        async with app.router.lifespan_context(app):
            pass  # startup fails while building the session factory itself

    assert fake_engine.disposed is True
