"""Test doubles shared by pipeline, worker and CLI tests."""

from collections.abc import AsyncIterator, Callable
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.ingestion.adapters.base import (
    AdapterBackoff,
    ListingGone,
    LoginRequired,
    RawPayload,
    RawRef,
)
from app.modules.listings.models import RawListing, Source
from app.modules.listings.service import SeenWindow
from tests.helpers import make_jpeg

NOW = datetime(2026, 8, 29, 12, 0, tzinfo=UTC)


def payload(
    ext: str,
    text: str,
    posted: datetime = NOW,
    photos: list[Any] | None = None,
    username: str | None = None,
    structured: dict[str, Any] | None = None,
) -> RawPayload:
    return RawPayload(
        external_id=ext,
        url=f"https://t.me/t/{ext}",
        posted_at=posted,
        text=text,
        structured=structured,
        sender_username=username,
        contact_hints=[],
        photo_refs=photos or [],
        payload={
            "text": text,
            "id": ext,
            "posted": posted.isoformat(),
            "photos": photos or [],
            "username": username,
        },
    )


class FakeAdapter:
    kind = "telegram"

    def __init__(
        self,
        payloads: list[RawPayload],
        window: SeenWindow | None,
        fail_ids: set[str] | None = None,
        gone_ids: set[str] | None = None,
        backoff_on_discover: timedelta | None = None,
        login_required: bool = False,
        bad_photo_refs: set[str] | None = None,
    ) -> None:
        self.payloads = payloads
        self.window = window
        self.fail_ids = fail_ids or set()
        self.gone_ids = gone_ids or set()
        self.backoff_on_discover = backoff_on_discover
        self.login_required = login_required
        self.bad_photo_refs = bad_photo_refs if bad_photo_refs is not None else {"bad"}
        self.downloads = 0

    async def discover(self, source: Source) -> AsyncIterator[RawRef]:
        if self.login_required:
            raise LoginRequired("session revoked")
        if self.backoff_on_discover is not None:
            raise AdapterBackoff(self.backoff_on_discover, "flood wait")
        for p in self.payloads:
            yield RawRef(external_id=p.external_id, url=p.url, posted_at=p.posted_at, meta={})

    async def fetch(self, ref: RawRef) -> RawPayload:
        if ref.external_id in self.gone_ids:
            raise ListingGone(ref.external_id)
        if ref.external_id in self.fail_ids:
            raise RuntimeError("boom")
        return next(p for p in self.payloads if p.external_id == ref.external_id)

    async def seen_window(self, source: Source) -> SeenWindow | None:
        return self.window

    async def download_photo(self, ref: Any) -> bytes:
        self.downloads += 1
        if ref in self.bad_photo_refs:
            raise RuntimeError("404")
        try:
            seed = int(ref)
        except (TypeError, ValueError):
            seed = abs(hash(ref)) % 997
        return make_jpeg(300, 200, seed)

    async def rebuild_payload(self, raw: RawListing) -> RawPayload:
        p = raw.payload
        return payload(
            p["id"],
            p["text"],
            datetime.fromisoformat(p["posted"]),
            p.get("photos"),
            p.get("username"),
        )


async def savepoint_session_factory(db: AsyncSession) -> Callable[[], AsyncSession]:
    """Build a session factory bound to `db`'s own connection.

    A worker's `commit()` then only releases a savepoint
    (`join_transaction_mode="create_savepoint"`), and the test's outer transaction still
    rolls everything back at teardown (see `tests/conftest.py`).
    """
    conn = await db.connection()

    def factory() -> AsyncSession:
        return AsyncSession(
            bind=conn, expire_on_commit=False, join_transaction_mode="create_savepoint"
        )

    return factory
