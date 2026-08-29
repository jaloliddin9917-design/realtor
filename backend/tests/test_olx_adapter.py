import json
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

from app.ingestion.adapters.base import AdapterBackoff, ListingGone, RawRef
from app.ingestion.adapters.olx import OlxAdapter
from app.ingestion.adapters.olx.state import (
    ad_to_payload,
    detail_ad,
    extract_state,
    list_ads,
    list_pages,
)
from app.ingestion.http import HttpResponse, RateLimiter
from app.ingestion.parse import normalize_phone
from app.modules.listings.models import RawListing, Source

FIX = Path(__file__).parent / "fixtures" / "olx"
LIST_HTML = (FIX / "list_page.html").read_text(encoding="utf-8")
DETAIL_HTML = (FIX / "detail_page.html").read_text(encoding="utf-8")
BASE = "https://www.olx.uz/nedvizhimost/kvartiry/arenda-dolgosrochnaya/tashkent/?search%5Border%5D=created_at:desc"
PHONES_JSON = json.dumps({"data": {"phones": ["+99 893 1793333"]}})


class FakeHttp:
    def __init__(self, routes: dict[str, tuple[int, bytes]]) -> None:
        self.routes = routes
        self.calls: list[str] = []

    async def get(self, url: str, *, headers: dict[str, str] | None = None) -> HttpResponse:
        self.calls.append(url)
        status, body = self.routes.get(url, (404, b"not found"))
        return HttpResponse(status=status, url=url, content=body)

    async def aclose(self) -> None:
        return None


async def _no_sleep(_: float) -> None:
    return None


def _adapter(routes: dict[str, tuple[int, bytes]], **kw: object) -> tuple[OlxAdapter, FakeHttp]:
    http = FakeHttp(routes)
    return OlxAdapter(http, RateLimiter(0, jitter=0, sleep=_no_sleep), **kw), http  # type: ignore[arg-type]


def _routes() -> dict[str, tuple[int, bytes]]:
    detail_url = list_ads(extract_state(LIST_HTML))[0]["url"]
    return {
        BASE: (200, LIST_HTML.encode()),
        BASE + "&page=2": (404, b""),
        detail_url: (200, DETAIL_HTML.encode()),
        "https://www.olx.uz/api/v1/offers/65000001/limited-phones/": (200, PHONES_JSON.encode()),
        "https://frankfurt.apollo.olxcdn.com:443/v1/files/fixture-1-0-UZ/image;s=1280x960": (
            200,
            b"\xff\xd8jpegbytes",
        ),
    }


def test_extract_state_and_accessors() -> None:
    state = extract_state(LIST_HTML)
    ads = list_ads(state)
    assert [a["id"] for a in ads] == [65000001, 65000002, 65000003]
    assert list_pages(state) == (0, 25)
    ad = detail_ad(extract_state(DETAIL_HTML))
    assert ad["id"] == 65000001 and ad["price"]["regularPrice"]["currencyCode"] == "UYE"
    with pytest.raises(ValueError):
        extract_state("<html>no state</html>")


def test_ad_to_payload_maps_structured_fields() -> None:
    ad = detail_ad(extract_state(DETAIL_HTML))
    p = ad_to_payload(ad, ["+998931793333"])
    assert p.external_id == "65000001" and p.url == ad["url"]
    assert p.posted_at == datetime.fromisoformat("2026-08-28T00:55:10+05:00")
    assert p.structured == {
        "title": ad["title"],
        "price_amount_minor": 55000,
        "price_currency": "USD",
        "rooms": 2,
        "floor": 2,
        "total_floors": 7,
        "area_sqm": 50.0,
        "district": "yunusobod",
    }
    assert ("olx_user", "100000001") in p.contact_hints and (
        "phone",
        "+998931793333",
    ) in p.contact_hints
    assert p.text.startswith(ad["title"]) and "<br" not in p.text and "Юнусабад" in p.text
    assert p.photo_refs == ad["photos"] and p.payload == {"ad": ad, "phones": ["+998931793333"]}


def test_list_price_in_uzs_is_kept_as_uzs() -> None:
    ad = list_ads(extract_state(LIST_HTML))[0]
    p = ad_to_payload(ad, [])
    assert (
        p.structured is not None
        and p.structured["price_currency"] == "UZS"
        and p.structured["price_amount_minor"] == 650375000
    )


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("+99 893 1793333", "+998931793333"),
        ("93 179 33 33", "+998931793333"),
        ("998901234567", "+998901234567"),
        ("12345", None),
    ],
)
def test_normalize_phone(raw: str, expected: str | None) -> None:
    assert normalize_phone(raw) == expected


