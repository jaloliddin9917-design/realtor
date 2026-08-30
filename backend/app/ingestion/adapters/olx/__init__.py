"""OLX.uz adapter — list pages for discovery, detail pages for the canonical payload."""

import json
import re
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import structlog

from app.ingestion.adapters.base import (
    AdapterBackoff,
    InvalidListingUrl,
    ListingGone,
    RawPayload,
    RawRef,
)
from app.ingestion.adapters.olx.state import (
    ad_signature,
    ad_time,
    ad_to_payload,
    detail_ad,
    extract_state,
    list_ads,
    list_pages,
)
from app.ingestion.http import HttpClient, HttpResponse, RateLimiter, backoff_delay
from app.modules.listings.models import RawListing, Source
from app.modules.listings.service import SeenWindow

log = structlog.get_logger()
PHONES_URL = "https://www.olx.uz/api/v1/offers/{id}/limited-phones/"
# every olx.uz ad page ends in "-ID<slug>.html"; a category or search URL does not
_AD_URL = re.compile(r"-ID[0-9A-Za-z]+\.html$", re.IGNORECASE)


def page_url(base: str, page: int) -> str:
    if page <= 1:
        return base  # the category URL as configured; page 1 needs no rewriting at all
    parts = urlsplit(base)
    query = [(k, v) for k, v in parse_qsl(parts.query, keep_blank_values=True) if k != "page"]
    query.append(("page", str(page)))
    # safe=":" — urlencode's default quoting escapes ":" to "%3A", which would mangle
    # OLX's own query values (e.g. "created_at:desc"). Both forms are equivalent over
    # HTTP, but leaving ":" alone matches what a browser sends.
    encoded = urlencode(query, safe=":")
    return urlunsplit((parts.scheme, parts.netloc, parts.path, encoded, parts.fragment))


@dataclass
class _Walk:
    """What one `discover` pass saw, held until `seen_window` closes the run out."""

    walked: dict[str, str] = field(default_factory=dict)  # external_id → signature
    boundary: list[datetime] = field(default_factory=list)
    full: bool = False


