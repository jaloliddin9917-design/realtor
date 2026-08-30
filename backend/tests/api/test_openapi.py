import json
from pathlib import Path
from typing import Any

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


def _model_of(response: dict[str, Any]) -> str:
    """The component name the response body refers to."""
    ref: str = response["content"]["application/json"]["schema"]["$ref"]
    return ref.rsplit("/", 1)[-1]


def test_schema_covers_the_spec_endpoints() -> None:
    schema = create_app(Settings(_env_file=None)).openapi()
    assert EXPECTED_PATHS <= set(schema["paths"])
    assert schema["components"]["securitySchemes"]["HTTPBearer"]["scheme"] == "bearer"


def test_error_bodies_are_part_of_the_contract() -> None:
    """The generated web client must know the problem shape, not just the happy path."""
    schema = create_app(Settings(_env_file=None)).openapi()
    components = schema["components"]["schemas"]
    assert {"Problem", "ValidationProblem"} <= set(components)
    codes = components["Problem"]["properties"]["code"]["description"]
    for code in ("auth.invalid_credentials", "listing.gone", "source.login_required", "not_found"):
        assert code in codes
    paths = schema["paths"]
    properties_get = paths["/api/v1/properties"]["get"]["responses"]
    assert _model_of(properties_get["401"]) == "Problem"
    assert _model_of(properties_get["422"]) == "ValidationProblem"
    assert _model_of(paths["/api/v1/listings/manual"]["post"]["responses"]["410"]) == "Problem"
    assert _model_of(paths["/api/v1/sources"]["get"]["responses"]["403"]) == "Problem"
    # our own 422 replaces FastAPI's auto-generated one everywhere
    assert "HTTPValidationError" not in json.dumps(paths)


def test_committed_contract_is_current() -> None:
    schema = create_app(Settings(_env_file=None)).openapi()
    committed = json.loads(CONTRACT.read_text())
    assert schema == committed, "backend/openapi.json is stale — run `make openapi` and commit it"
