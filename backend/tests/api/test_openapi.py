import json
from pathlib import Path

from app.api.app import create_app
from app.core.settings import Settings

CONTRACT = Path(__file__).resolve().parents[2] / "openapi.json"
EXPECTED_PATHS = {
    "/api/v1/healthz",
    "/api/v1/auth/login",
    "/api/v1/auth/refresh",
    "/api/v1/me",
    "/api/v1/properties",
    "/api/v1/properties/{property_id}",
    "/api/v1/properties/{property_id}/status",
    "/api/v1/listings/manual",
    "/api/v1/listings/manual/form",
    "/api/v1/sources",
    "/api/v1/sources/{source_id}",
    "/api/v1/sources/{source_id}/runs",
}


def test_schema_covers_the_spec_endpoints() -> None:
    schema = create_app(Settings(_env_file=None)).openapi()
    assert EXPECTED_PATHS <= set(schema["paths"])
    assert schema["components"]["securitySchemes"]["HTTPBearer"]["scheme"] == "bearer"


def test_committed_contract_is_current() -> None:
    schema = create_app(Settings(_env_file=None)).openapi()
    committed = json.loads(CONTRACT.read_text())
    assert schema == committed, "backend/openapi.json is stale — run `make openapi` and commit it"
