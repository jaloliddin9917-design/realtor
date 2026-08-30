"""A minimal Telegram client surface so the adapter is testable without Telethon."""

from collections.abc import AsyncIterator
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any, Protocol

from app.core.settings import Settings
from app.ingestion.adapters.base import AdapterBackoff, LoginRequired


@dataclass
class TgMessage:
    id: int
    date: datetime
    text: str
    grouped_id: int | None
    has_photo: bool
    edit_date: datetime | None
    sender_id: int | None
    sender_username: str | None


class TelegramClientLike(Protocol):
    async def connect(self) -> None: ...

    async def is_user_authorized(self) -> bool: ...

    async def resolve_peer(self, peer: str | int) -> tuple[int, str | None]: ...

    def iter_messages(
        self,
        chat_id: int,
        *,
        min_id: int = 0,
        offset_date: datetime | None = None,
        reverse: bool = False,
        limit: int | None = None,
    ) -> AsyncIterator[TgMessage]: ...

    async def get_messages(self, chat_id: int, ids: list[int]) -> list[TgMessage]: ...

    async def download_photo(self, chat_id: int, message_id: int) -> bytes: ...


def marked_chat_id(entity: Any) -> int:
    """Telethon's marked id: users unchanged, basic groups -id, channels/megagroups -(10**12+id)."""
    from telethon import utils

    return int(utils.get_peer_id(entity, add_mark=True))


def _to_msg(message: Any) -> TgMessage:
    sender = getattr(message, "sender", None)
    date = message.date if message.date.tzinfo else message.date.replace(tzinfo=UTC)
    edit = message.edit_date
    return TgMessage(
        id=int(message.id),
        date=date,
        text=message.message or "",
        grouped_id=int(message.grouped_id) if message.grouped_id else None,
        has_photo=message.photo is not None,
        edit_date=(edit if edit is None or edit.tzinfo else edit.replace(tzinfo=UTC)),
        sender_id=int(message.sender_id) if message.sender_id is not None else None,
        sender_username=getattr(sender, "username", None),
    )


class TelethonClient:
    """Wraps `telethon.TelegramClient`; translates its errors into adapter exceptions."""

    def __init__(self, session_path: str, api_id: int, api_hash: str) -> None:
        from telethon import TelegramClient

        self._client = TelegramClient(session_path, api_id, api_hash)
        self._entities: dict[int, Any] = {}

    async def connect(self) -> None:
        await self._client.connect()

    async def is_user_authorized(self) -> bool:
        """Probe authorization via `get_me()` rather than `is_user_authorized()`.

        Telethon's `is_user_authorized()` catches every `RPCError` (including
        `FloodWaitError`) internally and returns False, so a flood wait during
        the probe would masquerade as `LoginRequired`. `get_me()` only catches
        `UnauthorizedError` and returns None in that case; any other RPC error
        (notably `FloodWaitError`) propagates to `_guard`/`_translate`, which
        turns it into `AdapterBackoff` instead of a false login failure.
        """
        me = await self._guard(self._client.get_me())
        return me is not None

    async def resolve_peer(self, peer: str | int) -> tuple[int, str | None]:
        entity = await self._guard(self._client.get_entity(peer))
        chat_id = marked_chat_id(entity)
        self._entities[chat_id] = entity
        return chat_id, getattr(entity, "username", None)

    async def iter_messages(
        self,
        chat_id: int,
        *,
        min_id: int = 0,
        offset_date: datetime | None = None,
        reverse: bool = False,
        limit: int | None = None,
    ) -> AsyncIterator[TgMessage]:
        entity = self._entities.get(chat_id, chat_id)
        try:
            async for message in self._client.iter_messages(
                entity, min_id=min_id, offset_date=offset_date, reverse=reverse, limit=limit
            ):
                yield _to_msg(message)
        except Exception as exc:  # noqa: BLE001
            raise _translate(exc) from exc

    async def get_messages(self, chat_id: int, ids: list[int]) -> list[TgMessage]:
        entity = self._entities.get(chat_id, chat_id)
        messages = await self._guard(self._client.get_messages(entity, ids=ids))
        return [_to_msg(m) for m in messages if m is not None]

    async def download_photo(self, chat_id: int, message_id: int) -> bytes:
        entity = self._entities.get(chat_id, chat_id)
        [message] = await self._guard(self._client.get_messages(entity, ids=[message_id]))
        data = await self._guard(self._client.download_media(message, file=bytes))
        if not isinstance(data, bytes):
            raise RuntimeError(f"no media on message {message_id}")
        return data

    async def _guard(self, awaitable: Any) -> Any:
        try:
            return await awaitable
        except Exception as exc:  # noqa: BLE001
            raise _translate(exc) from exc

    async def login_interactive(self) -> None:
        await self._client.start()  # prompts for phone, code and 2FA password on the terminal


def _translate(exc: Exception) -> Exception:
    from telethon import errors

    if isinstance(exc, errors.FloodWaitError):
        return AdapterBackoff(timedelta(seconds=int(exc.seconds)), "telegram flood wait")
    if isinstance(
        exc,
        errors.AuthKeyUnregisteredError
        | errors.SessionRevokedError
        | errors.UserDeactivatedBanError
        | errors.UnauthorizedError,
    ):
        return LoginRequired(str(exc))
    return exc


def make_client(settings: Settings) -> TelethonClient:
    settings.telegram_session_path.parent.mkdir(parents=True, exist_ok=True)
    return TelethonClient(
        str(settings.telegram_session_path), settings.telegram_api_id, settings.telegram_api_hash
    )
