from typing import Any

from pydantic import BaseModel

from app.ingestion.parse.districts import match_district
from app.ingestion.parse.fields import (
    extract_area,
    extract_markers,
    extract_phones,
    extract_price,
    extract_rooms_floors,
    extract_username,
)
from app.ingestion.parse.normalize import normalize


class ParsedListing(BaseModel):
    title: str
    description: str
    price_amount_minor: int | None = None
    price_currency: str | None = None
    rooms: int | None = None
    floor: int | None = None
    total_floors: int | None = None
    area_sqm: float | None = None
    district: str | None = None
    phones: list[str] = []
    telegram_username: str | None = None
    owner_marker: bool = False
    agent_marker: bool = False
    parse_confidence: float = 0.0


def _confidence(p: "ParsedListing") -> float:
    score = 0.0
    if p.price_amount_minor is not None and p.price_currency:
        score += 0.3
    if p.rooms is not None:
        score += 0.2
    if p.district:
        score += 0.15
    if p.phones or p.telegram_username:
        score += 0.15
    if p.floor is not None:
        score += 0.1
    if p.area_sqm is not None:
        score += 0.1
    return round(score, 2)


def _override[T](s: dict[str, Any], key: str, extracted: T) -> T:
    """A structured value wins only when the key is present and not None."""
    value = s.get(key)
    return extracted if value is None else value


def parse_text(
    text: str, *, sender_username: str | None = None, structured: dict[str, Any] | None = None
) -> ParsedListing:
    s = structured or {}
    clean = normalize(text)
    first_line = text.strip().splitlines()[0].strip() if text.strip() else ""
    price = extract_price(clean)
    rooms, floor, total = extract_rooms_floors(clean)

    # Price overrides atomically: only use the structured pair when both fields are
    # present and not None, so an amount is never paired with the wrong currency.
    amount, currency = (price[0], price[1]) if price is not None else (None, None)
    if s.get("price_amount_minor") is not None and s.get("price_currency") is not None:
        amount, currency = s["price_amount_minor"], s["price_currency"]

    p = ParsedListing(
        title=str(_override(s, "title", normalize(first_line)))[:200],
        description=clean,
        price_amount_minor=amount,
        price_currency=currency,
        rooms=_override(s, "rooms", rooms),
        floor=_override(s, "floor", floor),
        total_floors=_override(s, "total_floors", total),
        area_sqm=_override(s, "area_sqm", extract_area(clean)),
        district=_override(s, "district", match_district(clean)),
        phones=extract_phones(clean),
        telegram_username=extract_username(clean) or sender_username,
    )
    p.owner_marker, p.agent_marker = extract_markers(clean)
    p.parse_confidence = _confidence(p)
    return p


__all__ = [
    "ParsedListing",
    "parse_text",
    "extract_area",
    "extract_markers",
    "extract_phones",
    "extract_price",
    "extract_rooms_floors",
    "extract_username",
]
