from fastapi import APIRouter

from app.api.deps import CurrentUser, SessionDep, SettingsDep
from app.api.problems import PROBLEM_401, PROBLEM_422, ApiError, problem_response
from app.core.auth import AuthError, create_token, decode_token
from app.core.settings import Settings
from app.ingestion.parse import normalize_phone
from app.modules.identity.models import User
from app.modules.identity.schemas import LoginIn, RefreshIn, TokenPair, UserOut
from app.modules.identity.service import authenticate, get_user

router = APIRouter(tags=["auth"])


def _pair(settings: Settings, user: User) -> TokenPair:
    return TokenPair(
        access=create_token(settings, user_id=user.id, role=user.role, typ="access"),
        refresh=create_token(settings, user_id=user.id, role=user.role, typ="refresh"),
    )


@router.post(
    "/auth/login",
    response_model=TokenPair,
    responses={401: problem_response("wrong phone or password"), **PROBLEM_422},
)
async def login(body: LoginIn, session: SessionDep, settings: SettingsDep) -> TokenPair:
    phone = normalize_phone(body.phone) or body.phone.strip()
    user = await authenticate(session, phone, body.password)
    if user is None:
        raise ApiError(401, "auth.invalid_credentials", "wrong phone or password")
    return _pair(settings, user)


@router.post(
    "/auth/refresh",
    response_model=TokenPair,
    responses={401: problem_response("invalid or expired refresh token"), **PROBLEM_422},
)
async def refresh(body: RefreshIn, session: SessionDep, settings: SettingsDep) -> TokenPair:
    try:
        claims = decode_token(settings, body.refresh, expected_typ="refresh")
    except AuthError as exc:
        raise ApiError(401, exc.code, exc.detail) from exc
    user = await get_user(session, claims.user_id)
    if user is None or not user.active:
        raise ApiError(401, "auth.user_inactive", "user is inactive")
    return _pair(settings, user)


@router.get("/me", response_model=UserOut, responses=PROBLEM_401)
async def me(user: CurrentUser) -> UserOut:
    return UserOut.from_user(user)
