from datetime import UTC, date, datetime
from decimal import ROUND_HALF_UP, Decimal

import httpx
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.listings.models import FxRate

CBU_URL = "https://cbu.uz/uz/arkhiv-kursov-valyut/json/USD/"


async def fetch_cbu_rate(client: httpx.AsyncClient) -> tuple[date, Decimal]:
    response = await client.get(CBU_URL, timeout=20)
    response.raise_for_status()
    row = next((item for item in response.json() if item.get("Ccy") == "USD"), None)
    if row is None:
        raise ValueError("CBU response has no USD row")
    day = datetime.strptime(row["Date"], "%d.%m.%Y").date()
    return day, Decimal(row["Rate"])


async def refresh_rate(session: AsyncSession, client: httpx.AsyncClient) -> FxRate:
    day, rate = await fetch_cbu_rate(client)
    stmt = insert(FxRate).values(date=day, usd_uzs=rate, fetched_at=datetime.now(UTC))
    stmt = stmt.on_conflict_do_update(
        index_elements=[FxRate.date], set_={"usd_uzs": rate, "fetched_at": datetime.now(UTC)}
    )
    await session.execute(stmt)
    await session.flush()
    return (await session.execute(select(FxRate).where(FxRate.date == day))).scalar_one()


async def rate_for(session: AsyncSession, day: date) -> Decimal | None:
    stmt = select(FxRate.usd_uzs).where(FxRate.date <= day).order_by(FxRate.date.desc()).limit(1)
    rate = (await session.execute(stmt)).scalar_one_or_none()
    if rate is None:
        stmt = select(FxRate.usd_uzs).order_by(FxRate.date.desc()).limit(1)
        rate = (await session.execute(stmt)).scalar_one_or_none()
    return Decimal(rate) if rate is not None else None


def to_usd_minor(
    amount_minor: int | None, currency: str | None, rate: Decimal | None
) -> int | None:
    if amount_minor is None or currency is None:
        return None
    if currency == "USD":
        return amount_minor
    if currency == "UZS" and rate:
        return int((Decimal(amount_minor) / rate).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
    return None
