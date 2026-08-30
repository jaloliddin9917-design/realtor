"""Telegram adapter: public channels or groups the team account can read."""

import re
import uuid
from collections.abc import AsyncIterator, Callable
from datetime import UTC, datetime, timedelta
from typing import Any

from app.ingestion.adapters.base import LoginRequired, RawPayload, RawRef
from app.ingestion.adapters.telegram.client import TelegramClientLike, TgMessage
from app.modules.listings.models import RawListing, Source
from app.modules.listings.service import SeenWindow

_TME = re.compile(r"^(?:https?://)?t\.me/(?:s/)?([A-Za-z0-9_]{5,32})/(\d+)(?:[?#].*)?$")


def parse_message_link(url: str) -> tuple[str, int]:
    """`t.me/<channel>/<id>` in the forms people paste: with or without scheme, `t.me/s/…`,
    a trailing `?single` / `#`."""
    m = _TME.match(url.strip())
    if m is None:
        raise ValueError(f"not a t.me message link: {url}")
    return m.group(1), int(m.group(2))


class TelegramAdapter:
    kind = "telegram"

    def __init__(
        self,
        client: TelegramClientLike,
        *,
        backfill_days: int = 14,
        rescan_limit: int = 200,
        now: Callable[[], datetime] = lambda: datetime.now(UTC),
    ) -> None:
        self.client, self.backfill_days, self.rescan_limit, self._now = (
            client,
            backfill_days,
            rescan_limit,
            now,
        )
        self._windows: dict[uuid.UUID, SeenWindow] = {}
        self._ready = False

    async def _ensure_ready(self) -> None:
        if not self._ready:
            await self.client.connect()
            self._ready = True
        if not await self.client.is_user_authorized():
            raise LoginRequired("telegram session is not authorized")

    async def resolve_peer(self, peer: str | int) -> tuple[int, str | None]:
        """Validate a peer (`@channel`, `t.me/channel`, id) the way `discover` will use it."""
        await self._ensure_ready()
        return await self.client.resolve_peer(peer)

    async def _resolve(self, source: Source) -> tuple[int, str | None]:
        chat_id, username = await self.client.resolve_peer(source.config["peer"])
        if source.state.get("chat_id") != chat_id or source.state.get("username") != username:
            source.state = {**source.state, "chat_id": chat_id, "username": username}
        return chat_id, username

    @staticmethod
    def _groups(messages: list[TgMessage]) -> list[list[TgMessage]]:
        groups: list[list[TgMessage]] = []
        by_album: dict[int, list[TgMessage]] = {}
        for m in messages:
            if m.grouped_id is None:
                groups.append([m])
            elif m.grouped_id in by_album:
                by_album[m.grouped_id].append(m)
            else:
                by_album[m.grouped_id] = [m]
                groups.append(by_album[m.grouped_id])
        return groups

    def _ref(self, chat_id: int, username: str | None, group: list[TgMessage]) -> RawRef:
        first = group[0]
        url = f"https://t.me/{username}/{first.id}" if username else None
        return RawRef(
            external_id=f"{chat_id}:{first.id}",
            url=url,
            posted_at=first.date,
            meta={
                "chat_id": chat_id,
                "username": username,
                "messages": [m.__dict__ for m in group],
            },
        )

    async def discover(self, source: Source) -> AsyncIterator[RawRef]:
        await self._ensure_ready()
        chat_id, username = await self._resolve(source)
        last_id = int(source.state.get("last_message_id", 0))
        last_run = source.state.get("last_run_at")
        last_run_at = datetime.fromisoformat(last_run) if last_run else None
        now = self._now()

        new_messages: list[TgMessage] = []
        if last_id:
            async for m in self.client.iter_messages(chat_id, min_id=last_id, reverse=True):
                new_messages.append(m)
        else:
            since = now - timedelta(days=self.backfill_days)
            async for m in self.client.iter_messages(chat_id, offset_date=since, reverse=True):
                new_messages.append(m)
        yielded: set[str] = set()
        for group in self._groups(new_messages):
            ref = self._ref(chat_id, username, group)
            yielded.add(ref.external_id)
            yield ref

        recent: list[TgMessage] = []
        async for m in self.client.iter_messages(chat_id, limit=self.rescan_limit):
            recent.append(m)
        recent_groups = self._groups(sorted(recent, key=lambda m: m.id))
        ids: set[str] = set()
        oldest: datetime | None = None
        for group in recent_groups:
            ref = self._ref(chat_id, username, group)
            ids.add(ref.external_id)
            oldest = group[0].date if oldest is None or group[0].date < oldest else oldest
            edited = any(m.edit_date and last_run_at and m.edit_date > last_run_at for m in group)
            if edited and ref.external_id not in yielded:
                yielded.add(ref.external_id)
                yield ref
        self._windows[source.id] = SeenWindow(ids=ids, oldest_posted_at=oldest)

        max_id = max([m.id for m in new_messages] + [m.id for m in recent] + [last_id])
        source.state = {**source.state, "last_message_id": max_id, "last_run_at": now.isoformat()}

    async def fetch(self, ref: RawRef) -> RawPayload:
        chat_id, username = int(ref.meta["chat_id"]), ref.meta.get("username")
        messages = [TgMessage(**m) for m in ref.meta["messages"]]
        return self._payload(chat_id, username, messages)

    def _payload(self, chat_id: int, username: str | None, messages: list[TgMessage]) -> RawPayload:
        first = messages[0]
        text = next((m.text for m in messages if m.text.strip()), "")
        sender_username = (
            next((m.sender_username for m in messages if m.sender_username), None) or username
        )
        photo_ids = [m.id for m in messages if m.has_photo]
        edit = max((m.edit_date for m in messages if m.edit_date), default=None)
        return RawPayload(
            external_id=f"{chat_id}:{first.id}",
            url=f"https://t.me/{username}/{first.id}" if username else None,
            posted_at=first.date,
            text=text,
            structured=None,
            sender_username=sender_username,
            contact_hints=[],
            photo_refs=[{"chat_id": chat_id, "message_id": mid} for mid in photo_ids],
            payload={
                "chat_id": chat_id,
                "username": username,
                "message_ids": [m.id for m in messages],
                "text": text,
                "date": first.date.isoformat(),
                "edit_date": edit.isoformat() if edit else None,
                "sender_id": first.sender_id,
                "sender_username": sender_username,
                "photo_message_ids": photo_ids,
            },
        )

    async def fetch_by_url(self, url: str) -> RawPayload:
        username, message_id = parse_message_link(url)
        await self._ensure_ready()
        chat_id, resolved_username = await self.client.resolve_peer("@" + username)
        messages = await self.client.get_messages(chat_id, [message_id])
        if not messages:
            raise ValueError(f"message not found: {url}")
        anchor = messages[0]
        group = [anchor]
        if anchor.grouped_id is not None:
            siblings = await self.client.get_messages(
                chat_id, list(range(anchor.id - 9, anchor.id + 10))
            )
            group = sorted(
                [m for m in siblings if m.grouped_id == anchor.grouped_id], key=lambda m: m.id
            )
        return self._payload(chat_id, resolved_username, group)

    async def seen_window(self, source: Source) -> SeenWindow | None:
        return self._windows.pop(source.id, None)

    async def download_photo(self, ref: Any) -> bytes:
        return await self.client.download_photo(int(ref["chat_id"]), int(ref["message_id"]))

    async def aclose(self) -> None:
        await self.client.disconnect()
        self._ready = False

    async def rebuild_payload(self, raw: RawListing) -> RawPayload:
        p = raw.payload
        photo_ids = set(p.get("photo_message_ids", []))
        first_date = datetime.fromisoformat(p["date"])
        messages = [
            TgMessage(
                id=mid,
                date=first_date,
                text=p["text"] if i == 0 else "",
                grouped_id=None if len(p["message_ids"]) == 1 else 1,
                has_photo=mid in photo_ids,
                edit_date=datetime.fromisoformat(p["edit_date"]) if p.get("edit_date") else None,
                sender_id=p.get("sender_id"),
                sender_username=p.get("sender_username"),
            )
            for i, mid in enumerate(p["message_ids"])
        ]
        return self._payload(int(p["chat_id"]), p.get("username"), messages)
