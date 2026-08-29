from pathlib import Path

from app.core.settings import Settings, get_settings


def test_defaults_point_at_local_postgres() -> None:
    s = Settings(_env_file=None)
    assert s.database_url.startswith("postgresql+asyncpg://")
    assert s.test_database_url.endswith("/realtor_test")
    assert s.photo_dir == Path("./data/photos")
    assert s.tz == "Asia/Tashkent"


def test_env_overrides(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    monkeypatch.setenv("DATABASE_URL", "postgresql+asyncpg://u:p@h:5432/x")
    get_settings.cache_clear()
    assert get_settings().database_url == "postgresql+asyncpg://u:p@h:5432/x"
    get_settings.cache_clear()
