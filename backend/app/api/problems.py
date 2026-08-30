"""RFC 7807 problem responses with a machine-readable `code` the web translates."""

from http import HTTPStatus
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

PROBLEM_MEDIA_TYPE = "application/problem+json"
_HTTP_CODES = {404: "not_found", 405: "method_not_allowed", 401: "auth.missing_token"}


class ApiError(Exception):
    def __init__(
        self, status: int, code: str, detail: str, *, extra: dict[str, Any] | None = None
    ) -> None:
        super().__init__(detail)
        self.status, self.code, self.detail, self.extra = status, code, detail, extra or {}


def problem(
    status: int,
    code: str,
    detail: str,
    *,
    extra: dict[str, Any] | None = None,
    headers: dict[str, str] | None = None,
) -> JSONResponse:
    body: dict[str, Any] = {
        "type": "about:blank",
        "title": HTTPStatus(status).phrase,
        "status": status,
        "detail": detail,
        "code": code,
        **(extra or {}),
    }
    hdrs = dict(headers or {})
    if status == 401:
        hdrs.setdefault("WWW-Authenticate", "Bearer")
    return JSONResponse(body, status_code=status, media_type=PROBLEM_MEDIA_TYPE, headers=hdrs)


def install_problem_handlers(app: FastAPI) -> None:
    @app.exception_handler(ApiError)
    async def _api_error(_: Request, exc: ApiError) -> JSONResponse:
        return problem(exc.status, exc.code, exc.detail, extra=exc.extra)

    @app.exception_handler(StarletteHTTPException)
    async def _http_error(_: Request, exc: StarletteHTTPException) -> JSONResponse:
        code = _HTTP_CODES.get(exc.status_code, f"http.{exc.status_code}")
        detail = exc.detail if isinstance(exc.detail, str) else HTTPStatus(exc.status_code).phrase
        return problem(exc.status_code, code, detail, headers=dict(exc.headers or {}))

    @app.exception_handler(RequestValidationError)
    async def _validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
        errors = [
            {
                "loc": [str(p) for p in e.get("loc", ())],
                "msg": e.get("msg", ""),
                "type": e.get("type", ""),
            }
            for e in exc.errors()
        ]
        return problem(
            422, "validation_error", "request validation failed", extra={"errors": errors}
        )
