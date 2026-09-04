"""GET /users — the user list behind the admin Settings screen. Admin-only."""

from fastapi import APIRouter

from app.api.deps import AdminUser, SessionDep
from app.modules.identity.schemas import AdminUserOut
from app.modules.identity.service import list_users

router = APIRouter(tags=["users"])


@router.get("/users", response_model=list[AdminUserOut])
async def list_users_endpoint(session: SessionDep, _: AdminUser) -> list[AdminUserOut]:
    return [AdminUserOut.from_user(u) for u in await list_users(session)]
