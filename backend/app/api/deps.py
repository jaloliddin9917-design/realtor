"""Request-scoped dependencies: settings, DB session, registry, current user, admin gate."""

from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.problems import ApiError
from app.core.auth import AuthError, decode_token
from app.core.settings import Settings
from app.ingestion.registry import AdapterRegistry
from app.modules.dedupe.config import DedupeConfig
from app.modules.identity.models import User
from app.modules.identity.service import get_user

bearer = HTTPBearer(auto_error=False)


def get_settings_dep(request: Request) -> Settings:
    settings: Settings = request.app.state.settings
    return settings


async def get_session(request: Request) -> AsyncIterator[AsyncSession]:
    session: AsyncSession = request.app.state.session_factory()
    try:
        yield session
    finally:
        await session.close()


def get_registry(request: Request) -> AdapterRegistry:
    registry: AdapterRegistry = request.app.state.registry
    return registry


def get_dedupe_config(request: Request) -> DedupeConfig:
    cfg: DedupeConfig = request.app.state.dedupe_config
    return cfg


SettingsDep = Annotated[Settings, Depends(get_settings_dep)]
SessionDep = Annotated[AsyncSession, Depends(get_session)]
RegistryDep = Annotated[AdapterRegistry, Depends(get_registry)]
DedupeConfigDep = Annotated[DedupeConfig, Depends(get_dedupe_config)]


async def current_user(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
    session: SessionDep,
    settings: SettingsDep,
) -> User:
    if credentials is None:
        raise ApiError(401, "auth.missing_token", "missing bearer token")
    try:
        claims = decode_token(settings, credentials.credentials, expected_typ="access")
    except AuthError as exc:
        raise ApiError(401, exc.code, exc.detail) from exc
    user = await get_user(session, claims.user_id)
    if user is None or not user.active:
        raise ApiError(401, "auth.user_inactive", "user is inactive")
    return user


CurrentUser = Annotated[User, Depends(current_user)]


async def require_admin(user: CurrentUser) -> User:
    if user.role != "admin":
        raise ApiError(403, "auth.forbidden", "admin role required")
    return user


AdminUser = Annotated[User, Depends(require_admin)]
