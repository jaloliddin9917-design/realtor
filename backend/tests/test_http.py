from datetime import timedelta

import httpx

from app.ingestion.http import HttpxClient, RateLimiter, backoff_delay, bump_backoff, reset_backoff
from app.modules.listings.models import Source


async def test_httpx_client_sends_browser_headers_and_follows_redirects() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        if request.url.path == "/old":
            return httpx.Response(301, headers={"location": "https://www.olx.uz/new"})
        return httpx.Response(200, content=b"<html>ok</html>")

    client = HttpxClient(user_agent="UA/1.0", transport=httpx.MockTransport(handler))
    resp = await client.get("https://www.olx.uz/old")
    await client.aclose()
    assert (
        resp.status == 200
        and resp.text == "<html>ok</html>"
        and resp.url == "https://www.olx.uz/new"
    )
    assert seen[0].headers["user-agent"] == "UA/1.0" and seen[0].headers[
        "accept-language"
    ].startswith("ru")


async def test_rate_limiter_spaces_calls() -> None:
    now = [0.0]
    slept: list[float] = []

    async def sleep(seconds: float) -> None:
        slept.append(seconds)
        now[0] += seconds

    limiter = RateLimiter(2.0, jitter=0.0, sleep=sleep, clock=lambda: now[0])
    await limiter.wait()  # first call: no wait
    now[0] += 0.5
    await limiter.wait()  # 1.5 s remaining
    assert slept == [1.5]


def test_backoff_delay_doubles_and_caps() -> None:
    assert backoff_delay(0) == timedelta(minutes=1)
    assert backoff_delay(3) == timedelta(minutes=8)
    assert backoff_delay(9) == timedelta(minutes=32)


def test_bump_and_reset_backoff_reassign_state() -> None:
    source = Source(kind="olx", name="olx", config={}, state={"known": {"1": "x"}})
    before = source.state
    level, delay = bump_backoff(source)
    assert (level, delay) == (0, timedelta(minutes=1))
    assert (
        source.state is not before
        and source.state["backoff_level"] == 1
        and source.state["known"] == {"1": "x"}
    )
    reset_backoff(source)
    assert "backoff_level" not in source.state and source.state["known"] == {"1": "x"}
