"""Listings the team adds by hand: a pasted OLX/Telegram link, or a short form."""

import uuid
from collections.abc import AsyncIterator
from datetime import datetime
from pathlib import Path
from typing import TYPE_CHECKING, Any, Literal
from urllib.parse import urlsplit

from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ingestion.adapters.base import InvalidListingUrl, RawPayload, RawRef
from app.ingestion.parse import normalize_phone
from app.ingestion.pipeline import IngestResult, ingest_payload
from app.modules.dedupe.config import DedupeConfig
from app.modules.listings.models import RawListing, Source
from app.modules.listings.service import SeenWindow

if TYPE_CHECKING:  # the registry imports this module; import it for typing only
    from app.ingestion.registry import AdapterRegistry

HOST_KINDS = {"olx.uz": "olx", "www.olx.uz": "olx", "t.me": "telegram"}


class ManualAdapter:
    kind = "manual"

    def __init__(self, photos: dict[str, bytes] | None = None) -> None:
        self.photos = photos or {}

    async def discover(self, source: Source) -> AsyncIterator[RawRef]:
        return
        yield  # pragma: no cover — an async generator that yields nothing

    async def fetch(self, ref: RawRef) -> RawPayload:
        raise RuntimeError("manual listings are not fetched")

    async def seen_window(self, source: Source) -> SeenWindow | None:
        return None

    async def download_photo(self, ref: Any) -> bytes:
        return self.photos[str(ref)]

    async def rebuild_payload(self, raw: RawListing) -> RawPayload:
        p = raw.payload
        # Filter to the form's own fields explicitly, rather than naming the extra keys
        # (`photo_count`, `posted_at`) to drop — the round trip must not depend on
        # pydantic's default `extra="ignore"` silently swallowing whatever isn't listed.
        form = ManualListingForm.model_validate(
            {k: v for k, v in p.items() if k in ManualListingForm.model_fields}
        )
        return form_payload(
            raw.external_id,
            form,
            int(p.get("photo_count", 0)),
            datetime.fromisoformat(p["posted_at"]),
        )


class ManualListingForm(BaseModel):
    title: str
    description: str = ""
    price_amount_minor: int | None = None
    price_currency: Literal["USD", "UZS"] | None = None
    rooms: int | None = None
    floor: int | None = None
    total_floors: int | None = None
    area_sqm: float | None = None
    district: str | None = None
    phone: str | None = None


def form_payload(
    external_id: str, form: ManualListingForm, photo_count: int, now: datetime
) -> RawPayload:
    structured = {
        k: v for k, v in form.model_dump(exclude={"phone", "description"}).items() if v is not None
    }
    e164 = normalize_phone(form.phone) if form.phone else None
    return RawPayload(
        external_id=external_id,
        url=None,
        posted_at=now,
        text=f"{form.title}\n{form.description}".strip(),
        structured=structured,
        sender_username=None,
        contact_hints=[("phone", e164)] if e164 else [],
        photo_refs=[str(i) for i in range(photo_count)],
        payload={**form.model_dump(), "photo_count": photo_count, "posted_at": now.isoformat()},
    )


async def ensure_manual_source(session: AsyncSession) -> Source:
    source = (
        await session.execute(select(Source).where(Source.kind == "manual"))
    ).scalar_one_or_none()
    if source is None:
        source = Source(kind="manual", name="manual", config={}, enabled=False)
        session.add(source)
        await session.flush()
    return source


async def pick_source(session: AsyncSession, kind: str) -> Source | None:
    stmt = (
        select(Source)
        .where(Source.kind == kind, Source.enabled.is_(True))
        .order_by(Source.created_at)
        .limit(1)
    )
    return (await session.execute(stmt)).scalar_one_or_none()


async def _with_raw(session: AsyncSession, result: IngestResult) -> IngestResult:
    """Load `result.listing.raw` before returning.

    `ingest_payload` never populates it (see `IngestResult` in `pipeline.py`), and a
    manual-ingest result is exactly the kind of one-off object a human (CLI output, a
    UI response) inspects right away via plain attribute access — outside an `await`,
    which would hit SQLAlchemy's `MissingGreenlet`. Load it now, while awaited.
    """
    await session.refresh(result.listing, ["raw"])
    return result


async def ingest_url(
    session: AsyncSession,
    url: str,
    registry: "AdapterRegistry",
    *,
    cfg: DedupeConfig,
    photo_dir: Path,
    now: datetime,
) -> IngestResult:
    host = urlsplit(url).netloc.lower()
    kind = HOST_KINDS.get(host)
    if kind is None:
        raise InvalidListingUrl(f"unsupported url: {url}")
    adapter: Any = registry.get(kind)
    payload = await adapter.fetch_by_url(url)
    source = await pick_source(session, kind) or await ensure_manual_source(session)
    # Attributed to the crawled source (so a later crawl of the same ad updates this row
    # instead of storing a duplicate) but marked `manual`: the crawler never walked it,
    # so the removal sweep must not count it as missed until a crawl actually reaches it.
    result = await ingest_payload(
        session,
        source,
        payload,
        adapter=adapter,
        cfg=cfg,
        photo_dir=photo_dir,
        now=now,
        ingested_via="manual",
    )
    return await _with_raw(session, result)


async def ingest_form(
    session: AsyncSession,
    form: ManualListingForm,
    photos: list[bytes],
    *,
    cfg: DedupeConfig,
    photo_dir: Path,
    now: datetime,
) -> IngestResult:
    source = await ensure_manual_source(session)
    payload = form_payload("form:" + uuid.uuid4().hex, form, len(photos), now)
    adapter = ManualAdapter({str(i): data for i, data in enumerate(photos)})
    result = await ingest_payload(
        session,
        source,
        payload,
        adapter=adapter,
        cfg=cfg,
        photo_dir=photo_dir,
        now=now,
        ingested_via="manual",
    )
    return await _with_raw(session, result)
