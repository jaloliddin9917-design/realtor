"""Users behind the admin Settings screen: list them (GET) and create one (POST). Admin-only."""

from fastapi import APIRouter
from sqlalchemy.exc import IntegrityError

from app.api.deps import AdminUser, SessionDep
from app.api.problems import PROBLEM_422, ApiError, problem_response
from app.modules.identity.schemas import AdminUserOut, UserCreateIn
from app.modules.identity.service import create_user, get_user_by_phone, list_users

router = APIRouter(tags=["users"])


@router.get("/users", response_model=list[AdminUserOut])
async def list_users_endpoint(session: SessionDep, _: AdminUser) -> list[AdminUserOut]:
    return [AdminUserOut.from_user(u) for u in await list_users(session)]


@router.post(
    "/users",
    response_model=AdminUserOut,
    status_code=201,
    responses={409: problem_response("phone already registered"), **PROBLEM_422},
)
async def create_user_endpoint(
    body: UserCreateIn, session: SessionDep, _: AdminUser
) -> AdminUserOut:
    """Create a user. Duplicate phone -> 409 `user.exists`; a too-short password or a role
    outside {admin, agent} is a 422 from `UserCreateIn` before this body runs. Never returns
    the password hash (`AdminUserOut` has no such field)."""
    if await get_user_by_phone(session, body.phone) is not None:
        raise ApiError(409, "user.exists", f"user {body.phone!r} already exists")
    user = await create_user(
        session, phone_e164=body.phone, name=body.name, password=body.password, role=body.role
    )
    try:
        await session.commit()
    except IntegrityError as exc:
        # Backstop for a race between two concurrent creates: the check above lost against
        # another insert of the same phone between its SELECT and this commit.
        # `users.phone_e164` is unique for exactly this.
        await session.rollback()
        raise ApiError(409, "user.exists", f"user {body.phone!r} already exists") from exc
    return AdminUserOut.from_user(user)
