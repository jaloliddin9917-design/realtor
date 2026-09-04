"""API tests for the Bot Monitor via the httpx ASGITransport harness.

Sending is OFF, so the honest empty shape is the primary case: both channels disabled, zero
counters, no items. A hand-seeded `outreach_messages` row (the shape the real sender will
write) then verifies the join-to-property/contact mapping, and the manual resolve path
covers 200 / 404 / 409 / 422.
"""

import uuid
from datetime import UTC, datetime

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.settings import Settings
from app.modules.contacts.models import Contact
from app.modules.identity.models import User
from app.modules.outreach.models import OutreachMessage
from app.modules.properties.models import Property
from tests.api.conftest import auth_headers


async def _make_property(db: AsyncSession) -> Property:
    now = datetime.now(UTC)
    prop = Property(
        status="active",
        first_seen_at=now,
        last_seen_at=now,
        district="chilonzor",
        rooms=2,
        price_usd_min_minor=45000,
    )
    db.add(prop)
    await db.flush()
    return prop


async def _make_contact(db: AsyncSession, identifier: str) -> Contact:
    contact = Contact(kind="phone", identifier=identifier)
    db.add(contact)
    await db.flush()
    return contact


async def _add_message(
    db: AsyncSession,
    prop: Property,
    *,
    contact: Contact | None = None,
    channel: str = "telegram",
    status: str = "queued",
    sent_at: datetime | None = None,
    reply_text: str | None = None,
    reply_at: datetime | None = None,
    parsed_result: str | None = None,
) -> OutreachMessage:
    message = OutreachMessage(
        property_id=prop.id,
        contact_id=contact.id if contact is not None else None,
        channel=channel,
        status=status,
        sent_at=sent_at,
        reply_text=reply_text,
        reply_at=reply_at,
        parsed_result=parsed_result,
        created_at=datetime.now(UTC),
    )
    db.add(message)
    await db.flush()
    return message


# --- auth --------------------------------------------------------------------------------


async def test_endpoints_require_auth(client: httpx.AsyncClient) -> None:
    r = await client.get("/api/v1/bot")
    assert r.status_code == 401 and r.json()["code"] == "auth.missing_token"
    r = await client.post(f"/api/v1/bot/{uuid.uuid4()}/resolve", json={"result": "vacant"})
    assert r.status_code == 401 and r.json()["code"] == "auth.missing_token"


# --- GET /bot: the honest empty shape ----------------------------------------------------


async def test_monitor_empty_shape_is_disabled_channels_zero_counters_no_items(
    client: httpx.AsyncClient, settings: Settings, agent: User
) -> None:
    r = await client.get("/api/v1/bot", headers=auth_headers(settings, agent))
    assert r.status_code == 200, r.text
    body = r.json()
    assert set(body) == {"channels", "counters", "items"}

    assert body["channels"] == [
        {
            "channel": "telegram",
            "enabled": False,
            "status": "not_configured",
            "sent_today": 0,
            "per_hour": 12,
            "per_day": 100,
        },
        {
            "channel": "sms",
            "enabled": False,
            "status": "not_configured",
            "sent_today": 0,
            "per_hour": None,
            "per_day": 100,
        },
    ]
    assert body["counters"] == {
        "today": 0,
        "queued": 0,
        "answered": 0,
        "unclear": 0,
        "errors": 0,
    }
    assert body["items"] == []


# --- GET /bot: a seeded row appears, mapped from property + contact ----------------------


async def test_monitor_maps_a_seeded_message_row(
    client: httpx.AsyncClient, settings: Settings, agent: User, db: AsyncSession
) -> None:
    prop = await _make_property(db)
    contact = await _make_contact(db, "+998908112437")
    now = datetime.now(UTC)
    message = await _add_message(
        db,
        prop,
        contact=contact,
        channel="telegram",
        status="answered",
        sent_at=now,
        reply_text="1",
        reply_at=now,
        parsed_result="vacant",
    )

    body = (await client.get("/api/v1/bot", headers=auth_headers(settings, agent))).json()

    (item,) = body["items"]
    assert item == {
        "id": str(message.id),
        "property_id": str(prop.id),
        "district": "chilonzor",
        "rooms": 2,
        "price_usd": 450,
        "phone": "+998908112437",
        "channel": "telegram",
        "status": "answered",
        "sent_at": item["sent_at"],  # timestamps round-trip; asserted non-null below
        "reply_text": "1",
        "reply_at": item["reply_at"],
        "result": "vacant",
    }
    assert item["sent_at"] is not None and item["reply_at"] is not None

    assert body["counters"] == {
        "today": 1,
        "queued": 0,
        "answered": 1,
        "unclear": 0,
        "errors": 0,
    }
    telegram = next(c for c in body["channels"] if c["channel"] == "telegram")
    sms = next(c for c in body["channels"] if c["channel"] == "sms")
    assert telegram["sent_today"] == 1
    assert sms["sent_today"] == 0


