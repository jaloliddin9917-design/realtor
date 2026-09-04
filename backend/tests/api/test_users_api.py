"""API tests for /users (admin Settings screen) via the httpx ASGITransport harness."""

import json

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.settings import Settings
from app.modules.identity.models import User
from app.modules.identity.service import create_user, get_user_by_phone
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


async def test_admin_creates_a_user(
    client: httpx.AsyncClient, settings: Settings, admin: User, db: AsyncSession
) -> None:
    r = await client.post(
        "/api/v1/users",
        headers=auth_headers(settings, admin),
        json={
            "name": "Nodira",
            "phone": "+998900000010",
            "password": "supersecret",
            "role": "agent",
        },
    )
    assert r.status_code == 201, r.text
    body = r.json()
    # returned shape is exactly AdminUserOut — snake_case, and never the hash
    assert set(body) == {"id", "name", "phone", "role", "active", "created_at"}
    assert body["name"] == "Nodira" and body["phone"] == "+998900000010"
    assert body["role"] == "agent" and body["active"] is True
    assert "password" not in json.dumps(body)

    # persisted, with the password hashed (never stored in plaintext)
    created = await get_user_by_phone(db, "+998900000010")
    assert created is not None and created.name == "Nodira" and created.role == "agent"
    assert created.password_hash and created.password_hash != "supersecret"


async def test_create_user_rejects_a_duplicate_phone(
    client: httpx.AsyncClient, settings: Settings, admin: User, agent: User
) -> None:
    r = await client.post(
        "/api/v1/users",
        headers=auth_headers(settings, admin),
        json={
            "name": "Clash",
            "phone": agent.phone_e164,
            "password": "supersecret",
            "role": "agent",
        },
    )
    assert r.status_code == 409 and r.json()["code"] == "user.exists"


async def test_create_user_is_admin_only(
    client: httpx.AsyncClient, settings: Settings, agent: User
) -> None:
    r = await client.post(
        "/api/v1/users",
        headers=auth_headers(settings, agent),
        json={
            "name": "Nope",
            "phone": "+998900000011",
            "password": "supersecret",
            "role": "agent",
        },
    )
    assert r.status_code == 403 and r.json()["code"] == "auth.forbidden"


async def test_create_user_validates_password_length_and_role(
    client: httpx.AsyncClient, settings: Settings, admin: User
) -> None:
    h = auth_headers(settings, admin)
    r = await client.post(
        "/api/v1/users",
        headers=h,
        json={"name": "Short", "phone": "+998900000012", "password": "short", "role": "agent"},
    )
    assert r.status_code == 422 and r.json()["code"] == "validation_error"
    r = await client.post(
        "/api/v1/users",
        headers=h,
        json={
            "name": "BadRole",
            "phone": "+998900000013",
            "password": "supersecret",
            "role": "superadmin",
        },
    )
    assert r.status_code == 422 and r.json()["code"] == "validation_error"
