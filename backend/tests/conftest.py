import os
import subprocess
from collections.abc import AsyncIterator
from pathlib import Path

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, create_async_engine

# import every model module so Base.metadata is complete, mirroring alembic/env.py.
# Without this, running a subset of test files (e.g. only the listings-service
# tests) never imports app.modules.properties.models, and SQLAlchemy can't
# resolve Listing.property_id's string-based ForeignKey("properties.id") at flush.
import app.modules.availability.models  # noqa: F401,E402
import app.modules.contacts.models  # noqa: F401,E402
import app.modules.dedupe.models  # noqa: F401,E402
import app.modules.identity.models  # noqa: F401,E402
import app.modules.listings.models  # noqa: F401,E402
import app.modules.outreach.models  # noqa: F401,E402
import app.modules.properties.models  # noqa: F401,E402
import app.worker.models  # noqa: F401,E402
from app.core.db import make_engine
from app.core.settings import get_settings

BACKEND_DIR = Path(__file__).resolve().parents[1]


@pytest.fixture(scope="session")
async def engine() -> AsyncIterator[AsyncEngine]:
    url = get_settings().test_database_url
    assert url.rsplit("/", 1)[-1].startswith("realtor_test"), (
        f"refusing to reset non-test database {url!r}"
    )
    reset = create_async_engine(url, isolation_level="AUTOCOMMIT")
    async with reset.connect() as conn:
        await conn.execute(text("DROP SCHEMA public CASCADE"))
        await conn.execute(text("CREATE SCHEMA public"))
    await reset.dispose()
    subprocess.run(
        [str(BACKEND_DIR / ".venv" / "bin" / "alembic"), "upgrade", "head"],
        check=True,
        cwd=BACKEND_DIR,
        env={**os.environ, "DATABASE_URL": url},
    )
    eng = make_engine(url)
    yield eng
    await eng.dispose()


@pytest.fixture
async def db(engine: AsyncEngine) -> AsyncIterator[AsyncSession]:
    async with engine.connect() as conn:
        trans = await conn.begin()
        session = AsyncSession(
            bind=conn, expire_on_commit=False, join_transaction_mode="create_savepoint"
        )
        try:
            yield session
        finally:
            await session.close()
            await trans.rollback()
