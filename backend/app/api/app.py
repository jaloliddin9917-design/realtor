"""FastAPI application factory. Everything request-scoped hangs off `app.state`."""

from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.problems import install_problem_handlers
from app.api.routers import auth, health, listings, properties, sources
from app.core.db import make_engine, make_session_factory
from app.core.settings import Settings, get_settings
from app.ingestion.registry import AdapterRegistry, build_registry
from app.modules.dedupe.config import load_config

API_PREFIX = "/api/v1"


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
        if session_factory is None:
            engine = make_engine(cfg.database_url)
            app.state.session_factory = make_session_factory(engine)
        else:
            app.state.session_factory = session_factory
        app.state.registry = registry or build_registry(cfg)
        app.state.dedupe_config = load_config(cfg.dedupe_config_path)
        cfg.photo_dir.mkdir(parents=True, exist_ok=True)
        try:
            yield
        finally:
            await app.state.registry.aclose()
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
    for router in (health.router, auth.router, properties.router, listings.router, sources.router):
        app.include_router(router, prefix=API_PREFIX)
    # photos are keyed <listing uuid>/<position>.jpg — unguessable, so no auth in M0
    app.mount("/photos", StaticFiles(directory=str(cfg.photo_dir), check_dir=False), name="photos")
    return app
