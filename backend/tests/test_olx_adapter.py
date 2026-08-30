import json
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

from app.ingestion.adapters.base import (
    AdapterBackoff,
    InvalidListingUrl,
    ListingGone,
    RawRef,
)
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
from app.modules.listings.service import SeenWindow

FIX = Path(__file__).parent / "fixtures" / "olx"
LIST_HTML = (FIX / "list_page.html").read_text(encoding="utf-8")
DETAIL_HTML = (FIX / "detail_page.html").read_text(encoding="utf-8")
BASE = "https://www.olx.uz/nedvizhimost/kvartiry/arenda-dolgosrochnaya/tashkent/?search%5Border%5D=created_at:desc"
PHONES_JSON = json.dumps({"data": {"phones": ["+99 893 1793333"]}})


class FakeHttp:
    def __init__(self, routes: dict[str, tuple[int, bytes]]) -> None:
        self.routes = routes
        self.calls: list[str] = []
        self.closed = False

    async def get(self, url: str, *, headers: dict[str, str] | None = None) -> HttpResponse:
        self.calls.append(url)
        status, body = self.routes.get(url, (404, b"not found"))
        return HttpResponse(status=status, url=url, content=body)

    async def aclose(self) -> None:
        self.closed = True


async def _no_sleep(_: float) -> None:
    return None


class _CountingLimiter(RateLimiter):
    """A real limiter (zero interval, no sleeping) that records how often it was used."""

    def __init__(self) -> None:
        super().__init__(0, jitter=0, sleep=_no_sleep)
        self.waits = 0

    async def wait(self) -> None:
        self.waits += 1
        await super().wait()


def _adapter(routes: dict[str, tuple[int, bytes]], **kw: object) -> tuple[OlxAdapter, FakeHttp]:
    http = FakeHttp(routes)
    return OlxAdapter(http, RateLimiter(0, jitter=0, sleep=_no_sleep), **kw), http  # type: ignore[arg-type]


def _routes() -> dict[str, tuple[int, bytes]]:
    routes = {
        BASE: (200, LIST_HTML.encode()),
        BASE + "&page=2": (404, b""),
        "https://www.olx.uz/api/v1/offers/65000001/limited-phones/": (200, PHONES_JSON.encode()),
        "https://frankfurt.apollo.olxcdn.com:443/v1/files/fixture-1-0-UZ/image;s=1280x960": (
            200,
            b"\xff\xd8jpegbytes",
        ),
    }
    # every listed ad resolves to the same recorded detail page, so a test can fetch a
    # whole discovery batch without caring which ad it is
    for ad in list_ads(extract_state(LIST_HTML)):
        routes[str(ad["url"])] = (200, DETAIL_HTML.encode())
    return routes


def _demote(html: str, slug: str) -> str:
    """Clear one ad's promoted/highlighted flags, keyed by its unique detail-page slug.

    Targeted on purpose: the recorded fixture stays exactly as OLX served it (all three
    ads promoted), and each test states which ad it wants to look organic.
    """
    marker = f'{slug}.html\\", \\"isHighlighted\\": true, \\"isPromoted\\": true'
    assert marker in html
    return html.replace(marker, marker.replace("true", "false"))


def _without_last_refresh(html: str, stamp: str) -> str:
    marker = f'\\"lastRefreshTime\\": \\"{stamp}\\", '
    assert marker in html
    return html.replace(marker, "")


def _without_ad(html: str, ad_id: str, next_ad_id: str) -> str:
    start = html.index(f'{{\\"id\\": {ad_id},')
    end = html.index(f'{{\\"id\\": {next_ad_id},')
    return html[:start] + html[end:]


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


def _list_calls(http: FakeHttp, since: int = 0) -> list[str]:
    """The list-page URLs requested since `since` — the discovery budget of a run."""
    return [c for c in http.calls[since:] if c.startswith(BASE)]


async def _run(adapter: OlxAdapter, source: Source) -> tuple[list[str], SeenWindow | None]:
    """Drive one discovery run the way `run_source` does: discover → fetch each → seen_window."""
    found: list[str] = []
    async for ref in adapter.discover(source):
        found.append(ref.external_id)
        try:
            await adapter.fetch(ref)
        except ListingGone:
            pass
    return found, await adapter.seen_window(source)


