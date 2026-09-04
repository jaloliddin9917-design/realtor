"""API tests for GET /dashboard via the httpx ASGITransport harness."""

from datetime import UTC, datetime, timedelta

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.settings import Settings
from app.modules.identity.models import User
from app.modules.properties.models import Property
from tests.api.conftest import auth_headers


async def test_dashboard_requires_auth(client: httpx.AsyncClient) -> None:
    r = await client.get("/api/v1/dashboard")
    assert r.status_code == 401
    assert r.json()["code"] == "auth.missing_token"


async def test_dashboard_returns_real_aggregates(
    client: httpx.AsyncClient, settings: Settings, agent: User, db: AsyncSession
) -> None:
    seen = datetime.now(UTC) - timedelta(days=5)  # past the new-listing grace -> due
    db.add(
        Property(
            status="active",
            first_seen_at=seen,
            last_seen_at=seen,
            district="chilonzor",
            rooms=2,
            price_usd_min_minor=45000,
        )
    )
    await db.flush()

    r = await client.get("/api/v1/dashboard", headers=auth_headers(settings, agent))
    assert r.status_code == 200, r.text
    body = r.json()
    # shape the web maps against
    assert set(body) == {
        "status_counts",
        "new_listings",
        "bot_replies",
        "agents",
        "unassigned",
        "auto_distribute",
        "recheck_total",
        "recheck_items",
    }
    assert body["status_counts"]["vacant"] == 1
    assert body["status_counts"]["to_check_today"] == 1
    assert body["recheck_total"] == 1
    assert body["recheck_items"][0]["district"] == "chilonzor"
    assert body["recheck_items"][0]["price_usd"] == 450
    # honest zeros for features that haven't produced data
    assert body["bot_replies"] == {
        "sent": 0,
        "answered": 0,
        "vacant": 0,
        "taken": 0,
        "unclear": 0,
    }
    assert body["auto_distribute"] is False
    # the active agent fixture user appears with honest zero tallies (no calls or locks yet)
    assert body["agents"] == [
        {
            "id": str(agent.id),
            "name": agent.name,
            "in_queue": 0,
            "calls": 0,
            "found_vacant": 0,
            "working_on": None,
        }
    ]
