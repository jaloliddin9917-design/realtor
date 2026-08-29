"""OLX.uz adapter — list pages for discovery, detail pages for the canonical payload."""

import json
import uuid
from collections.abc import AsyncIterator
from datetime import datetime
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import structlog

from app.ingestion.adapters.base import AdapterBackoff, ListingGone, RawPayload, RawRef
from app.ingestion.adapters.olx.state import (
    ad_signature,
    ad_to_payload,
    detail_ad,
    extract_state,
    list_ads,
    list_pages,
)
from app.ingestion.http import (
    HttpClient,
    HttpResponse,
    RateLimiter,
    backoff_delay,
    bump_backoff,
    reset_backoff,
)
from app.modules.listings.models import RawListing, Source
from app.modules.listings.service import SeenWindow

log = structlog.get_logger()
PHONES_URL = "https://www.olx.uz/api/v1/offers/{id}/limited-phones/"


def page_url(base: str, page: int) -> str:
    parts = urlsplit(base)
    query = [(k, v) for k, v in parse_qsl(parts.query, keep_blank_values=True) if k != "page"]
    if page > 1:
        query.append(("page", str(page)))
    # safe=":" — urlencode's default quoting escapes ":" to "%3A", which would mangle
    # OLX's own query values (e.g. "created_at:desc") on every call, including a no-op
    # page=1. Both forms are equivalent over HTTP, but leaving ":" alone matches what a
    # browser sends and keeps the URL stable when nothing actually changed.
    encoded = urlencode(query, safe=":")
    return urlunsplit((parts.scheme, parts.netloc, parts.path, encoded, parts.fragment))


class OlxAdapter:
    kind = "olx"

    def __init__(
        self,
        http: HttpClient,
        limiter: RateLimiter,
        *,
        max_pages: int = 25,
        full_walk_every: int = 4,
        phone_lookup: bool = True,
    ) -> None:
        self.http, self.limiter = http, limiter
        self.max_pages, self.full_walk_every, self.phone_lookup = (
            max_pages,
            full_walk_every,
            phone_lookup,
        )
        self._windows: dict[uuid.UUID, SeenWindow] = {}

    async def _get(self, url: str, source: Source | None = None) -> HttpResponse:
        await self.limiter.wait()
        response = await self.http.get(url)
        if response.status in (403, 429):
            if source is not None:
                _, delay = bump_backoff(source)
            else:
                delay = backoff_delay(0)
            raise AdapterBackoff(delay, f"olx http {response.status}")
        return response

    async def discover(self, source: Source) -> AsyncIterator[RawRef]:
        base = str(source.config["url"])
        known: dict[str, str] = dict(source.state.get("known", {}))
        run_counter = int(source.state.get("run_counter", 0)) + 1
        full_walk = run_counter == 1 or run_counter % self.full_walk_every == 0
        new_known: dict[str, str] = {}
        ids: set[str] = set()
        created: list[datetime] = []
        for page in range(1, self.max_pages + 1):
            response = await self._get(page_url(base, page), source)
            if response.status == 404:
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
                new_known[ext] = sig
                ids.add(ext)
                posted = (
                    datetime.fromisoformat(ad["createdTime"]) if ad.get("createdTime") else None
                )
                if posted is not None:
                    created.append(posted)
                if known.get(ext) != sig:
                    fresh += 1
                    yield RawRef(
                        external_id=ext, url=ad.get("url"), posted_at=posted, meta={"sig": sig}
                    )
            page_number, total_pages = list_pages(state)
            if page_number + 1 >= total_pages:
                break
            if not full_walk and fresh == 0:
                break
        self._windows[source.id] = SeenWindow(
            ids=ids, oldest_posted_at=min(created) if created else None
        )
        source.state = {
            **source.state,
            "known": {**known, **new_known} if not full_walk else new_known,
            "run_counter": run_counter,
        }
        reset_backoff(source)

    async def fetch(self, ref: RawRef) -> RawPayload:
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
        return ad_to_payload(ad, await self._phones(int(ad["id"])))

    async def _phones(self, ad_id: int) -> list[str]:
        if not self.phone_lookup:
            return []
        try:
            response = await self._get(PHONES_URL.format(id=ad_id))
        except AdapterBackoff:
            raise
        except Exception as exc:  # noqa: BLE001 — best-effort by design (spec §3.3)
            log.info("olx_phones_failed", ad_id=ad_id, error=str(exc))
            return []
        if response.status != 200:
            return []
        try:
            phones: Any = json.loads(response.text).get("data", {}).get("phones", [])
        except (ValueError, AttributeError):
            return []
        return [str(p) for p in phones]

    async def fetch_by_url(self, url: str) -> RawPayload:
        return await self.fetch(RawRef(external_id="", url=url, posted_at=None))

    async def seen_window(self, source: Source) -> SeenWindow | None:
        return self._windows.pop(source.id, None)

    async def download_photo(self, ref: Any) -> bytes:
        response = await self._get(str(ref))
        if response.status != 200:
            raise RuntimeError(f"photo {ref}: http {response.status}")
        return response.content

    async def rebuild_payload(self, raw: RawListing) -> RawPayload:
        return ad_to_payload(raw.payload["ad"], list(raw.payload.get("phones", [])))