async def test_discover_yields_new_and_changed_only_and_keeps_window() -> None:
    adapter, http = _adapter(_routes())
    source = Source(kind="olx", name="olx", config={"url": BASE}, state={})
    refs = [r async for r in adapter.discover(source)]
    assert [r.external_id for r in refs] == ["65000001", "65000002", "65000003"]
    assert refs[0].posted_at == datetime.fromisoformat("2026-08-28T00:55:10+05:00")
    assert http.calls == [BASE, BASE + "&page=2"]  # run 1 walks every page to the end
    for ref in refs:
        await adapter.fetch(ref)
    window = await adapter.seen_window(source)
    assert window is not None and window.ids == {"65000001", "65000002", "65000003"}
    assert set(source.state["known"]) == window.ids and source.state["run_counter"] == 1

    # second run: nothing changed → no refs, and the walk stops after page 1
    calls = len(http.calls)
    found, _ = await _run(adapter, source)
    assert found == [] and _list_calls(http, calls) == [BASE]

    # a changed signature → one ref, and the walk goes on past page 1 again
    source.state = {**source.state, "known": {**source.state["known"], "65000002": "stale"}}
    calls = len(http.calls)
    found, _ = await _run(adapter, source)
    assert found == ["65000002"] and _list_calls(http, calls) == [BASE, BASE + "&page=2"]


async def test_removal_window_ignores_promoted_ads_and_uses_last_refresh() -> None:
    # ad 65000002 is the trap: created 2026-07-01 but hoisted to the top as a promoted
    # ad, so min(createdTime) would push the removal boundary six weeks back over pages
    # the walk never visited. Demoted, its own lastRefreshTime is the honest boundary.
    routes = _routes()
    routes[BASE] = (200, _demote(LIST_HTML, "fixture-2-ID00002").encode())
    adapter, _ = _adapter(routes)
    source = Source(kind="olx", name="olx", config={"url": BASE}, state={})
    _, window = await _run(adapter, source)
    assert window is not None
    assert window.ids == {"65000001", "65000002", "65000003"}
    assert window.oldest_posted_at == datetime.fromisoformat("2026-08-29T14:01:58+05:00")


async def test_removal_window_falls_back_to_created_time() -> None:
    routes = _routes()
    page = _demote(LIST_HTML, "fixture-3-ID00003")
    routes[BASE] = (200, _without_last_refresh(page, "2026-08-28T15:21:03+05:00").encode())
    adapter, _ = _adapter(routes)
    source = Source(kind="olx", name="olx", config={"url": BASE}, state={})
    _, window = await _run(adapter, source)
    assert window is not None
    assert window.oldest_posted_at == datetime.fromisoformat("2026-08-10T15:20:45+05:00")


async def test_all_promoted_walk_leaves_the_removal_window_open() -> None:
    # every ad in the recorded fixture is promoted: nothing bounds the walk, so removal
    # detection is disabled for the run while the ids are still marked seen
    adapter, _ = _adapter(_routes())
    source = Source(kind="olx", name="olx", config={"url": BASE}, state={})
    _, window = await _run(adapter, source)
    assert window is not None
    assert window.ids == {"65000001", "65000002", "65000003"}
    assert window.oldest_posted_at is None


async def test_failed_fetch_leaves_the_ad_unknown_so_it_is_retried() -> None:
    routes = _routes()
    url = str(list_ads(extract_state(LIST_HTML))[1]["url"])
    routes[url] = (500, b"boom")  # 65000002's fetch blows up this run
    adapter, _ = _adapter(routes)
    source = Source(kind="olx", name="olx", config={"url": BASE}, state={})
    refs = [r async for r in adapter.discover(source)]
    for ref in refs:
        if ref.external_id == "65000002":
            with pytest.raises(RuntimeError):
                await adapter.fetch(ref)
        else:
            await adapter.fetch(ref)
    await adapter.seen_window(source)
    assert set(source.state["known"]) == {"65000001", "65000003"}

    routes[url] = (200, DETAIL_HTML.encode())  # OLX recovers by the next run
    found, _ = await _run(adapter, source)
    assert found == ["65000002"]
    assert set(source.state["known"]) == {"65000001", "65000002", "65000003"}


