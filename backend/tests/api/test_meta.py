"""GET /meta — the reference data (value sets, current FX, enforced rules) the web loads once."""

import json
from datetime import UTC, datetime
from decimal import Decimal

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.settings import Settings
from app.ingestion.parse.districts import DISTRICTS
from app.modules.availability.query import LOCK_HOURS, NEW_LISTING_CHECK_DAYS, RECHECK_DAYS
from app.modules.dedupe.config import load_config
from app.modules.identity.models import User
from app.modules.listings.models import FxRate
from app.modules.outreach.service import CHANNEL_LIMITS
from tests.api.conftest import auth_headers


async def test_meta_lists_the_values_the_web_filters_by(
    client: httpx.AsyncClient, settings: Settings, agent: User
) -> None:
    r = await client.get("/api/v1/meta", headers=auth_headers(settings, agent))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["statuses"] == ["new", "active", "inactive"]
    assert body["source_kinds"] == ["olx", "telegram", "manual"]
    assert body["contact_classifications"] == ["owner", "agent", "unknown"]
    # the canonical district keys, exactly as the parser writes them onto listings
    assert body["districts"] == sorted(DISTRICTS)
    assert "chilonzor" in body["districts"]


async def test_meta_requires_auth(client: httpx.AsyncClient) -> None:
    r = await client.get("/api/v1/meta")
    assert r.status_code == 401 and r.json()["code"] == "auth.missing_token"


async def test_meta_fx_reflects_the_latest_rate(
    client: httpx.AsyncClient, settings: Settings, agent: User, db: AsyncSession
) -> None:
    h = auth_headers(settings, agent)
    # Fresh database, no rate loaded yet: the banner is null, never a fabricated figure.
    r = await client.get("/api/v1/meta", headers=h)
    assert r.status_code == 200 and r.json()["fx"] is None

    today = datetime.now(UTC).date()  # matches the router's own datetime.now(UTC).date()
    db.add(FxRate(date=today, usd_uzs=Decimal("12600.00"), fetched_at=datetime.now(UTC)))
    await db.flush()
    fx = (await client.get("/api/v1/meta", headers=h)).json()["fx"]
    assert fx is not None
    assert fx["usd_uzs"] == "12600.00" and fx["stale"] is False and fx["date"] == today.isoformat()


async def test_meta_rules_come_from_the_real_enforced_constants(
    client: httpx.AsyncClient, settings: Settings, agent: User
) -> None:
    r = await client.get("/api/v1/meta", headers=auth_headers(settings, agent))
    assert r.status_code == 200, r.text
    rules = r.json()["rules"]
    # Assert against the real sources so a drift in any constant breaks this test.
    assert rules["lock_hours"] == LOCK_HOURS
    assert rules["recheck_days"] == RECHECK_DAYS
    assert rules["new_listing_check_days"] == NEW_LISTING_CHECK_DAYS
    assert (
        rules["duplicate_merge_threshold"]
        == load_config(settings.dedupe_config_path).merge_threshold
    )
    assert rules["telegram_per_hour"] == CHANNEL_LIMITS["telegram"][0]
    assert rules["telegram_per_day"] == CHANNEL_LIMITS["telegram"][1]
    assert rules["sms_per_day"] == CHANNEL_LIMITS["sms"][1]
    # Exactly these keys: quiet-hours / per-contact caps are NOT implemented, so must be absent.
    assert set(rules) == {
        "lock_hours",
        "recheck_days",
        "new_listing_check_days",
        "duplicate_merge_threshold",
        "telegram_per_hour",
        "telegram_per_day",
        "sms_per_day",
    }
    assert "quiet" not in json.dumps(rules) and "per_contact" not in json.dumps(rules)
