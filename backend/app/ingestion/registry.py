"""Build and look up the adapters the worker and the CLI drive."""

from collections.abc import Callable
from typing import Protocol, runtime_checkable

from app.core.settings import Settings
from app.ingestion.adapters.base import SourceAdapter
from app.ingestion.adapters.olx import OlxAdapter
from app.ingestion.adapters.telegram import TelegramAdapter
from app.ingestion.adapters.telegram.client import TelegramClientLike, make_client
from app.ingestion.http import CurlCffiClient, HttpClient, RateLimiter
from app.ingestion.manual import ManualAdapter
from app.modules.listings.models import Source


@runtime_checkable
class Closable(Protocol):
    """An adapter holding something worth releasing (an HTTP client, a Telegram session).

    Deliberately *not* part of `SourceAdapter`: releasing resources is the owner's
    concern (the worker, the CLI), not something the pipeline drives, and adapters like
    `ManualAdapter` hold nothing at all.
    """

    async def aclose(self) -> None: ...


class AdapterRegistry:
    """Looks up a `SourceAdapter` by kind, building lazily-registered ones on first use.

    `factories` lets `build_registry` defer constructing an adapter that needs
    credentials (Telegram) until it is actually needed, so an OLX-only deployment can
    build the registry — and run every other adapter — without Telegram configured. A
    factory that raises is *not* cached: the next `get`/`for_source` call retries it,
    since the underlying cause (e.g. missing credentials) may be fixed without
    restarting the process.
    """

    def __init__(
        self,
        adapters: dict[str, SourceAdapter],
        factories: dict[str, Callable[[], SourceAdapter]] | None = None,
    ) -> None:
        self._adapters: dict[str, SourceAdapter] = dict(adapters)
        self._factories: dict[str, Callable[[], SourceAdapter]] = (
            dict(factories) if factories else {}
        )

    def get(self, kind: str) -> SourceAdapter:
        if kind in self._adapters:
            return self._adapters[kind]
        adapter = self._factories[kind]()  # raises KeyError for an unknown kind too
        self._adapters[kind] = adapter
        return adapter

    def for_source(self, source: Source) -> SourceAdapter:
        try:
            return self.get(source.kind)
        except KeyError as exc:
            raise ValueError(f"no adapter for source kind {source.kind!r}") from exc

    @property
    def kinds(self) -> list[str]:
        return sorted(set(self._adapters) | set(self._factories))

    async def aclose(self) -> None:
        """Release every *built* adapter that holds something.

        Only built ones: a deferred factory has nothing open, and calling it here just
        to close it could raise (missing credentials) in the middle of a shutdown.
        """
        for adapter in self._adapters.values():
            if isinstance(adapter, Closable):
                await adapter.aclose()


def build_registry(
    settings: Settings,
    *,
    http: HttpClient | None = None,
    telegram_client: TelegramClientLike | None = None,
) -> AdapterRegistry:
    http = http or CurlCffiClient(user_agent=settings.http_user_agent, proxy=settings.olx_proxy_url)
    olx = OlxAdapter(
        http,
        RateLimiter(settings.olx_request_interval),
        photo_limiter=RateLimiter(settings.olx_photo_interval),
        max_pages=settings.olx_max_pages,
    )
    adapters: dict[str, SourceAdapter] = {"olx": olx, "manual": ManualAdapter()}
    factories: dict[str, Callable[[], SourceAdapter]] = {}
    if telegram_client is not None:
        adapters["telegram"] = TelegramAdapter(
            telegram_client,
            backfill_days=settings.telegram_backfill_days,
            rescan_limit=settings.telegram_rescan_limit,
        )
    else:
        # Deferred: constructing a real `TelethonClient` (via `make_client`) requires
        # TELEGRAM_API_ID/TELEGRAM_API_HASH, which an OLX-only deployment need not have.
        factories["telegram"] = lambda: TelegramAdapter(
            make_client(settings),
            backfill_days=settings.telegram_backfill_days,
            rescan_limit=settings.telegram_rescan_limit,
        )
    return AdapterRegistry(adapters, factories)