class OlxAdapter:
    kind = "olx"

    def __init__(
        self,
        http: HttpClient,
        limiter: RateLimiter,
        *,
        photo_limiter: RateLimiter | None = None,
        max_pages: int = 25,
        full_walk_every: int = 4,
        phone_lookup: bool = True,
    ) -> None:
        self.http, self.limiter = http, limiter
        # Photos come from the CDN (*.olxcdn.com), not from olx.uz, and there are ~10
        # per ad: spending the 2 s page budget on them would make a first full walk
        # (~15k requests) take about nine hours. They get their own, faster limiter.
        self.photo_limiter = photo_limiter or limiter
        self.max_pages, self.full_walk_every, self.phone_lookup = (
            max_pages,
            full_walk_every,
            phone_lookup,
        )
        self._walks: dict[str, _Walk] = {}
        self._confirmed: dict[str, dict[str, str]] = {}
        # source ids whose `limited-phones/` endpoint answered 403/429 this run
        self._phones_blocked: set[str] = set()

    async def _get(self, url: str, limiter: RateLimiter | None = None) -> HttpResponse:
        await (limiter or self.limiter).wait()
        response = await self.http.get(url)
        if response.status in (403, 429):
            # the shortest sane pause; escalating it across runs is the pipeline's job,
            # since it — not the adapter — owns source.state and sees every call site
            raise AdapterBackoff(
                backoff_delay(0), f"olx http {response.status} from {urlsplit(url).netloc}"
            )
        return response

    async def discover(self, source: Source) -> AsyncIterator[RawRef]:
        base = str(source.config["url"])
        known: dict[str, str] = dict(source.state.get("known", {}))
        run_counter = int(source.state.get("run_counter", 0)) + 1
        walk = _Walk(full=run_counter == 1 or run_counter % self.full_walk_every == 0)
        self._walks[str(source.id)] = walk
        # a fresh confirmation set per pass: a worker registry may share one adapter
        # instance across several sources, and a run that aborts before `seen_window`
        # (an `AdapterBackoff` from a later fetch — `run_source` re-raises it without
        # ever calling `seen_window`) must not let this source's stale confirmations
        # from an earlier attempt survive into this one
        self._confirmed[str(source.id)] = {}
        # and a fresh phone budget: a block is a property of one run, not of the adapter
        self._phones_blocked.discard(str(source.id))
        for page in range(1, self.max_pages + 1):
            url = page_url(base, page)
            response = await self._get(url)
            if response.status == 404:
                if page == 1:
                    # the category URL itself is gone or wrong — a failed run the circuit
                    # breaker must see, not an empty catalogue
                    raise RuntimeError(f"olx list page 1 not found: {url}")
                break
            if response.status != 200:
                raise RuntimeError(f"olx list page {page}: http {response.status}")
            state = extract_state(response.text)
            ads = list_ads(state)
            if not ads:
                break
            fresh = 0
            for ad in ads:
                ext, sig = str(ad["id"]), ad_signature(ad)
                walk.walked[ext] = sig
                posted = ad_time(ad, "createdTime")
                # OLX hoists promoted ads to the top of a created_at:desc list whatever
                # their age, so their timestamps say nothing about how far back the walk
                # reached — they stay in `ids` but never bound the removal window. For
                # the rest prefer lastRefreshTime: the list may be ordered by creation or
                # by last refresh, and since lastRefreshTime >= createdTime for every ad,
                # the minimum last-refresh time of the walked, non-promoted ads is a
                # boundary the walk has fully covered under either ordering.
                if not (ad.get("isPromoted") or ad.get("isHighlighted")):
                    edge = ad_time(ad, "lastRefreshTime") or posted
                    if edge is not None:
                        walk.boundary.append(edge)
                if known.get(ext) != sig:
                    fresh += 1
                    yield RawRef(
                        external_id=ext,
                        url=ad.get("url"),
                        posted_at=posted,
                        meta={"sig": sig, "source_id": str(source.id)},
                    )
            page_number, total_pages = list_pages(state)
            if page_number + 1 >= total_pages:
                break
            if not walk.full and fresh == 0:
                break
        source.state = {**source.state, "run_counter": run_counter}

    def _confirm(self, ref: RawRef) -> None:
        """Record that this ad was handled, so `seen_window` may call it known.

        Only a fetch that came back (or found the ad gone) counts: an ad whose fetch
        failed must stay out of `known` or the next `discover` would skip it until OLX
        happens to change its signature. `fetch_by_url` carries no signature or source
        id and so never touches `known`. Confirmations are filed under the source the
        ref came from (`discover` stashed it in `meta`) so that one adapter instance
        serving several sources cannot mix them up, and `discover` resets each source's
        set at the top of every pass so a stale confirmation can never outlive its run.
        """
        sig, source_id = ref.meta.get("sig"), ref.meta.get("source_id")
        if sig is not None and source_id is not None:
            self._confirmed.setdefault(str(source_id), {})[ref.external_id] = str(sig)

    async def fetch(self, ref: RawRef) -> RawPayload:
        try:
            payload = await self._fetch(ref)
        except ListingGone:
            self._confirm(ref)  # delisted is handled, not failed
            raise
        self._confirm(ref)
        return payload

    async def _fetch(self, ref: RawRef) -> RawPayload:
        if not ref.url:
            raise ListingGone(ref.external_id)
        response = await self._get(ref.url)
        if response.status == 404:
            raise ListingGone(ref.external_id)
        if response.status != 200:
            raise RuntimeError(f"olx detail {ref.url}: http {response.status}")
        ad = detail_ad(extract_state(response.text))
        if ad.get("isActive") is False or ad.get("status") not in (None, "active"):
            raise ListingGone(ref.external_id)
        source_id = ref.meta.get("source_id")
        return ad_to_payload(
            ad, await self._phones(int(ad["id"]), None if source_id is None else str(source_id))
        )

    async def _phones(self, ad_id: int, source_id: str | None) -> list[str]:
        """Best-effort phone reveal (spec §3.3): never raises, whatever goes wrong.

        This endpoint is hit once per ad, so it is the first thing OLX rate-limits. A
        403/429 here used to escape as `AdapterBackoff` and abort the source at its very
        first ad — with `store_raw` never reached, an entire run produced nothing. A
        block now only switches the lookup off for the rest of this source's run (one
        warning); `discover` clears it next run. Page-level 403/429 in `_get`, for list
        and detail pages, still raise `AdapterBackoff` — those really do mean stop.
        """
        if not self.phone_lookup or (source_id is not None and source_id in self._phones_blocked):
            return []
        try:
            response = await self._get(PHONES_URL.format(id=ad_id))
        except AdapterBackoff as backoff:
            if source_id is not None:
                self._phones_blocked.add(source_id)
            log.warning("olx_phones_blocked", ad_id=ad_id, reason=backoff.reason)
            return []
        except Exception as exc:  # noqa: BLE001 — best-effort by design (spec §3.3)
            log.warning("olx_phones_failed", ad_id=ad_id, error=str(exc))
            return []
        if response.status != 200:
            return []
        try:
            phones: Any = json.loads(response.text).get("data", {}).get("phones", [])
        except (ValueError, AttributeError):
            return []
        return [str(p) for p in phones]

    async def fetch_by_url(self, url: str) -> RawPayload:
        """Fetch one pasted ad URL. Rejects anything that is not an ad page, before
        spending a request on it — a category or search URL has no ad id to parse."""
        if _AD_URL.search(urlsplit(url).path) is None:
            raise InvalidListingUrl(f"not an olx ad url: {url}")
        return await self.fetch(RawRef(external_id="", url=url, posted_at=None))

    async def seen_window(self, source: Source) -> SeenWindow | None:
        """Close out the run: settle `source.state["known"]` and report the window.

        Called by `run_source` after the fetch loop, which is the first moment we know
        which of the walked ads were actually handled.
        """
        walk = self._walks.pop(str(source.id), None)
        if walk is None:
            return None
        confirmed = self._confirmed.pop(str(source.id), {})
        known: dict[str, str] = dict(source.state.get("known", {}))
        if walk.full:
            # rebuilt from what is listed now, so delisted ads drop out — and so do ads
            # whose fetch failed, which are then re-yielded next run
            new_known = {
                e: s for e, s in walk.walked.items() if s == known.get(e) or e in confirmed
            }
        else:
            # a partial walk saw only the first pages; everything else keeps what it had
            new_known = {**known, **confirmed}
        source.state = {**source.state, "known": new_known}
        return SeenWindow(
            ids=set(walk.walked), oldest_posted_at=min(walk.boundary) if walk.boundary else None
        )

    async def download_photo(self, ref: Any) -> bytes:
        response = await self._get(str(ref), self.photo_limiter)
        if response.status != 200:
            raise RuntimeError(f"photo {ref}: http {response.status}")
        return response.content

    async def rebuild_payload(self, raw: RawListing) -> RawPayload:
        return ad_to_payload(raw.payload["ad"], list(raw.payload.get("phones", [])))

    async def aclose(self) -> None:
        await self.http.aclose()
