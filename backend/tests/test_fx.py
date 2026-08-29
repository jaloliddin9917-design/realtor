from datetime import date, timedelta
from decimal import Decimal

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.listings.fx import CBU_URL, fetch_cbu_rate, rate_for, refresh_rate, to_usd_minor

CBU_BODY = [
    {
        "id": 69,
        "Code": "840",
        "Ccy": "USD",
        "CcyNm_UZ": "AQSH dollari",
        "Nominal": "1",
        "Rate": "12345.67",
        "Diff": "1.2",
        "Date": "29.08.2026",
    }
]


def _client() -> httpx.AsyncClient:
    def handler(request: httpx.Request) -> httpx.Response:
        assert str(request.url) == CBU_URL
        return httpx.Response(200, json=CBU_BODY)

    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


async def test_fetch_cbu_rate_parses_date_and_rate() -> None:
    async with _client() as client:
        assert await fetch_cbu_rate(client) == (date(2026, 8, 29), Decimal("12345.67"))


async def test_refresh_rate_is_idempotent(db: AsyncSession) -> None:
    async with _client() as client:
        first = await refresh_rate(db, client)
        second = await refresh_rate(db, client)
    assert first.date == second.date == date(2026, 8, 29)
    assert second.usd_uzs == Decimal("12345.67")


async def test_rate_for_uses_latest_on_or_before_day_then_any(db: AsyncSession) -> None:
    async with _client() as client:
        await refresh_rate(db, client)
    assert await rate_for(db, date(2026, 8, 29)) == Decimal("12345.67")
    assert await rate_for(db, date(2026, 9, 15)) == Decimal("12345.67")
    assert await rate_for(db, date(2026, 8, 1)) == Decimal(
        "12345.67"
    )  # nothing earlier → latest any


async def test_rate_for_empty_table(db: AsyncSession) -> None:
    assert await rate_for(db, date.today() - timedelta(days=1)) is None


def test_to_usd_minor() -> None:
    assert to_usd_minor(45000, "USD", None) == 45000
    assert to_usd_minor(594070000, "UZS", Decimal("11881.4")) == 50000
    assert to_usd_minor(594070000, "UZS", None) is None
    assert to_usd_minor(None, "USD", None) is None
    assert to_usd_minor(100, None, Decimal("12000")) is None
