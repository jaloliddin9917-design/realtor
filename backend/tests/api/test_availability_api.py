"""API tests for the queue + call-log endpoints via the httpx ASGITransport harness."""

import uuid
from datetime import UTC, datetime, timedelta

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.settings import Settings
from app.modules.identity.models import User
from app.modules.properties.models import Property, PropertyStatusEvent
from tests.api.conftest import auth_headers


def _now() -> datetime:
    return datetime.now(UTC)


async def seed_due_property(db: AsyncSession, *, status: str = "new") -> Property:
    """A property due for a check: first seen well past the new-listing grace window."""
    seen = _now() - timedelta(days=5)
    prop = Property(
        status=status,
        first_seen_at=seen,
        last_seen_at=seen,
        rooms=2,
        district="chilonzor",
        price_usd_min_minor=45000,
    )
    db.add(prop)
    await db.flush()
    db.add(
        PropertyStatusEvent(
            property_id=prop.id, from_status=None, to_status=status, actor_type="crawler"
        )
    )
    await db.flush()
    return prop


# --- auth --------------------------------------------------------------------------------


async def test_endpoints_require_auth(client: httpx.AsyncClient) -> None:
    pid = uuid.uuid4()
    for method, path in [
        ("GET", "/api/v1/queue"),
        ("POST", f"/api/v1/queue/{pid}/take"),
        ("POST", f"/api/v1/queue/{pid}/release"),
        ("POST", f"/api/v1/properties/{pid}/call-log"),
    ]:
        r = await client.request(method, path, json={} if method == "POST" else None)
        assert r.status_code == 401, (method, path, r.text)
        assert r.json()["code"] == "auth.missing_token"


# --- GET /queue --------------------------------------------------------------------------


async def test_queue_lists_due_items(
    client: httpx.AsyncClient, settings: Settings, agent: User, db: AsyncSession
) -> None:
    prop = await seed_due_property(db)
    r = await client.get("/api/v1/queue", headers=auth_headers(settings, agent))
    assert r.status_code == 200, r.text
    items = r.json()
    row = next(i for i in items if i["property_id"] == str(prop.id))
    assert row["id"] == str(prop.id)
    assert row["district"] == "chilonzor" and row["price_usd"] == 450
    assert row["state"]["kind"] == "new"
    assert row["availability"]["status"] == "unknown"
    assert row["owner"]["classification"] == "unknown" and row["owner"]["phone"] == ""
    assert row["source"] == "manual"


async def test_queue_scope_is_validated(
    client: httpx.AsyncClient, settings: Settings, agent: User
) -> None:
    r = await client.get(
        "/api/v1/queue", params={"scope": "banana"}, headers=auth_headers(settings, agent)
    )
    assert r.status_code == 422 and r.json()["code"] == "validation_error"


# --- take / release ----------------------------------------------------------------------


async def test_take_then_conflict_then_release(
    client: httpx.AsyncClient, settings: Settings, agent: User, admin: User, db: AsyncSession
) -> None:
    prop = await seed_due_property(db)

    r = await client.post(f"/api/v1/queue/{prop.id}/take", headers=auth_headers(settings, agent))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["state"]["kind"] == "mine" and body["state"]["until"] is not None

    # a different agent cannot claim the live lock
    r = await client.post(f"/api/v1/queue/{prop.id}/take", headers=auth_headers(settings, admin))
    assert r.status_code == 409 and r.json()["code"] == "queue.locked"

    # the holder releases it
    r = await client.post(f"/api/v1/queue/{prop.id}/release", headers=auth_headers(settings, agent))
    assert r.status_code == 204

    # now it is free to take again
    r = await client.post(f"/api/v1/queue/{prop.id}/take", headers=auth_headers(settings, admin))
    assert r.status_code == 200 and r.json()["state"]["kind"] == "mine"


async def test_take_unknown_property_404(
    client: httpx.AsyncClient, settings: Settings, agent: User
) -> None:
    r = await client.post(
        f"/api/v1/queue/{uuid.uuid4()}/take", headers=auth_headers(settings, agent)
    )
    assert r.status_code == 404 and r.json()["code"] == "not_found"


# --- call-log ----------------------------------------------------------------------------


async def test_call_log_round_trip_marks_taken(
    client: httpx.AsyncClient, settings: Settings, agent: User, db: AsyncSession
) -> None:
    prop = await seed_due_property(db, status="active")
    payload = {
        "outcome": "taken",
        "conditions": {"foreigners": False, "deposit_months": 1, "family_only": True},
        "note": "topshirildi",
        "next_check": {"choice": "in_3_days"},
    }
    r = await client.post(
        f"/api/v1/properties/{prop.id}/call-log",
        json=payload,
        headers=auth_headers(settings, agent),
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["property_id"] == str(prop.id)
    assert body["outcome"] == "taken" and body["resulting_status"] == "taken"
    assert "logged_at" in body and uuid.UUID(body["id"])

    await db.refresh(prop)
    assert prop.status == "inactive"


async def test_call_log_still_available_returns_vacant(
    client: httpx.AsyncClient, settings: Settings, agent: User, db: AsyncSession
) -> None:
    prop = await seed_due_property(db)
    r = await client.post(
        f"/api/v1/properties/{prop.id}/call-log",
        json={"outcome": "still_available"},
        headers=auth_headers(settings, agent),
    )
    assert r.status_code == 200, r.text
    assert r.json()["resulting_status"] == "vacant"


async def test_call_log_unknown_property_404(
    client: httpx.AsyncClient, settings: Settings, agent: User
) -> None:
    r = await client.post(
        f"/api/v1/properties/{uuid.uuid4()}/call-log",
        json={"outcome": "no_answer"},
        headers=auth_headers(settings, agent),
    )
    assert r.status_code == 404 and r.json()["code"] == "not_found"


async def test_call_log_bad_outcome_422(
    client: httpx.AsyncClient, settings: Settings, agent: User, db: AsyncSession
) -> None:
    prop = await seed_due_property(db)
    r = await client.post(
        f"/api/v1/properties/{prop.id}/call-log",
        json={"outcome": "banana"},
        headers=auth_headers(settings, agent),
    )
    assert r.status_code == 422 and r.json()["code"] == "validation_error"
