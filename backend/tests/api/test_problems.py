import httpx
from fastapi import FastAPI

from app.api.problems import ApiError


async def test_unknown_route_is_a_problem_response(client: httpx.AsyncClient) -> None:
    r = await client.get("/api/v1/nope")
    assert r.status_code == 404
    assert r.headers["content-type"].startswith("application/problem+json")
    body = r.json()
    assert body["status"] == 404 and body["code"] == "not_found" and body["title"] == "Not Found"
    assert body["type"] == "about:blank" and "detail" in body


async def test_method_not_allowed_is_a_problem_response(client: httpx.AsyncClient) -> None:
    r = await client.post("/api/v1/healthz")
    assert r.status_code == 405 and r.json()["code"] == "method_not_allowed"


async def test_unhandled_exception_is_a_problem_response_without_leaking_detail(
    api: tuple[FastAPI, httpx.AsyncClient],
) -> None:
    app, _ = api

    async def boom() -> None:
        raise RuntimeError("secret")

    app.add_api_route("/api/v1/_boom", boom)

    # Starlette's ServerErrorMiddleware re-raises the exception after sending the
    # handler's response, so this client must not raise on a server error.
    transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as local_client:
        r = await local_client.get("/api/v1/_boom")

    assert r.status_code == 500
    assert r.headers["content-type"].startswith("application/problem+json")
    body = r.json()
    assert body["code"] == "internal_error"
    assert "secret" not in r.text


async def test_non_standard_status_code_still_has_a_title(
    api: tuple[FastAPI, httpx.AsyncClient],
) -> None:
    app, client = api

    async def teapot_variant() -> None:
        raise ApiError(499, "x", "y")

    app.add_api_route("/api/v1/_weird_status", teapot_variant)

    r = await client.get("/api/v1/_weird_status")
    assert r.status_code == 499
    body = r.json()
    assert body["code"] == "x" and body["detail"] == "y"
    assert body["title"] == "HTTP 499"
