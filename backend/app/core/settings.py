from functools import lru_cache
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[2]


def normalize_db_url(url: str) -> str:
    """Coerce a Postgres URL to the asyncpg driver and drop libpq-only query params.

    Lets a raw provider connection string be used verbatim — e.g. Neon's
    ``postgresql://…?sslmode=require&channel_binding=require`` becomes
    ``postgresql+asyncpg://…?ssl=require``. SQLAlchemy's async engine needs the asyncpg
    driver (a bare ``postgresql://`` selects psycopg2, which isn't installed), and asyncpg
    rejects the libpq-only ``sslmode``/``channel_binding`` params. Non-Postgres URLs
    (e.g. sqlite in tests) pass through unchanged.
    """
    for prefix in ("postgresql+asyncpg://", "postgresql://", "postgres://"):
        if url.startswith(prefix):
            url = "postgresql+asyncpg://" + url[len(prefix) :]
            break
    else:
        return url
    parts = urlsplit(url)
    params = dict(parse_qsl(parts.query, keep_blank_values=True))
    sslmode = params.pop("sslmode", None)
    params.pop("channel_binding", None)  # libpq-only; asyncpg has no such connect arg
    if sslmode and sslmode != "disable" and "ssl" not in params:
        params["ssl"] = "require"
    return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(params), parts.fragment))

# Everything the browser talks to sits under one prefix — photos included — so a
# deployment needs a single reverse-proxy route for `/api`. Here rather than in
# `app/api/` because `app/modules/` builds photo URLs and must not import the API layer.
API_PREFIX = "/api/v1"
PHOTO_URL_PREFIX = f"{API_PREFIX}/photos"


def photo_display_url(source_url: str | None, storage_key: str | None) -> str | None:
    """The URL a browser loads for a photo.

    Prefer the source CDN URL (hotlinked) — it's absolute, so it works from a split deploy
    where the SPA and API sit on different origins, and needs no local photo files. Fall back
    to the app's own re-hosted copy (a root-relative path under PHOTO_URL_PREFIX) when there's
    no source URL (e.g. manually added listings). Returns None when the photo has neither.
    """
    if source_url:
        return source_url
    if storage_key:
        return f"{PHOTO_URL_PREFIX}/{storage_key}"
    return None


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

    @field_validator("database_url", "test_database_url")
    @classmethod
    def _asyncpg_db_url(cls, v: str) -> str:
        return normalize_db_url(v)

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
    # Run the crawler loop inside the API process (lifespan task) instead of a separate
    # `python -m app.worker` process. For single-container free hosts (e.g. Render free) where
    # a standalone background process isn't reliably supervised. docker-compose leaves this off
    # and runs the dedicated worker service instead.
    run_worker_in_process: bool = False


@lru_cache
def get_settings() -> Settings:
    return Settings()
