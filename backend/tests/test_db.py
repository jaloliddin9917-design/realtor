from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


async def test_database_is_reachable_and_migrated(db: AsyncSession) -> None:
    version = (await db.execute(text("SELECT version_num FROM alembic_version"))).scalar_one()
    assert version
    extensions = {
        row[0] for row in (await db.execute(text("SELECT extname FROM pg_extension"))).all()
    }
    assert {"pg_trgm", "unaccent"} <= extensions
