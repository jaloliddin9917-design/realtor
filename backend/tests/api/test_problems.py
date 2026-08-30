import httpx


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
