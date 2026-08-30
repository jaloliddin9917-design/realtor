import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.identity.service import (
    authenticate,
    create_user,
    get_user,
    get_user_by_phone,
    hash_password,
    verify_password,
)


def test_password_hash_is_argon2_and_verifies() -> None:
    h = hash_password("secret1")
    assert h.startswith("$argon2id$") and "secret1" not in h
    assert verify_password(h, "secret1")
    assert not verify_password(h, "secret2")
    assert not verify_password("not-a-hash", "secret1")


async def test_create_and_authenticate(db: AsyncSession) -> None:
    user = await create_user(
        db, phone_e164="+998900000001", name="Aziz", password="secret1", role="admin"
    )
    assert user.id is not None and user.role == "admin" and user.locale == "uz"
    assert (await get_user(db, user.id)) is user
    assert (await get_user_by_phone(db, "+998900000001")) is user
    assert (await authenticate(db, "+998900000001", "secret1")) is user
    assert (await authenticate(db, "+998900000001", "wrong")) is None
    assert (await authenticate(db, "+998900000002", "secret1")) is None


async def test_inactive_user_cannot_authenticate(db: AsyncSession) -> None:
    user = await create_user(db, phone_e164="+998900000003", name="Old", password="secret1")
    user.active = False
    await db.flush()
    assert (await authenticate(db, "+998900000003", "secret1")) is None


async def test_create_user_rejects_unknown_role(db: AsyncSession) -> None:
    with pytest.raises(ValueError, match="role"):
        await create_user(db, phone_e164="+998900000004", name="X", password="p", role="boss")
