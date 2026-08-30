import json
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

from app.ingestion.adapters.base import InvalidListingUrl, ListingGone, LoginRequired
from app.ingestion.adapters.telegram import TelegramAdapter
from app.ingestion.adapters.telegram.client import TgMessage
from app.modules.listings.models import RawListing, Source

FIX = Path(__file__).parent / "fixtures" / "telegram" / "messages.json"
NOW = datetime(2026, 8, 30, 12, 0, tzinfo=UTC)


def _messages() -> list[TgMessage]:
    out = []
    for m in json.loads(FIX.read_text()):
        out.append(
            TgMessage(
                id=m["id"],
                date=datetime.fromisoformat(m["date"]),
                text=m["text"],
                grouped_id=m["grouped_id"],
                has_photo=m["has_photo"],
                edit_date=datetime.fromisoformat(m["edit_date"]) if m["edit_date"] else None,
                sender_id=m["sender_id"],
                sender_username=m["sender_username"],
            )
        )
    return out


class FakeClient:
    def __init__(self, messages: list[TgMessage], *, authorized: bool = True) -> None:
        self.messages = sorted(messages, key=lambda m: m.id)
        self.authorized = authorized
        self.connected = False
        self.downloads: list[tuple[int, int]] = []

    async def connect(self) -> None:
        self.connected = True

    async def disconnect(self) -> None:
        self.connected = False

    async def is_user_authorized(self) -> bool:
        return self.authorized

    async def resolve_peer(self, peer: str | int) -> tuple[int, str | None]:
        return (-1001234, "toshkent_ijara") if peer == "@toshkent_ijara" else (-1009999, None)

    async def iter_messages(
        self,
        chat_id: int,
        *,
        min_id: int = 0,
        offset_date: datetime | None = None,
        reverse: bool = False,
        limit: int | None = None,
    ) -> AsyncIterator[TgMessage]:
        msgs = [
            m
            for m in self.messages
            if m.id > min_id and (offset_date is None or m.date > offset_date)
        ]
        msgs = msgs if reverse else list(reversed(msgs))
        for m in msgs[: limit or None]:
            yield m

    async def get_messages(self, chat_id: int, ids: list[int]) -> list[TgMessage]:
        return [m for m in self.messages if m.id in ids]

    async def download_photo(self, chat_id: int, message_id: int) -> bytes:
        self.downloads.append((chat_id, message_id))
        return b"\xff\xd8" + bytes([message_id % 256]) * 16


def _source(state: dict | None = None) -> Source:  # type: ignore[type-arg]
    return Source(
        kind="telegram",
        name="@toshkent_ijara",
        config={"peer": "@toshkent_ijara"},
        state=state or {},
    )


async def test_first_run_backfills_and_groups_albums() -> None:
    client = FakeClient(_messages())
    adapter = TelegramAdapter(client, backfill_days=14, rescan_limit=200, now=lambda: NOW)  # type: ignore[arg-type]
    source = _source()
    refs = [r async for r in adapter.discover(source)]
    assert [r.external_id for r in refs] == [
        "-1001234:101",
        "-1001234:103",
        "-1001234:104",
        "-1001234:105",
    ]
    assert (
        refs[0].posted_at == datetime(2026, 8, 28, 9, 0, tzinfo=UTC)
        and refs[0].url == "https://t.me/toshkent_ijara/101"
    )
    assert (
        source.state["chat_id"] == -1001234
        and source.state["last_message_id"] == 105
        and source.state["username"] == "toshkent_ijara"
    )
    window = await adapter.seen_window(source)
    assert window is not None and window.ids == {
        "-1001234:101",
        "-1001234:103",
        "-1001234:104",
        "-1001234:105",
    }
    assert window.oldest_posted_at == datetime(2026, 8, 28, 9, 0, tzinfo=UTC)


async def test_fetch_builds_payload_with_album_photos_and_username() -> None:
    client = FakeClient(_messages())
    adapter = TelegramAdapter(client, now=lambda: NOW)  # type: ignore[arg-type]
    source = _source()
    refs = {r.external_id: r async for r in adapter.discover(source)}
    album = await adapter.fetch(refs["-1001234:101"])
    assert album.text.startswith("Chilonzor, Qatortol") and album.photo_refs == [
        {"chat_id": -1001234, "message_id": 101},
        {"chat_id": -1001234, "message_id": 102},
    ]
    assert album.sender_username == "toshkent_ijara" and album.payload["message_ids"] == [101, 102]
    plain = await adapter.fetch(refs["-1001234:103"])
    assert plain.sender_username == "dilshod_uy" and plain.photo_refs == []
    photo_only = await adapter.fetch(refs["-1001234:105"])
    assert photo_only.text == "" and photo_only.photo_refs == [
        {"chat_id": -1001234, "message_id": 105}
    ]
    assert await adapter.download_photo(album.photo_refs[1]) == b"\xff\xd8" + bytes([102]) * 16


