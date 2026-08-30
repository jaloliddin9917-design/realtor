import uuid
from typing import Literal

from pydantic import BaseModel

from app.modules.identity.models import User


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
