"""Users: argon2 password hashing and phone/password authentication."""

import uuid

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.identity.models import User

ROLES = ("admin", "agent")
_hasher = PasswordHasher()


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password_hash: str, password: str) -> bool:
    try:
        return _hasher.verify(password_hash, password)
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


async def get_user(session: AsyncSession, user_id: uuid.UUID) -> User | None:
    return (await session.execute(select(User).where(User.id == user_id))).scalar_one_or_none()


async def get_user_by_phone(session: AsyncSession, phone_e164: str) -> User | None:
    stmt = select(User).where(User.phone_e164 == phone_e164)
    return (await session.execute(stmt)).scalar_one_or_none()


async def create_user(
    session: AsyncSession,
    *,
    phone_e164: str,
    name: str,
    password: str,
    role: str = "agent",
    locale: str = "uz",
) -> User:
    if role not in ROLES:
        raise ValueError(f"unknown role {role!r}; expected one of {ROLES}")
    user = User(
        phone_e164=phone_e164,
        name=name,
        password_hash=hash_password(password),
        role=role,
        locale=locale,
    )
    session.add(user)
    await session.flush()
    return user


async def authenticate(session: AsyncSession, phone_e164: str, password: str) -> User | None:
    user = await get_user_by_phone(session, phone_e164)
    if user is None or not user.active or not verify_password(user.password_hash, password):
        return None
    return user
