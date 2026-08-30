"""GET /meta — the closed value sets the web builds its filter controls from."""

import httpx

from app.core.settings import Settings
from app.ingestion.parse.districts import DISTRICTS
from app.modules.identity.models import User
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
