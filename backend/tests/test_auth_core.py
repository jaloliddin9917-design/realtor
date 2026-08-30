import uuid
from datetime import UTC, datetime, timedelta

import pytest

from app.core.auth import AuthError, create_token, decode_token
from app.core.settings import Settings

NOW = datetime(2026, 8, 30, 12, 0, tzinfo=UTC)
# 48 bytes each: HS256 signing warns (InsecureKeyLengthWarning) below 32.
SETTINGS = Settings(_env_file=None, jwt_secret="test-secret-" * 4)
USER = uuid.uuid4()


def test_access_token_round_trip_and_ttl() -> None:
    token = create_token(SETTINGS, user_id=USER, role="agent", typ="access", now=NOW)
    claims = decode_token(SETTINGS, token, expected_typ="access", now=NOW + timedelta(minutes=14))
    assert claims.user_id == USER and claims.role == "agent" and claims.typ == "access"
    assert claims.expires_at == NOW + timedelta(minutes=15)


def test_refresh_token_lives_thirty_days() -> None:
    token = create_token(SETTINGS, user_id=USER, role="admin", typ="refresh", now=NOW)
    claims = decode_token(SETTINGS, token, expected_typ="refresh", now=NOW + timedelta(days=29))
    assert claims.expires_at == NOW + timedelta(days=30)


def test_expired_token_is_reported_as_expired() -> None:
    token = create_token(SETTINGS, user_id=USER, role="agent", typ="access", now=NOW)
    with pytest.raises(AuthError) as exc:
        decode_token(SETTINGS, token, expected_typ="access", now=NOW + timedelta(minutes=15))
    assert exc.value.code == "auth.token_expired"


def test_wrong_type_secret_or_garbage_is_invalid() -> None:
    refresh = create_token(SETTINGS, user_id=USER, role="agent", typ="refresh", now=NOW)
    with pytest.raises(AuthError) as exc:
        decode_token(SETTINGS, refresh, expected_typ="access", now=NOW)
    assert exc.value.code == "auth.token_invalid"
    other = Settings(_env_file=None, jwt_secret="other-secret" * 4)
    with pytest.raises(AuthError):
        decode_token(other, refresh, expected_typ="refresh", now=NOW)
    with pytest.raises(AuthError):
        decode_token(SETTINGS, "not.a.token", expected_typ="access", now=NOW)


def test_create_token_rejects_unknown_type() -> None:
    with pytest.raises(ValueError):
        create_token(SETTINGS, user_id=USER, role="agent", typ="session", now=NOW)
