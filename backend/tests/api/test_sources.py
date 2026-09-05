import uuid
from datetime import UTC, datetime, timedelta
from decimal import Decimal

import httpx
import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.settings import Settings
from app.ingestion.adapters.base import LoginRequired
from app.ingestion.manual import ManualAdapter
from app.ingestion.registry import AdapterRegistry
from app.modules.identity.models import User
from app.modules.listings.models import CrawlRun, FxRate, Source
from tests.api.conftest import auth_headers

NOW = datetime(2026, 8, 30, 12, 0, tzinfo=UTC)


class StubTelegram:
    kind = "telegram"

    def __init__(self, outcome: tuple[int, str | None] | Exception) -> None:
        self.outcome = outcome
        self.peers: list[str | int] = []

    async def resolve_peer(self, peer: str | int) -> tuple[int, str | None]:
        self.peers.append(peer)
        if isinstance(self.outcome, Exception):
            raise self.outcome
        return self.outcome


@pytest.fixture
def telegram() -> StubTelegram:
    return StubTelegram((-1001234567890, "uy_ijara"))


@pytest.fixture
def registry(telegram: StubTelegram) -> AdapterRegistry:
    return AdapterRegistry({"manual": ManualAdapter(), "telegram": telegram})  # type: ignore[dict-item]


async def test_sources_are_admin_only(
    client: httpx.AsyncClient, settings: Settings, agent: User
) -> None:
    h = auth_headers(settings, agent)
    for method, path, body in (
        ("GET", "/api/v1/sources", None),
        ("POST", "/api/v1/sources", {"peer": "@x"}),
        ("PATCH", f"/api/v1/sources/{uuid.uuid4()}", {"enabled": False}),
        ("GET", f"/api/v1/sources/{uuid.uuid4()}/runs", None),
    ):
        r = await client.request(method, path, json=body, headers=h)
        assert r.status_code == 403 and r.json()["code"] == "auth.forbidden", (method, path)


async def test_list_shows_last_run_and_fx_banner_state(
    client: httpx.AsyncClient, settings: Settings, admin: User, db: AsyncSession
) -> None:
    h = auth_headers(settings, admin)
    src = Source(
        kind="olx", name="olx-tashkent", config={"url": "https://www.olx.uz/x/"}, status="failing"
    )
    db.add(src)
    await db.flush()
    db.add_all(
        [
            CrawlRun(
                source_id=src.id,
                started_at=NOW - timedelta(hours=2),
                finished_at=NOW - timedelta(hours=2),
                found=5,
                new=1,
            ),
            CrawlRun(
                source_id=src.id,
                started_at=NOW - timedelta(hours=1),
                finished_at=NOW - timedelta(hours=1),
                found=6,
                new=0,
                error="boom",
            ),
        ]
    )
    await db.flush()
    r = await client.get("/api/v1/sources", headers=h)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["fx"] is None
    (row,) = body["items"]
    assert (
        row["name"] == "olx-tashkent"
        and row["status"] == "failing"
        and row["config"] == {"url": "https://www.olx.uz/x/"}
    )
    assert row["last_run"]["found"] == 6 and row["last_run"]["error"] == "boom"
    today = datetime.now(UTC).date()  # matches the router's own `datetime.now(UTC).date()`
    db.add(FxRate(date=today - timedelta(days=10), usd_uzs=Decimal("12500.00"), fetched_at=NOW))
    await db.flush()
    fx = (await client.get("/api/v1/sources", headers=h)).json()["fx"]
    assert fx["stale"] is True and fx["usd_uzs"] == "12500.00"
    db.add(FxRate(date=today, usd_uzs=Decimal("12600.00"), fetched_at=NOW))
    await db.flush()
    fx = (await client.get("/api/v1/sources", headers=h)).json()["fx"]
    assert fx["stale"] is False and fx["date"] == today.isoformat()


async def test_add_telegram_source_validates_the_peer(
    client: httpx.AsyncClient,
    settings: Settings,
    admin: User,
    telegram: StubTelegram,
    db: AsyncSession,
) -> None:
    h = auth_headers(settings, admin)
    r = await client.post("/api/v1/sources", json={"peer": "@uy_ijara"}, headers=h)
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["kind"] == "telegram" and body["name"] == "@uy_ijara" and body["enabled"] is True
    assert body["config"] == {
        "peer": "@uy_ijara",
        "chat_id": -1001234567890,
        "username": "uy_ijara",
    }
    assert (
        body["interval_seconds"] == 900
        and body["next_run_at"] is None
        and telegram.peers == ["@uy_ijara"]
    )
    src = await db.get(Source, body["id"])
    assert src is not None and src.config["chat_id"] == -1001234567890
    r = await client.post("/api/v1/sources", json={"peer": "@uy_ijara"}, headers=h)
    assert r.status_code == 409 and r.json()["code"] == "source.exists"
    r = await client.post(
        "/api/v1/sources",
        json={"peer": "@uy_ijara", "name": "Uy ijara (2)", "interval_seconds": 600},
        headers=h,
    )
    assert (
        r.status_code == 201
        and r.json()["name"] == "Uy ijara (2)"
        and r.json()["interval_seconds"] == 600
    )


