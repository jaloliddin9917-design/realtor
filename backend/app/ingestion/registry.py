"""Build and look up the adapters the worker and the CLI drive."""

from app.core.settings import Settings
from app.ingestion.adapters.base import SourceAdapter
from app.ingestion.adapters.olx import OlxAdapter
from app.ingestion.adapters.telegram import TelegramAdapter
from app.ingestion.adapters.telegram.client import TelegramClientLike, make_client
from app.ingestion.http import HttpClient, HttpxClient, RateLimiter
from app.ingestion.manual import ManualAdapter
from app.modules.listings.models import Source


class AdapterRegistry:
    def __init__(self, adapters: dict[str, SourceAdapter]) -> None:
        self._adapters = adapters

    def get(self, kind: str) -> SourceAdapter:
        return self._adapters[kind]

    def for_source(self, source: Source) -> SourceAdapter:
        try:
            return self._adapters[source.kind]
        except KeyError as exc:
            raise ValueError(f"no adapter for source kind {source.kind!r}") from exc

    @property
    def kinds(self) -> list[str]:
        return sorted(self._adapters)


def build_registry(
    settings: Settings,
    *,
    http: HttpClient | None = None,
    telegram_client: TelegramClientLike | None = None,
) -> AdapterRegistry:
    http = http or HttpxClient(user_agent=settings.http_user_agent, proxy=settings.olx_proxy_url)
    olx = OlxAdapter(
        http, RateLimiter(settings.olx_request_interval), max_pages=settings.olx_max_pages
    )
    telegram = TelegramAdapter(
        telegram_client or make_client(settings),
        backfill_days=settings.telegram_backfill_days,
        rescan_limit=settings.telegram_rescan_limit,
    )
    return AdapterRegistry({"olx": olx, "telegram": telegram, "manual": ManualAdapter()})
