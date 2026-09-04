import uuid
from datetime import datetime
from typing import Literal, cast

from pydantic import BaseModel

from app.modules.identity.models import User

UserRole = Literal["admin", "agent"]


class LoginIn(BaseModel):
    phone: str
    password: str


class RefreshIn(BaseModel):
    refresh: str


class TokenPair(BaseModel):
    access: str
    refresh: str
    token_type: Literal["bearer"] = "bearer"


class UserOut(BaseModel):
    id: uuid.UUID
    phone: str
    name: str
    role: str
    locale: str

    @classmethod
    def from_user(cls, user: User) -> "UserOut":
        return cls(
            id=user.id, phone=user.phone_e164, name=user.name, role=user.role, locale=user.locale
        )


class AdminUserOut(BaseModel):
    """One user row for the admin Settings screen. Never carries the password hash."""

    id: uuid.UUID
    name: str
    phone: str
    role: UserRole
    active: bool
    created_at: datetime

    @classmethod
    def from_user(cls, user: User) -> "AdminUserOut":
        return cls(
            id=user.id,
            name=user.name,
            phone=user.phone_e164,
            # plain `str` column; pydantic validates it against UserRole on construction
            role=cast(UserRole, user.role),
            active=user.active,
            created_at=user.created_at,
        )
