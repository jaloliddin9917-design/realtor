"""Stateless HS256 JWTs: an access token (15 min) and a refresh token (30 days)."""

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

import jwt

from app.core.settings import Settings

ALGORITHM = "HS256"
TOKEN_TYPES = ("access", "refresh")


class AuthError(Exception):
    def __init__(self, code: str, detail: str) -> None:
        super().__init__(detail)
        self.code = code
        self.detail = detail


@dataclass(frozen=True)
class TokenClaims:
    user_id: uuid.UUID
    role: str
    typ: str
    expires_at: datetime


def _ttl(settings: Settings, typ: str) -> timedelta:
    if typ == "access":
        return timedelta(minutes=settings.jwt_access_minutes)
    if typ == "refresh":
        return timedelta(days=settings.jwt_refresh_days)
    raise ValueError(f"unknown token type {typ!r}; expected one of {TOKEN_TYPES}")


def create_token(
    settings: Settings,
    *,
    user_id: uuid.UUID,
    role: str,
    typ: str,
    now: datetime | None = None,
) -> str:
    issued = now or datetime.now(UTC)
    ttl = _ttl(settings, typ)
    payload = {
        "sub": str(user_id),
        "role": role,
        "typ": typ,
        "iat": int(issued.timestamp()),
        "exp": int((issued + ttl).timestamp()),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=ALGORITHM)


def decode_token(
    settings: Settings, token: str, *, expected_typ: str, now: datetime | None = None
) -> TokenClaims:
    """Verify signature and claims; expiry is checked against `now` so tests can freeze time.

    `verify_iat` is disabled for the same reason as `verify_exp`: PyJWT would otherwise
    validate `iat` against the real wall clock (not the injectable `now`), which raises
    `ImmatureSignatureError` whenever a test freezes `now` ahead of the real clock.
    """
    try:
        payload = jwt.decode(
            token,
            settings.jwt_secret,
            algorithms=[ALGORITHM],
            options={
                "verify_exp": False,
                "verify_iat": False,
                "require": ["sub", "role", "typ", "iat", "exp"],
            },
        )
        user_id = uuid.UUID(str(payload["sub"]))
    except (jwt.InvalidTokenError, ValueError) as exc:
        raise AuthError("auth.token_invalid", "invalid token") from exc
    if payload["typ"] != expected_typ:
        raise AuthError("auth.token_invalid", f"expected a {expected_typ} token")
    expires_at = datetime.fromtimestamp(int(payload["exp"]), tz=UTC)
    if expires_at <= (now or datetime.now(UTC)):
        raise AuthError("auth.token_expired", "token expired")
    return TokenClaims(
        user_id=user_id, role=str(payload["role"]), typ=expected_typ, expires_at=expires_at
    )
