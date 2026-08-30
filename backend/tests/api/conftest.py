from collections.abc import AsyncIterator
from pathlib import Path

import httpx
import pytest
from fastapi import FastAPI
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.app import create_app
from app.api.deps import get_session
from app.core.auth import create_token
from app.core.settings import Settings
from app.ingestion.manual import ManualAdapter
from app.ingestion.registry import AdapterRegistry
from app.modules.identity.models import User
from app.modules.identity.service import create_user


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    return Settings(
        _env_file=None,
        jwt_secret="test-secret",
        photo_dir=tmp_path / "photos",
        telegram_api_id=0,
        telegram_api_hash="",
    )


@pytest.fixture
def registry() -> AdapterRegistry:
    return AdapterRegistry({"manual": ManualAdapter()})


@pytest.fixture
async def api(
    db: AsyncSession, settings: Settings, registry: AdapterRegistry
) -> AsyncIterator[tuple[FastAPI, httpx.AsyncClient]]:
    app = create_app(settings, session_factory=lambda: db, registry=registry)

    async def override_session() -> AsyncIterator[AsyncSession]:
        yield db  # the test's savepoint session; never closed here

    app.dependency_overrides[get_session] = override_session
    async with app.router.lifespan_context(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            yield app, client


@pytest.fixture
async def client(api: tuple[FastAPI, httpx.AsyncClient]) -> httpx.AsyncClient:
    return api[1]


PASSWORD = "secret1"


@pytest.fixture
async def admin(db: AsyncSession) -> User:
    return await create_user(
        db, phone_e164="+998900000001", name="Admin", password=PASSWORD, role="admin"
    )


@pytest.fixture
async def agent(db: AsyncSession) -> User:
    return await create_user(db, phone_e164="+998900000002", name="Agent", password=PASSWORD)


def auth_headers(settings: Settings, user: User) -> dict[str, str]:
    token = create_token(settings, user_id=user.id, role=user.role, typ="access")
    return {"Authorization": f"Bearer {token}"}
