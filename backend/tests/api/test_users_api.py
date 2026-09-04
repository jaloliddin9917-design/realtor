"""API tests for GET /users (admin Settings screen) via the httpx ASGITransport harness."""

import json

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.settings import Settings
from app.modules.identity.models import User
from app.modules.identity.service import create_user
from tests.api.conftest import auth_headers


async def test_users_requires_auth(client: httpx.AsyncClient) -> None:
    r = await client.get("/api/v1/users")
    assert r.status_code == 401
    assert r.json()["code"] == "auth.missing_token"


async def test_agent_is_forbidden(
    client: httpx.AsyncClient, settings: Settings, agent: User
) -> None:
    r = await client.get("/api/v1/users", headers=auth_headers(settings, agent))
    assert r.status_code == 403
    assert r.json()["code"] == "auth.forbidden"


async def test_admin_lists_users_without_leaking_hashes(
    client: httpx.AsyncClient, settings: Settings, admin: User, agent: User, db: AsyncSession
) -> None:
    # a third, inactive user to confirm inactive users are still listed with active=False
    extra = await create_user(
        db, phone_e164="+998900000009", name="Dilshod", password="secret1", role="agent"
    )
    extra.active = False
    await db.flush()

    r = await client.get("/api/v1/users", headers=auth_headers(settings, admin))
    assert r.status_code == 200, r.text
    rows = r.json()

    by_id = {row["id"]: row for row in rows}
    assert {str(admin.id), str(agent.id), str(extra.id)} <= set(by_id)
    # exact field set — snake_case, no password hash
    assert set(rows[0]) == {"id", "name", "phone", "role", "active", "created_at"}
    assert by_id[str(admin.id)]["role"] == "admin"
    assert by_id[str(agent.id)]["role"] == "agent"
    assert by_id[str(admin.id)]["phone"] == admin.phone_e164
    assert by_id[str(extra.id)]["active"] is False

    # the password hash must never appear, in any field
    blob = json.dumps(rows)
    assert "password" not in blob
    assert admin.password_hash not in blob