async def test_add_source_error_paths(
    client: httpx.AsyncClient, settings: Settings, admin: User, telegram: StubTelegram
) -> None:
    h = auth_headers(settings, admin)
    telegram.outcome = ValueError("No user has 'nope' as username")
    r = await client.post("/api/v1/sources", json={"peer": "@nope"}, headers=h)
    assert r.status_code == 422 and r.json()["code"] == "source.peer_unresolved"
    assert r.json()["errors"][0]["loc"] == ["body", "peer"]
    telegram.outcome = LoginRequired("session revoked")
    r = await client.post("/api/v1/sources", json={"peer": "@x_y_z"}, headers=h)
    assert r.status_code == 503 and r.json()["code"] == "source.login_required"
    r = await client.post("/api/v1/sources", json={"peer": "@x", "kind": "olx"}, headers=h)
    assert r.status_code == 422 and r.json()["code"] == "validation_error"


async def test_add_source_without_a_telegram_adapter(
    client: httpx.AsyncClient,
    settings: Settings,
    admin: User,
    api: tuple[object, httpx.AsyncClient],
) -> None:
    app = api[0]
    app.state.registry = AdapterRegistry({"manual": ManualAdapter()})  # type: ignore[attr-defined]
    r = await client.post(
        "/api/v1/sources", json={"peer": "@x_y_z"}, headers=auth_headers(settings, admin)
    )
    assert r.status_code == 503 and r.json()["code"] == "source.misconfigured"


async def test_patch_toggles_and_reschedules(
    client: httpx.AsyncClient, settings: Settings, admin: User, db: AsyncSession
) -> None:
    h = auth_headers(settings, admin)
    src = Source(
        kind="telegram",
        name="@a_b_c",
        config={"peer": "@a_b_c"},
        enabled=False,
        next_run_at=NOW + timedelta(hours=1),
        paused_until=NOW + timedelta(hours=1),
    )
    db.add(src)
    await db.flush()
    r = await client.patch(f"/api/v1/sources/{src.id}", json={"enabled": True}, headers=h)
    assert r.status_code == 200 and r.json()["enabled"] is True
    assert r.json()["next_run_at"] is None and r.json()["paused_until"] is None
    r = await client.patch(f"/api/v1/sources/{src.id}", json={"enabled": False}, headers=h)
    assert r.json()["enabled"] is False
    r = await client.patch(f"/api/v1/sources/{uuid.uuid4()}", json={"enabled": True}, headers=h)
    assert r.status_code == 404 and r.json()["code"] == "not_found"


async def test_runs_returns_the_newest_twenty(
    client: httpx.AsyncClient, settings: Settings, admin: User, db: AsyncSession
) -> None:
    h = auth_headers(settings, admin)
    src = Source(kind="olx", name="olx-x", config={"url": "https://www.olx.uz/x/"})
    db.add(src)
    await db.flush()
    db.add_all(
        [
            CrawlRun(source_id=src.id, started_at=NOW - timedelta(minutes=i), found=i)
            for i in range(25)
        ]
    )
    await db.flush()
    r = await client.get(f"/api/v1/sources/{src.id}/runs", headers=h)
    assert r.status_code == 200
    runs = r.json()
    assert len(runs) == 20 and [x["found"] for x in runs] == list(range(20))
    r = await client.get(f"/api/v1/sources/{uuid.uuid4()}/runs", headers=h)
    assert r.status_code == 404


async def test_list_breaks_started_at_ties_by_highest_run_id(
    client: httpx.AsyncClient, settings: Settings, admin: User, db: AsyncSession
) -> None:
    h = auth_headers(settings, admin)
    src = Source(kind="olx", name="olx-tie", config={"url": "https://www.olx.uz/tie/"})
    db.add(src)
    await db.flush()
    a, b = uuid.uuid4(), uuid.uuid4()
    hi, lo = (a, b) if a > b else (b, a)
    # Both runs share started_at; only `id` breaks the tie. Insert the higher id
    # first so a naive "last row wins" bug (no ORDER BY -> arbitrary DB row order)
    # would surface the lower id's `found` instead of the correct one.
    db.add_all(
        [
            CrawlRun(id=hi, source_id=src.id, started_at=NOW, found=42),
            CrawlRun(id=lo, source_id=src.id, started_at=NOW, found=7),
        ]
    )
    await db.flush()
    r = await client.get("/api/v1/sources", headers=h)
    assert r.status_code == 200, r.text
    (row,) = r.json()["items"]
    assert row["last_run"]["found"] == 42


async def test_run_now_queues_the_source_for_the_worker(
    client: httpx.AsyncClient, settings: Settings, admin: User, agent: User, db: AsyncSession
) -> None:
    h = auth_headers(settings, admin)
    src = Source(
        kind="olx",
        name="olx-run-now",
        config={"url": "https://www.olx.uz/x/"},
        enabled=True,
        next_run_at=NOW + timedelta(hours=1),
        paused_until=NOW + timedelta(hours=1),
    )
    db.add(src)
    await db.flush()

    # marks it due now and clears any backoff pause (the worker picks it up next tick)
    r = await client.post(f"/api/v1/sources/{src.id}/run", headers=h)
    assert r.status_code == 200
    body = r.json()
    assert body["paused_until"] is None
    assert datetime.fromisoformat(body["next_run_at"]) <= datetime.now(UTC) + timedelta(seconds=5)

    # a disabled source can't be run
    src.enabled = False
    await db.flush()
    r = await client.post(f"/api/v1/sources/{src.id}/run", headers=h)
    assert r.status_code == 409 and r.json()["code"] == "source.disabled"

    # unknown -> 404, agent -> 403
    assert (await client.post(f"/api/v1/sources/{uuid.uuid4()}/run", headers=h)).status_code == 404
    forbidden = await client.post(
        f"/api/v1/sources/{src.id}/run", headers=auth_headers(settings, agent)
    )
    assert forbidden.status_code == 403
