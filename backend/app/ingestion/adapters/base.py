from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any, Protocol

from app.modules.listings.models import RawListing, Source
from app.modules.listings.service import SeenWindow


@dataclass
class RawRef:
    """A lightweight reference to one post/listing, as yielded by `discover`.

    `meta` is adapter-private scratch data (e.g. a message object, an API cursor) that
    `discover` stashes here for `fetch` to read back; the pipeline never inspects it.
    `posted_at`, when set, must be timezone-aware — `recompute` orders listings by
    `posted_at` alongside other timezone-aware timestamps, and mixing naive and aware
    datetimes raises.
    """

    external_id: str
    url: str | None
    posted_at: datetime | None
    meta: dict[str, Any] = field(default_factory=dict)


@dataclass
class RawPayload:
    """The fully fetched content for one `RawRef`, as returned by `fetch`.

    `photo_refs` entries are opaque to the pipeline: each one is handed back verbatim
    to `download_photo`, which alone knows how to resolve it to bytes. `posted_at` must
    be timezone-aware, for the same reason as `RawRef.posted_at`.
    """

    external_id: str
    url: str | None
    posted_at: datetime | None
    text: str
    structured: dict[str, Any] | None
    sender_username: str | None
    contact_hints: list[tuple[str, str]]
    photo_refs: list[Any]
    payload: dict[str, Any]


class AdapterBackoff(Exception):  # noqa: N818 — name is a fixed public contract, not "*Error"
    """The source asked us to slow down (HTTP 429/403, Telegram FloodWait).

    Pause, do not count a failure.
    """

    def __init__(self, retry_after: timedelta, reason: str) -> None:
        super().__init__(reason)
        self.retry_after = retry_after
        self.reason = reason


class LoginRequired(Exception):  # noqa: N818 — name is a fixed public contract, not "*Error"
    """The adapter's credentials/session are no longer valid; a human must log in again."""


class ListingGone(Exception):  # noqa: N818 — name is a fixed public contract, not "*Error"
    """`fetch` found that the listing no longer exists at the source (404, deactivated)."""


class SourceAdapter(Protocol):
    """A source-specific integration (Telegram, OLX, ...) the ingestion pipeline drives.

    Implementations that need to remember progress (cursors, last-seen ids, ...) do so
    on `source.state`. `state` is a JSONB column, and SQLAlchemy does not track in-place
    mutation of dict/list values on it — an implementation MUST reassign a new dict
    (e.g. `source.state = {**source.state, "cursor": next_cursor}`), never mutate the
    existing dict in place, or the change silently will not be persisted.
    """

    kind: str

    def discover(self, source: Source) -> AsyncIterator[RawRef]:
        """Yield one `RawRef` per post/listing currently worth fetching for `source`.

        Need not be exhaustive of all history visible to the source; `seen_window`
        separately scopes what counts as "currently visible" for removal detection.
        """
        ...

    async def fetch(self, ref: RawRef) -> RawPayload:
        """Fetch the full payload for a `RawRef` previously yielded by `discover`."""
        ...

    async def seen_window(self, source: Source) -> SeenWindow | None:
        """Report which external ids are currently visible, for removal detection.

        Returning `None`, or a `SeenWindow` with `oldest_posted_at=None`, disables
        removal detection for this run: no listing is counted as missed or flagged
        source_removed. Return a real window only when the adapter is confident it has
        seen every post from `oldest_posted_at` onward.
        """
        ...

    async def download_photo(self, ref: Any) -> bytes:
        """Resolve one `photo_refs` entry (handed back verbatim) to raw image bytes."""
        ...

    async def rebuild_payload(self, raw: RawListing) -> RawPayload:
        """Rebuild the `RawPayload` from `raw.payload` (stored verbatim).

        Used by `reparse`; never touches the network.
        """
        ...


__all__ = [
    "AdapterBackoff",
    "ListingGone",
    "LoginRequired",
    "RawPayload",
    "RawRef",
    "SeenWindow",
    "SourceAdapter",
]
