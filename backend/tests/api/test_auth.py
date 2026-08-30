from datetime import UTC, datetime, timedelta

import httpx
import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import create_token
from app.core.settings import Settings
from app.modules.identity.models import User
from tests.api.conftest import PASSWORD, auth_headers

# The short literal secret in the `settings` fixture is an intentional test fixture, not
# a production value; PyJWT's InsecureKeyLengthWarning (HMAC key < 32 bytes) is expected noise.
pytestmark = pytest.mark.filterwarnings("ignore::jwt.InsecureKeyLengthWarning")


async def test_login_returns_a_pair_that_opens_me(client: httpx.AsyncClient, agent: User) -> None:
    r = await client.post(
        "/api/v1/auth/login", json={"phone": "+998 90 000 00 02", "password": PASSWORD}
    )
    assert r.status_code == 200, r.text
    pair = r.json()
    assert pair["token_type"] == "bearer" and pair["access"] != pair["refresh"]
    me = await client.get("/api/v1/me", headers={"Authorization": f"Bearer {pair['access']}"})
    assert me.status_code == 200
    assert me.json() == {
        "id": str(agent.id),
        "phone": "+998900000002",
        "name": "Agent",
        "role": "agent",
        "locale": "uz",
    }


async def test_wrong_password_and_unknown_phone_are_401(
    client: httpx.AsyncClient, agent: User
) -> None:
    for body in (
        {"phone": "+998900000002", "password": "nope"},
        {"phone": "+998900000009", "password": PASSWORD},
    ):
        r = await client.post("/api/v1/auth/login", json=body)
        assert r.status_code == 401 and r.json()["code"] == "auth.invalid_credentials"
        assert r.headers["www-authenticate"] == "Bearer"


async def test_refresh_rotates_and_rejects_an_access_token(
    client: httpx.AsyncClient, agent: User
) -> None:
    pair = (
        await client.post(
            "/api/v1/auth/login", json={"phone": "+998900000002", "password": PASSWORD}
        )
    ).json()
    r = await client.post("/api/v1/auth/refresh", json={"refresh": pair["refresh"]})
    assert r.status_code == 200 and set(r.json()) == {"access", "refresh", "token_type"}
    r = await client.post("/api/v1/auth/refresh", json={"refresh": pair["access"]})
    assert r.status_code == 401 and r.json()["code"] == "auth.token_invalid"


async def test_expired_missing_and_inactive_tokens(
    client: httpx.AsyncClient, settings: Settings, agent: User, db: AsyncSession
) -> None:
    old = create_token(
        settings,
        user_id=agent.id,
        role="agent",
        typ="access",
        now=datetime.now(UTC) - timedelta(minutes=16),
    )
    r = await client.get("/api/v1/me", headers={"Authorization": f"Bearer {old}"})
    assert r.status_code == 401 and r.json()["code"] == "auth.token_expired"
    r = await client.get("/api/v1/me")
    assert r.status_code == 401 and r.json()["code"] == "auth.missing_token"
    agent.active = False
    await db.flush()
    r = await client.get("/api/v1/me", headers=auth_headers(settings, agent))
    assert r.status_code == 401 and r.json()["code"] == "auth.user_inactive"
    r = await client.post(
        "/api/v1/auth/login", json={"phone": "+998900000002", "password": PASSWORD}
    )
    assert r.status_code == 401


async def test_validation_error_shape(client: httpx.AsyncClient) -> None:
    r = await client.post("/api/v1/auth/login", json={"phone": "+998900000002"})
    assert r.status_code == 422
    body = r.json()
    assert body["code"] == "validation_error"
    assert body["errors"][0]["loc"] == ["body", "password"]
    assert body["errors"][0]["type"] == "missing"
