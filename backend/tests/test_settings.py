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


def test_empty_env_values_do_not_override_defaults(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    monkeypatch.setenv("HTTP_USER_AGENT", "")
    monkeypatch.setenv("OLX_PROXY_URL", "")
    s = Settings(_env_file=None)
    assert s.http_user_agent.startswith("Mozilla/5.0") and s.olx_proxy_url is None
