from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Protocol

from app.modules.listings.models import Source
from app.modules.listings.service import SeenWindow


@dataclass
class RawRef:
    external_id: str
    url: str | None
    posted_at: datetime | None
    meta: dict[str, Any] = field(default_factory=dict)


@dataclass
class RawPayload:
    external_id: str
    url: str | None
    posted_at: datetime | None
    text: str
    structured: dict[str, Any] | None
    sender_username: str | None
    contact_hints: list[tuple[str, str]]
    photo_refs: list[Any]
    payload: dict[str, Any]


class SourceAdapter(Protocol):
    kind: str

    def discover(self, source: Source) -> AsyncIterator[RawRef]: ...

    async def fetch(self, ref: RawRef) -> RawPayload: ...

    async def seen_window(self, source: Source) -> SeenWindow | None: ...

    async def download_photo(self, ref: Any) -> bytes: ...


__all__ = ["RawPayload", "RawRef", "SeenWindow", "SourceAdapter"]