async def test_aborted_run_does_not_leak_a_stale_confirmation_into_the_next_run() -> None:
    # A run that confirms an ad via `fetch` but never reaches `seen_window` (e.g. an
    # `AdapterBackoff` from a later fetch, which `run_source` re-raises without calling
    # `seen_window` at all) must not let that confirmation survive into the next run:
    # if the ad's fetch then genuinely fails, it must stay out of `known`.
    routes = _routes()
    url = str(list_ads(extract_state(LIST_HTML))[0]["url"])  # 65000001
    adapter, _ = _adapter(routes)
    source = Source(kind="olx", name="olx", config={"url": BASE}, state={})

    refs = [r async for r in adapter.discover(source)]
    await adapter.fetch(next(r for r in refs if r.external_id == "65000001"))
    # the run aborts here — no `seen_window` call, as if a later fetch had raised

    routes[url] = (500, b"boom")  # this run, 65000001's fetch genuinely fails
    refs = [r async for r in adapter.discover(source)]
    for ref in refs:
        if ref.external_id == "65000001":
            with pytest.raises(RuntimeError):
                await adapter.fetch(ref)
        else:
            await adapter.fetch(ref)
    await adapter.seen_window(source)
    assert "65000001" not in source.state["known"]


async def test_confirmations_do_not_leak_between_sources_sharing_one_adapter() -> None:
    # A worker registry may hand the same OlxAdapter instance to several Source rows;
    # one source's in-flight confirmations must not be visible to, or consumable by,
    # another source's `seen_window`.
    adapter, _ = _adapter(_routes())
    source_a = Source(kind="olx", name="a", config={"url": BASE}, state={}, id=uuid.uuid4())
    source_b = Source(kind="olx", name="b", config={"url": BASE}, state={}, id=uuid.uuid4())

    refs_a = [r async for r in adapter.discover(source_a)]
    await adapter.fetch(next(r for r in refs_a if r.external_id == "65000001"))
    # source A's run is still in flight (no seen_window yet) when source B runs and closes out

    _ = [r async for r in adapter.discover(source_b)]
    window_b = await adapter.seen_window(source_b)
    assert window_b is not None
    assert "65000001" not in source_b.state.get("known", {})

    window_a = await adapter.seen_window(source_a)
    assert window_a is not None
    assert "65000001" in source_a.state["known"]


async def test_listing_gone_counts_as_handled() -> None:
    routes = _routes()
    routes.pop(str(list_ads(extract_state(LIST_HTML))[1]["url"]))  # 65000002 → 404 → gone
    adapter, _ = _adapter(routes)
    source = Source(kind="olx", name="olx", config={"url": BASE}, state={})
    found, _ = await _run(adapter, source)
    assert found == ["65000001", "65000002", "65000003"]
    assert set(source.state["known"]) == {"65000001", "65000002", "65000003"}
    found, _ = await _run(adapter, source)
    assert found == []


async def test_full_walk_drops_a_delisted_ad_from_known() -> None:
    routes = _routes()
    adapter, http = _adapter(routes, full_walk_every=2)
    source = Source(kind="olx", name="olx", config={"url": BASE}, state={})
    found, _ = await _run(adapter, source)
    assert found == ["65000001", "65000002", "65000003"]
    assert set(source.state["known"]) == {"65000001", "65000002", "65000003"}

    # run 2 is a full walk again (full_walk_every=2) and 65000002 is no longer listed
    routes[BASE] = (200, _without_ad(LIST_HTML, "65000002", "65000003").encode())
    calls = len(http.calls)
    found, window = await _run(adapter, source)
    assert found == []  # the two survivors are unchanged, so nothing is re-yielded
    assert _list_calls(http, calls) == [BASE, BASE + "&page=2"]  # full walk despite fresh == 0
    assert window is not None and window.ids == {"65000001", "65000003"}
    assert set(source.state["known"]) == {"65000001", "65000003"}


async def test_404_on_the_first_list_page_is_a_failure_not_an_empty_walk() -> None:
    adapter, _ = _adapter({})
    source = Source(kind="olx", name="olx", config={"url": BASE}, state={})
    with pytest.raises(RuntimeError, match="olx list page 1"):
        _ = [r async for r in adapter.discover(source)]


async def test_404_on_a_later_list_page_ends_pagination() -> None:
    adapter, http = _adapter(_routes())
    source = Source(kind="olx", name="olx", config={"url": BASE}, state={})
    refs = [r async for r in adapter.discover(source)]
    assert len(refs) == 3 and http.calls == [BASE, BASE + "&page=2"]


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
    # the verbatim payload keeps what the API actually returned; normalisation is a
    # parsing decision that reparse must be free to redo
    assert p.payload["phones"] == ["+99 893 1793333"]


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