async def test_discover_yields_new_and_changed_only_and_keeps_window(db) -> None:  # type: ignore[no-untyped-def]
    adapter, http = _adapter(_routes())
    source = Source(kind="olx", name="olx", config={"url": BASE}, state={})
    refs = [r async for r in adapter.discover(source)]
    assert [r.external_id for r in refs] == ["65000001", "65000002", "65000003"]
    assert refs[0].posted_at == datetime.fromisoformat("2026-08-28T00:55:10+05:00")
    window = await adapter.seen_window(source)
    assert window is not None and window.ids == {"65000001", "65000002", "65000003"}
    assert window.oldest_posted_at == min(r.posted_at for r in refs if r.posted_at)
    assert set(source.state["known"]) == window.ids and source.state["run_counter"] == 1
    # second run: nothing changed → no refs; a changed signature → one ref
    assert [r async for r in adapter.discover(source)] == []
    source.state = {**source.state, "known": {**source.state["known"], "65000002": "stale"}}
    assert [r.external_id async for r in adapter.discover(source)] == ["65000002"]


async def test_fetch_uses_detail_page_and_phone_endpoint() -> None:
    adapter, http = _adapter(_routes())
    ref = RawRef(
        external_id="65000001", url=list_ads(extract_state(LIST_HTML))[0]["url"], posted_at=None
    )
    p = await adapter.fetch(ref)
    assert p.structured is not None and (
        p.structured["price_amount_minor"],
        p.structured["price_currency"],
    ) == (55000, "USD")
    assert ("phone", "+998931793333") in p.contact_hints
    assert http.calls[-1].endswith("/limited-phones/")


async def test_fetch_without_phone_endpoint_still_works() -> None:
    routes = _routes()
    routes.pop("https://www.olx.uz/api/v1/offers/65000001/limited-phones/")
    adapter, _ = _adapter(routes)
    p = await adapter.fetch(
        RawRef(
            external_id="65000001", url=list_ads(extract_state(LIST_HTML))[0]["url"], posted_at=None
        )
    )
    assert (
        all(kind != "phone" for kind, _ in p.contact_hints)
        and ("olx_user", "100000001") in p.contact_hints
    )


async def test_fetch_404_and_inactive_raise_listing_gone() -> None:
    routes = _routes()
    adapter, _ = _adapter(routes)
    with pytest.raises(ListingGone):
        await adapter.fetch(
            RawRef(
                external_id="x",
                url="https://www.olx.uz/d/obyavlenie/missing-IDzzz.html",
                posted_at=None,
            )
        )
    inactive = DETAIL_HTML.replace('\\"isActive\\": true', '\\"isActive\\": false').replace(
        '\\"status\\": \\"active\\"', '\\"status\\": \\"removed_by_user\\"'
    )
    url = list_ads(extract_state(LIST_HTML))[0]["url"]
    routes[url] = (200, inactive.encode())
    with pytest.raises(ListingGone):
        await adapter.fetch(RawRef(external_id="65000001", url=url, posted_at=None))


async def test_http_429_raises_backoff_and_bumps_state() -> None:
    adapter, _ = _adapter({BASE: (429, b"slow down")})
    source = Source(kind="olx", name="olx", config={"url": BASE}, state={})
    with pytest.raises(AdapterBackoff) as info:
        _ = [r async for r in adapter.discover(source)]
    assert info.value.retry_after == timedelta(minutes=1) and source.state["backoff_level"] == 1


async def test_rebuild_payload_round_trips_and_photo_download() -> None:
    adapter, _ = _adapter(_routes())
    ad = detail_ad(extract_state(DETAIL_HTML))
    raw = RawListing(
        external_id="65000001",
        payload={"ad": ad, "phones": ["+998931793333"]},
        content_hash="h",
        fetched_at=datetime.now(UTC),
    )
    p = await adapter.rebuild_payload(raw)
    assert p == ad_to_payload(ad, ["+998931793333"])
    assert await adapter.download_photo(ad["photos"][0]) == b"\xff\xd8jpegbytes"