async def test_monitor_counts_queued_unclear_and_errors(
    client: httpx.AsyncClient, settings: Settings, agent: User, db: AsyncSession
) -> None:
    prop = await _make_property(db)
    now = datetime.now(UTC)
    await _add_message(db, prop, status="queued")
    await _add_message(
        db,
        prop,
        status="answered",
        sent_at=now,
        reply_text="hmm",
        reply_at=now,
        parsed_result="unclear",
    )
    await _add_message(db, prop, status="error", channel="sms")

    body = (await client.get("/api/v1/bot", headers=auth_headers(settings, agent))).json()
    assert body["counters"] == {
        "today": 3,
        "queued": 1,
        "answered": 1,
        "unclear": 1,
        "errors": 1,
    }
    # sent_today counts only messages with a sent_at: the answered telegram one does, while
    # the queued telegram message and the errored sms send never went out.
    channels = {c["channel"]: c["sent_today"] for c in body["channels"]}
    assert channels == {"telegram": 1, "sms": 0}


# --- POST /bot/{id}/resolve --------------------------------------------------------------


async def test_resolve_sets_result_and_clears_unclear_counter(
    client: httpx.AsyncClient, settings: Settings, agent: User, db: AsyncSession
) -> None:
    prop = await _make_property(db)
    now = datetime.now(UTC)
    message = await _add_message(
        db,
        prop,
        status="answered",
        sent_at=now,
        reply_text="hozircha shu narx",
        reply_at=now,
        parsed_result="unclear",
    )
    h = auth_headers(settings, agent)

    r = await client.post(f"/api/v1/bot/{message.id}/resolve", json={"result": "taken"}, headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["result"] == "taken"
    assert r.json()["id"] == str(message.id)

    await db.refresh(message)
    assert message.parsed_result == "taken"

    # the unclear counter has dropped and the row now reads "taken"
    body = (await client.get("/api/v1/bot", headers=h)).json()
    assert body["counters"]["unclear"] == 0
    (item,) = body["items"]
    assert item["result"] == "taken"


async def test_resolve_conflicts_when_not_unclear(
    client: httpx.AsyncClient, settings: Settings, agent: User, db: AsyncSession
) -> None:
    prop = await _make_property(db)
    now = datetime.now(UTC)
    message = await _add_message(
        db,
        prop,
        status="answered",
        sent_at=now,
        reply_text="1",
        reply_at=now,
        parsed_result="vacant",
    )
    r = await client.post(
        f"/api/v1/bot/{message.id}/resolve",
        json={"result": "taken"},
        headers=auth_headers(settings, agent),
    )
    assert r.status_code == 409 and r.json()["code"] == "outreach.not_resolvable"


async def test_resolve_unknown_message_404(
    client: httpx.AsyncClient, settings: Settings, agent: User
) -> None:
    r = await client.post(
        f"/api/v1/bot/{uuid.uuid4()}/resolve",
        json={"result": "vacant"},
        headers=auth_headers(settings, agent),
    )
    assert r.status_code == 404 and r.json()["code"] == "not_found"


async def test_resolve_rejects_a_non_resolve_result_422(
    client: httpx.AsyncClient, settings: Settings, agent: User, db: AsyncSession
) -> None:
    prop = await _make_property(db)
    now = datetime.now(UTC)
    message = await _add_message(
        db,
        prop,
        status="answered",
        sent_at=now,
        reply_text="?",
        reply_at=now,
        parsed_result="unclear",
    )
    # "unclear" is a parse result but not a valid manual resolution.
    r = await client.post(
        f"/api/v1/bot/{message.id}/resolve",
        json={"result": "unclear"},
        headers=auth_headers(settings, agent),
    )
    assert r.status_code == 422 and r.json()["code"] == "validation_error"
