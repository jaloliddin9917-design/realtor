"""RFC 7807 problem responses with a machine-readable `code` the web translates.

Every error response the API produces has this shape — with one deliberate exception:
`GET /healthz` answers 503 with its plain JSON status document (`{"status": "degraded",
"db": …, "worker": …}`), because an uptime monitor reads those fields, not a `code`.
"""

from http import HTTPStatus
from typing import Any

import structlog
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from starlette.exceptions import HTTPException as StarletteHTTPException

PROBLEM_MEDIA_TYPE = "application/problem+json"
MISSING_TOKEN = "auth.missing_token"
_HTTP_CODES = {404: "not_found", 405: "method_not_allowed", 401: MISSING_TOKEN}

CODES = """The machine-readable error code the web translates. One of:
`auth.missing_token`, `auth.token_expired`, `auth.token_invalid`, `auth.user_inactive`,
`auth.invalid_credentials`, `auth.forbidden`, `not_found`, `method_not_allowed`,
`validation_error`, `internal_error`, `listing.unsupported_url`, `listing.invalid_url`,
`listing.gone`, `source.misconfigured`, `source.unavailable`, `source.login_required`,
`source.peer_unresolved`, `source.exists`, `user.exists`, `queue.locked`,
`dedupe.already_decided`, `outreach.not_resolvable`; any other HTTP status raised by the
framework becomes `http.<status>`."""

log = structlog.get_logger()


def _title_for(status: int) -> str:
    """`HTTPStatus(status).phrase`, falling back for non-standard codes (e.g. 499)."""
    try:
        return HTTPStatus(status).phrase
    except ValueError:
        return f"HTTP {status}"


class Problem(BaseModel):
    """The body of every error response, sent as `application/problem+json`."""

    type: str = "about:blank"
    title: str
    status: int
    detail: str
    code: str = Field(description=CODES)


class ValidationIssue(BaseModel):
    loc: list[str]
    msg: str
    type: str


class ValidationProblem(Problem):
    errors: list[ValidationIssue]


def problem_response(description: str) -> dict[str, Any]:
    """One `responses=` entry: our problem body instead of a bare description."""
    return {"model": Problem, "description": description}


# PROBLEM_401/403 are applied to whole routers in `app.py`; PROBLEM_422 goes on every
# route that takes a body, a query or a form, replacing FastAPI's own HTTPValidationError.
PROBLEM_401: dict[int | str, dict[str, Any]] = {
    401: problem_response("missing, invalid or expired token; or inactive user")
}
PROBLEM_403: dict[int | str, dict[str, Any]] = {403: problem_response("admin role required")}
PROBLEM_422: dict[int | str, dict[str, Any]] = {
    422: {"model": ValidationProblem, "description": "request validation failed"}
}
# Applied to every router at `include_router` in app.py: any route can hit the
# catch-all `Exception` handler below.
PROBLEM_500: dict[int | str, dict[str, Any]] = {500: problem_response("unexpected error")}


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
        "title": _title_for(status),
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
        detail = exc.detail if isinstance(exc.detail, str) else _title_for(exc.status_code)
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

    @app.exception_handler(Exception)
    async def _unhandled_error(request: Request, exc: Exception) -> JSONResponse:
        log.exception("unhandled_error", path=request.url.path)
        return problem(500, "internal_error", "an unexpected error occurred")
