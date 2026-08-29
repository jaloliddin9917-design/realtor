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


def parse_text(
    text: str, *, sender_username: str | None = None, structured: dict[str, Any] | None = None
) -> ParsedListing:
    s = structured or {}
    clean = normalize(text)
    first_line = text.strip().splitlines()[0].strip() if text.strip() else ""
    price = extract_price(clean)
    rooms, floor, total = extract_rooms_floors(clean)
    p = ParsedListing(
        title=str(s.get("title") or normalize(first_line))[:200],
        description=clean,
        price_amount_minor=s.get("price_amount_minor", price[0] if price else None),
        price_currency=s.get("price_currency", price[1] if price else None),
        rooms=s.get("rooms", rooms),
        floor=s.get("floor", floor),
        total_floors=s.get("total_floors", total),
        area_sqm=s.get("area_sqm", extract_area(clean)),
        district=s.get("district", match_district(clean)),
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
