# ruff: noqa: I001 -- imports below are intentionally grouped (core, then every
# model module for Base.metadata), not alphabetized; order carries no import-time
# dependency, only readability.
import asyncio
import os
from logging.config import fileConfig

from alembic import context
from sqlalchemy.ext.asyncio import create_async_engine

from app.core.db import Base
from app.core.settings import get_settings

# import every model module so Base.metadata is complete
import app.modules.identity.models  # noqa: F401,E402
import app.modules.listings.models  # noqa: F401,E402
import app.modules.contacts.models  # noqa: F401,E402
import app.modules.properties.models  # noqa: F401,E402
import app.modules.availability.models  # noqa: F401,E402
import app.modules.dedupe.models  # noqa: F401,E402
import app.worker.models  # noqa: F401,E402

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata
DATABASE_URL = os.environ.get("DATABASE_URL") or get_settings().database_url


def run_migrations_offline() -> None:
    context.configure(url=DATABASE_URL, target_metadata=target_metadata, literal_binds=True)
    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection) -> None:  # type: ignore[no-untyped-def]
    context.configure(connection=connection, target_metadata=target_metadata)
    with context.begin_transaction():
        context.run_migrations()


async def run_migrations_online() -> None:
    engine = create_async_engine(DATABASE_URL)
    async with engine.connect() as connection:
        await connection.run_sync(do_run_migrations)
    await engine.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    asyncio.run(run_migrations_online())
