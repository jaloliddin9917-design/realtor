import asyncio
import random
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import timedelta
from typing import Any, Protocol

import httpx

from app.modules.listings.models import Source

BROWSER_ACCEPT = (
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8"
)


@dataclass
class HttpResponse:
    status: int
    url: str
    content: bytes

    @property
    def text(self) -> str:
        return self.content.decode("utf-8", errors="replace")


class HttpClient(Protocol):
    async def get(self, url: str, *, headers: dict[str, str] | None = None) -> HttpResponse: ...

    async def aclose(self) -> None: ...


class HttpxClient:
    def __init__(
        self,
        *,
        user_agent: str,
        proxy: str | None = None,
        timeout: float = 30.0,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        headers = {
            "User-Agent": user_agent,
            "Accept": BROWSER_ACCEPT,
            "Accept-Language": "ru,uz;q=0.8,en;q=0.5",
        }
        kwargs: dict[str, Any] = {"headers": headers, "follow_redirects": True, "timeout": timeout}
        if transport is not None:
            kwargs["transport"] = transport
        elif proxy:
            kwargs["proxy"] = proxy
        self._client = httpx.AsyncClient(**kwargs)

    async def get(self, url: str, *, headers: dict[str, str] | None = None) -> HttpResponse:
        response = await self._client.get(url, headers=headers)
        return HttpResponse(
            status=response.status_code, url=str(response.url), content=response.content
        )

    async def aclose(self) -> None:
        await self._client.aclose()


class RateLimiter:
    def __init__(
        self,
        min_interval: float,
        jitter: float = 0.5,
        *,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.min_interval, self.jitter, self._sleep, self._clock = (
            min_interval,
            jitter,
            sleep,
            clock,
        )
        self._last: float | None = None

    async def wait(self) -> None:
        if self._last is not None:
            due = self._last + self.min_interval + random.uniform(0, self.jitter)  # noqa: S311 — timing jitter, not security
            remaining = due - self._clock()
            if remaining > 0:
                await self._sleep(remaining)
        self._last = self._clock()


def backoff_delay(level: int) -> timedelta:
    return timedelta(minutes=min(32, 2**level))


def bump_backoff(source: Source) -> tuple[int, timedelta]:
    level = int(source.state.get("backoff_level", 0))
    source.state = {**source.state, "backoff_level": level + 1}
    return level, backoff_delay(level)


def reset_backoff(source: Source) -> None:
    if "backoff_level" in source.state:
        source.state = {k: v for k, v in source.state.items() if k != "backoff_level"}
