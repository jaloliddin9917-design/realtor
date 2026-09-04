"""FastAPI application factory. Everything request-scoped hangs off `app.state`."""

from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.problems import PROBLEM_401, PROBLEM_403, PROBLEM_500, install_problem_handlers
from app.api.routers import (
    auth,
    availability,
    dashboard,
    duplicates,
    health,
    listings,
    meta,
    outreach,
    properties,
    sources,
    users,
)
from app.core.db import make_engine, make_session_factory
from app.core.settings import API_PREFIX, PHOTO_URL_PREFIX, Settings, get_settings
from app.ingestion.registry import AdapterRegistry, build_registry
from app.modules import models  # noqa: F401
from app.modules import (
    models as _models,  # noqa: F401  (registers every ORM model — complete metadata)
)
from app.modules.dedupe.config import load_config

INSECURE_JWT_SECRET = (
    "JWT_SECRET is insecure: set a random secret of at least 32 bytes "
    "(python -c 'import secrets;print(secrets.token_urlsafe(48))') "
    "or ALLOW_INSECURE_JWT_SECRET=true for local development"
)


def create_app(
    settings: Settings | None = None,
    *,
    session_factory: Callable[[], AsyncSession] | None = None,
    registry: AdapterRegistry | None = None,
) -> FastAPI:
    cfg = settings or get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        engine = None
        active_registry: AdapterRegistry | None = None
        try:
            # Checked at startup, not in `create_app`: building the app to print the
            # OpenAPI schema (`python -m app.api openapi`, `tests/api/test_openapi.py`)
            # needs no secret at all, and must not require one.
            if cfg.jwt_secret_is_insecure and not cfg.allow_insecure_jwt_secret:
                raise RuntimeError(INSECURE_JWT_SECRET)
            if session_factory is None:
                engine = make_engine(cfg.database_url)
                app.state.session_factory = make_session_factory(engine)
            else:
                app.state.session_factory = session_factory
            active_registry = registry or build_registry(cfg)
            app.state.registry = active_registry
            app.state.dedupe_config = load_config(cfg.dedupe_config_path)
            cfg.photo_dir.mkdir(parents=True, exist_ok=True)
            yield
        finally:
            if active_registry is not None:
                await active_registry.aclose()
            if engine is not None:
                await engine.dispose()

    app = FastAPI(
        title="realtor-app API",
        version="0.1.0",
        lifespan=lifespan,
        openapi_url=f"{API_PREFIX}/openapi.json",
        docs_url=f"{API_PREFIX}/docs",
        redoc_url=None,
    )
    app.state.settings = cfg
    app.add_middleware(
        CORSMiddleware,
        allow_origins=cfg.cors_origin_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    install_problem_handlers(app)
    # health is open; the auth router's login/refresh document their own 401 and `/me`
    # declares one on the route, so only the fully authenticated routers get PROBLEM_401
    # here. 500 can happen on any route (the catch-all handler), so every router gets
    # PROBLEM_500, health included.
    app.include_router(health.router, prefix=API_PREFIX, responses=PROBLEM_500)
    app.include_router(auth.router, prefix=API_PREFIX, responses=PROBLEM_500)
    for router in (
        meta.router,
        properties.router,
        listings.router,
        availability.router,
        dashboard.router,
        duplicates.router,
        outreach.router,
    ):
        app.include_router(router, prefix=API_PREFIX, responses={**PROBLEM_401, **PROBLEM_500})
    for router in (sources.router, users.router):
        app.include_router(
            router,
            prefix=API_PREFIX,
            responses={**PROBLEM_401, **PROBLEM_403, **PROBLEM_500},
        )
    # photos are keyed <listing uuid>/<position>.jpg — unguessable, so no auth in M0
    app.mount(
        PHOTO_URL_PREFIX,
        StaticFiles(directory=str(cfg.photo_dir), check_dir=False),
        name="photos",
    )
    return app
