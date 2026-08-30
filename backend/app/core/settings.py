from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[2]

# Everything the browser talks to sits under one prefix — photos included — so a
# deployment needs a single reverse-proxy route for `/api`. Here rather than in
# `app/api/` because `app/modules/` builds photo URLs and must not import the API layer.
API_PREFIX = "/api/v1"
PHOTO_URL_PREFIX = f"{API_PREFIX}/photos"


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
    # HS256 signs with the raw secret: anything shorter than the 32-byte digest weakens
    # it (PyJWT warns), and the shipped placeholder is public. The API refuses to start
    # on such a secret unless a developer opts in explicitly.
    allow_insecure_jwt_secret: bool = False
    telegram_api_id: int = 0
    telegram_api_hash: str = ""
    telegram_session_path: Path = Path("./data/telegram.session")
    dedupe_config_path: Path = BACKEND_DIR / "config" / "dedupe.yaml"
    tz: str = "Asia/Tashkent"
    log_level: str = "INFO"
    api_host: str = "127.0.0.1"
    api_port: int = 8000
    # comma-separated; the Vite dev server by default
    cors_origins: str = "http://localhost:5173"
    jwt_access_minutes: int = 15
    jwt_refresh_days: int = 30
    # POST /listings/manual is the one request that touches the network (spec §2): a
    # pasted link is fetched synchronously, so it needs a hard ceiling of its own.
    manual_fetch_timeout_seconds: int = 20

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def jwt_secret_is_insecure(self) -> bool:
        return self.jwt_secret in ("", "change-me") or len(self.jwt_secret.encode()) < 32

    http_user_agent: str = (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    )
    olx_proxy_url: str | None = None
    olx_request_interval: float = 2.0
    # photos come from *.olxcdn.com, not olx.uz: a separate, much smaller interval, or a
    # first full walk (~15k photo requests) would take ~9 h at the page rate alone
    olx_photo_interval: float = 0.3
    olx_max_pages: int = 25
    telegram_backfill_days: int = 14
    telegram_rescan_limit: int = 200
    worker_tick_seconds: int = 60
    daily_job_hour: int = 3


@lru_cache
def get_settings() -> Settings:
    return Settings()
