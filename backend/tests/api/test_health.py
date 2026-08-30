from datetime import UTC, datetime, timedelta

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from app.worker.loop import heartbeat


async def test_healthz_is_degraded_without_a_worker_heartbeat(client: httpx.AsyncClient) -> None:
    r = await client.get("/api/v1/healthz")
    assert r.status_code == 503
    body = r.json()
    assert body["status"] == "degraded" and body["db"] is True and body["worker"] is False
    assert body["worker_heartbeat_age_seconds"] is None


async def test_healthz_ok_with_a_fresh_heartbeat(
    client: httpx.AsyncClient, db: AsyncSession
) -> None:
    await heartbeat(db, "worker", datetime.now(UTC) - timedelta(seconds=30))
    r = await client.get("/api/v1/healthz")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok" and body["worker"] is True
    assert 25 <= body["worker_heartbeat_age_seconds"] <= 120


async def test_healthz_degraded_with_a_stale_heartbeat(
    client: httpx.AsyncClient, db: AsyncSession
) -> None:
    await heartbeat(db, "worker", datetime.now(UTC) - timedelta(minutes=6))
    r = await client.get("/api/v1/healthz")
    assert r.status_code == 503 and r.json()["worker"] is False
