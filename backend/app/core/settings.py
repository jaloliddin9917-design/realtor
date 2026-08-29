from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(BACKEND_DIR / ".env"),
        env_ignore_empty=True,
        extra="ignore",
    )

    database_url: str = "postgresql+asyncpg://realtor:realtor@localhost:5432/realtor"
    test_database_url: str = "postgresql+asyncpg://realtor:realtor@localhost:5432/realtor_test"
    photo_dir: Path = Path("./data/photos")
    jwt_secret: str = "change-me"
    telegram_api_id: int = 0
    telegram_api_hash: str = ""
    telegram_session_path: Path = Path("./data/telegram.session")
    dedupe_config_path: Path = BACKEND_DIR / "config" / "dedupe.yaml"
    tz: str = "Asia/Tashkent"
    log_level: str = "INFO"
    http_user_agent: str = (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    )
    olx_proxy_url: str | None = None
    olx_request_interval: float = 2.0
    olx_max_pages: int = 25
    telegram_backfill_days: int = 14
    telegram_rescan_limit: int = 200
    worker_tick_seconds: int = 60
    daily_job_hour: int = 3


@lru_cache
def get_settings() -> Settings:
    return Settings()