async def test_second_run_yields_only_new_and_edited() -> None:
    client = FakeClient(_messages())
    adapter = TelegramAdapter(client, now=lambda: NOW)  # type: ignore[arg-type]
    source = _source()
    _ = [r async for r in adapter.discover(source)]
    # nothing new; message 104 was edited after the last run → it is re-yielded
    source.state = {**source.state, "last_run_at": (NOW - timedelta(days=2)).isoformat()}
    again = [r.external_id async for r in adapter.discover(source)]
    assert again == ["-1001234:104"]
    # a new message appears
    client.messages.append(
        TgMessage(
            id=106,
            date=NOW,
            text="Mirobod 3-xonali 700$",
            grouped_id=None,
            has_photo=False,
            edit_date=None,
            sender_id=1,
            sender_username=None,
        )
    )
    source.state = {**source.state, "last_run_at": NOW.isoformat()}
    assert [r.external_id async for r in adapter.discover(source)] == ["-1001234:106"]


async def test_unauthorized_client_raises_login_required() -> None:
    adapter = TelegramAdapter(FakeClient(_messages(), authorized=False), now=lambda: NOW)  # type: ignore[arg-type]
    with pytest.raises(LoginRequired):
        _ = [r async for r in adapter.discover(_source())]


async def test_rebuild_payload_and_fetch_by_url() -> None:
    client = FakeClient(_messages())
    adapter = TelegramAdapter(client, now=lambda: NOW)  # type: ignore[arg-type]
    source = _source()
    refs = {r.external_id: r async for r in adapter.discover(source)}
    p = await adapter.fetch(refs["-1001234:101"])
    raw = RawListing(external_id=p.external_id, payload=p.payload, content_hash="h", fetched_at=NOW)
    assert await adapter.rebuild_payload(raw) == p
    by_url = await adapter.fetch_by_url("https://t.me/toshkent_ijara/103")
    assert by_url.external_id == "-1001234:103" and "Yunusobod" in by_url.text


async def test_fetch_by_url_raises_listing_gone_when_the_message_no_longer_exists() -> None:
    """A well-formed `t.me/<channel>/<id>` link whose message has been deleted is the
    same situation as a delisted OLX ad — `ListingGone`, not `InvalidListingUrl`: the
    link itself was fine, the content just isn't there any more."""
    client = FakeClient(_messages())
    adapter = TelegramAdapter(client, now=lambda: NOW)  # type: ignore[arg-type]
    with pytest.raises(ListingGone):
        await adapter.fetch_by_url("https://t.me/toshkent_ijara/999999")


async def test_aclose_disconnects_the_client() -> None:
    """The worker and the CLI close the registry on shutdown; a Telegram adapter that
    connected during a run must let go of its MTProto connection."""
    client = FakeClient(_messages())
    adapter = TelegramAdapter(client, now=lambda: NOW)  # type: ignore[arg-type]
    _ = [r async for r in adapter.discover(_source())]
    assert client.connected
    await adapter.aclose()
    assert client.connected is False


def test_marked_chat_id_follows_telethon_conventions() -> None:
    """Asserted on the entity types `resolve_peer` actually passes in — `get_entity`
    returns `User`/`Chat`/`Channel` objects, never the `Peer*` wrappers — because only
    those distinguish a megagroup from a broadcast channel (both marked the same way)."""
    from datetime import datetime as dt

    from telethon.tl import types

    from app.ingestion.adapters.telegram.client import marked_chat_id

    when = dt(2026, 8, 30, tzinfo=UTC)
    photo = types.ChatPhotoEmpty()
    assert marked_chat_id(types.User(id=5)) == 5
    assert (
        marked_chat_id(
            types.Chat(id=77, title="g", photo=photo, participants_count=2, date=when, version=1)
        )
        == -77
    )
    megagroup = types.Channel(id=1234, title="mg", photo=photo, date=when, megagroup=True)
    broadcast = types.Channel(id=1234, title="ch", photo=photo, date=when, broadcast=True)
    assert marked_chat_id(megagroup) == marked_chat_id(broadcast) == -1000000001234


def test_parse_message_link_accepts_pasted_forms() -> None:
    """`parse_message_link` must accept the forms people actually paste: with or without
    a scheme, the `t.me/s/...` preview-page form, and a trailing `?single` query — but
    still reject a channel link with no message id, and a `telegram.me` host (a real
    alias Telegram itself doesn't treat as equivalent to `t.me` for these links)."""
    from app.ingestion.adapters.telegram import parse_message_link

    for url in (
        "https://t.me/chan_name/123",
        "t.me/chan_name/123",
        "https://t.me/s/chan_name/123",
        "https://t.me/chan_name/123?single",
    ):
        assert parse_message_link(url) == ("chan_name", 123)
    # InvalidListingUrl, not a bare ValueError: the API answers 422 for this and 500
    # for any other ValueError escaping the adapter.
    with pytest.raises(InvalidListingUrl, match="not a t.me message link"):
        parse_message_link("https://t.me/chan_name")
    with pytest.raises(InvalidListingUrl, match="not a t.me message link"):
        parse_message_link("https://telegram.me/chan_name/123")