async def test_a_blocked_phone_endpoint_never_aborts_the_run() -> None:
    """403/429 from `limited-phones/` must not raise: it is a best-effort extra (spec
    §3.3) called once per ad, so re-raising `AdapterBackoff` from it aborted the whole
    source at the very first ad. Instead the lookup is switched off for the rest of the
    run — one warning, no phones — and the walk carries on.
    """
    phones_url = "https://www.olx.uz/api/v1/offers/65000001/limited-phones/"
    routes = _routes()
    routes[phones_url] = (429, b"slow down")
    adapter, http = _adapter(routes)
    source = Source(kind="olx", name="olx", config={"url": BASE}, state={}, id=uuid.uuid4())

    fetched: list[str] = []
    payloads = []
    async for ref in adapter.discover(source):
        fetched.append(ref.external_id)
        payloads.append(await adapter.fetch(ref))
    await adapter.seen_window(source)
    assert fetched == ["65000001", "65000002", "65000003"]  # the whole walk, not one ad
    assert all(kind != "phone" for p in payloads for kind, _ in p.contact_hints)
    # tried once, then skipped for every later ad of the same run
    assert [c for c in http.calls if c.endswith("/limited-phones/")] == [phones_url]

    # the next run tries again: the block is per run, not for the life of the adapter
    routes[phones_url] = (200, PHONES_JSON.encode())
    source.state = {**source.state, "known": {}}
    calls = len(http.calls)
    payloads = [await adapter.fetch(ref) async for ref in adapter.discover(source)]
    assert ("phone", "+998931793333") in payloads[0].contact_hints
    assert len([c for c in http.calls[calls:] if c.endswith("/limited-phones/")]) == 3


async def test_photo_downloads_use_the_photo_limiter() -> None:
    """CDN photo fetches must not spend the 2 s OLX page budget: a first full walk is
    ~15k photos, which at 2 s apiece is nine hours of downloads alone."""
    photo_url = "https://frankfurt.apollo.olxcdn.com:443/v1/files/fixture-1-0-UZ/image;s=1280x960"
    http = FakeHttp(_routes())
    pages, photos = _CountingLimiter(), _CountingLimiter()
    adapter = OlxAdapter(http, pages, photo_limiter=photos)  # type: ignore[arg-type]
    assert await adapter.download_photo(photo_url) == b"\xff\xd8jpegbytes"
    assert (pages.waits, photos.waits) == (0, 1)
    await adapter.fetch(
        RawRef(
            external_id="65000001", url=list_ads(extract_state(LIST_HTML))[0]["url"], posted_at=None
        )
    )
    assert photos.waits == 1 and pages.waits == 2  # detail page + phone endpoint

    only_one = _CountingLimiter()
    fallback = OlxAdapter(FakeHttp(_routes()), only_one)  # type: ignore[arg-type]
    await fallback.download_photo(photo_url)
    assert only_one.waits == 1  # no photo limiter configured → the page limiter


async def test_aclose_closes_the_http_client() -> None:
    adapter, http = _adapter(_routes())
    await adapter.aclose()
    assert http.closed


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


@pytest.mark.parametrize("status", [429, 403])
async def test_blocked_http_status_raises_backoff_with_a_one_minute_floor(status: int) -> None:
    # escalation is the pipeline's job (it owns source.state); the adapter only names the
    # shortest sane pause and why
    adapter, _ = _adapter({BASE: (status, b"slow down")})
    source = Source(kind="olx", name="olx", config={"url": BASE}, state={})
    with pytest.raises(AdapterBackoff) as info:
        _ = [r async for r in adapter.discover(source)]
    assert info.value.retry_after == timedelta(minutes=1)
    assert info.value.reason == f"olx http {status} from www.olx.uz"
    assert "backoff_level" not in source.state


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


async def test_fetch_by_url_rejects_a_url_with_no_ad_id() -> None:
    """A category or search URL is not an ad: say so instead of spending a request on it."""
    adapter, http = _adapter({})
    for url in (BASE, "https://www.olx.uz/d/obyavlenie/x.html", "https://www.olx.uz/"):
        with pytest.raises(InvalidListingUrl, match="not an olx ad url"):
            await adapter.fetch_by_url(url)
    assert http.calls == []
