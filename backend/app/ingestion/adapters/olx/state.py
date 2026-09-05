"""Parse OLX pages through the JSON state they embed (`window.__PRERENDERED_STATE__`)."""

import html as html_lib
import json
import re
from datetime import datetime
from typing import Any

from app.ingestion.adapters.base import RawPayload
from app.ingestion.parse import normalize_phone
from app.ingestion.parse.districts import match_district
from app.ingestion.parse.normalize import translit

MARKER = "__PRERENDERED_STATE__"
_JSON_STRING = re.compile(r'"(?:[^"\\]|\\.)*"', re.S)
_TAGS = re.compile(r"<br\s*/?>|</p>", re.I)
_ANY_TAG = re.compile(r"<[^>]+>")
_NUMBER = re.compile(r"\d+(?:[.,]\d+)?")

PARAM_KEYS = {
    "number_of_rooms": "rooms",
    "floor": "floor",
    "total_floors": "total_floors",
    "total_area": "area_sqm",
}
CURRENCY_CODES = {"UYE": "USD", "USD": "USD", "UZS": "UZS"}

# Attribute vocabularies — matched as substrings of translit(value).lower(); first wins.
BUILDING_TYPES = {
    "brick": ["kirpich", "g'isht"],
    "panel": ["panel"],
    "monolith": ["monolit"],
    "block": ["bloch", "blok", "penoblo", "gazoblo"],
}
RENOVATIONS = {
    "euro": ["evro"],
    "designer": ["dizayn"],
    "cosmetic": ["kosmet"],
    "average": ["sredn", "o'rtacha"],
    "needs_repair": ["trebuet", "chernov", "bez remont", "ta'mir talab"],
}
BATHROOM_TYPES = {
    "combined": ["sovmesh", "birlashtiril"],
    "separate": ["razdel", "alohida"],
    "multiple": ["bolee", "2 sanuz"],
}


def _match_code(vocab: dict[str, list[str]], value: Any) -> str | None:
    """First code whose alias is a substring of translit(value); 'other' if a value is
    present but unmatched; None if there is no value."""
    t = translit(str(value or "")).lower()
    if not t:
        return None
    for code, aliases in vocab.items():
        if any(alias in t for alias in aliases):
            return code
    return "other"


def _yesno(value: Any) -> bool | None:
    t = translit(str(value or "")).lower()
    if not t:
        return None
    if any(a in t for a in ("net", "yo'q", "yoq", "bez ", "siz")):
        return False
    if any(a in t for a in ("da", "ha", "est", "bor", "mebel")):
        return True
    return None


def _year(value: Any) -> int | None:
    m = _NUMBER.search(str(value or ""))
    if m is None:
        return None
    year = int(float(m.group(0).replace(",", ".")))
    return year if 1800 <= year <= 2100 else None


def _map(ad: dict[str, Any]) -> tuple[float | None, float | None, int | None, bool | None]:
    m = ad.get("map") or {}
    lat, lon = m.get("lat"), m.get("lon")
    if lat is None or lon is None:
        return None, None, None, None
    radius = m.get("radius")
    radius_m = int(round(float(radius) * 1000)) if radius is not None else None
    return float(lat), float(lon), radius_m, bool(m.get("show_detailed"))


def _location_label(ad: dict[str, Any]) -> str | None:
    loc = ad.get("location") or {}
    path = loc.get("pathName")
    if path:
        return str(path)
    label = ", ".join(str(p) for p in (loc.get("cityName"), loc.get("districtName")) if p)
    return label or None


def _attributes(ad: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    """Return (top-level columns, display bag) parsed from ad.params."""
    p = {str(x.get("key")): x.get("value") for x in (ad.get("params") or [])}
    top = {
        "building_type": _match_code(BUILDING_TYPES, p.get("house_type")),
        "is_furnished": _yesno(p.get("furnished")),
        "renovation": _match_code(RENOVATIONS, p.get("repairs")),
        "year_built": _year(p.get("year_of_construction_rent")),
    }
    bag: dict[str, Any] = {}
    bathroom = _match_code(BATHROOM_TYPES, p.get("wc"))
    if bathroom:
        bag["bathroom_type"] = bathroom
    if p.get("comission") is not None:
        bag["commission"] = _yesno(p.get("comission"))
    for key, out in (("kitchen_area", "kitchen_area_sqm"), ("ceiling_height", "ceiling_height_m")):
        n = _NUMBER.search(str(p.get(key) or ""))
        if n is not None:
            bag[out] = float(n.group(0).replace(",", "."))
    for key in ("near_is", "more"):
        val = p.get(key)
        if isinstance(val, list) and val:
            bag[key] = [str(v) for v in val]
        elif isinstance(val, str) and val.strip():
            bag[key] = [val.strip()]
    return {k: v for k, v in top.items() if v is not None}, bag


def extract_state(html: str) -> dict[str, Any]:
    start = html.find(MARKER)
    if start < 0:
        raise ValueError("no __PRERENDERED_STATE__ in page")
    quote = html.find('"', start)
    match = _JSON_STRING.match(html, quote)
    if match is None:
        raise ValueError("unterminated __PRERENDERED_STATE__ literal")
    inner = json.loads(match.group(0))  # the page stores the JSON as a JS string literal
    result: dict[str, Any] = json.loads(inner)
    return result


def list_ads(state: dict[str, Any]) -> list[dict[str, Any]]:
    ads = state.get("listing", {}).get("listing", {}).get("ads") or []
    return [a for a in ads if isinstance(a, dict) and a.get("id") is not None]


def list_pages(state: dict[str, Any]) -> tuple[int, int]:
    inner = state.get("listing", {}).get("listing", {})
    return int(inner.get("pageNumber", 0)), int(inner.get("totalPages", 1))


def detail_ad(state: dict[str, Any]) -> dict[str, Any]:
    ad = state.get("ad", {}).get("ad")
    if not isinstance(ad, dict) or ad.get("id") is None:
        raise ValueError("no ad in detail state")
    return ad


def _price(ad: dict[str, Any]) -> tuple[int | None, str | None]:
    regular = (ad.get("price") or {}).get("regularPrice") or {}
    value, code = regular.get("value"), regular.get("currencyCode")
    currency = CURRENCY_CODES.get(str(code)) if code else None
    if value is None or currency is None:
        return None, None
    return int(round(float(value) * 100)), currency


def _params(ad: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for param in ad.get("params") or []:
        target = PARAM_KEYS.get(str(param.get("key")))
        if target is None:
            continue
        number = _NUMBER.search(str(param.get("value") or ""))
        if number is None:
            continue
        text = number.group(0).replace(",", ".")
        out[target] = float(text) if target == "area_sqm" else int(float(text))
    return out


def ad_signature(ad: dict[str, Any]) -> str:
    amount, currency = _price(ad)
    return f"{ad.get('lastRefreshTime')}|{amount}|{currency}"


def ad_time(ad: dict[str, Any], key: str) -> datetime | None:
    """Read one of the ad's ISO timestamps (`createdTime`, `lastRefreshTime`, ...).

    Timezone-aware by protocol (`RawRef.posted_at`): a naive value would blow up later
    when `recompute` orders it against aware timestamps, so reject it here where the ad
    id is still at hand instead of at the far end of the pipeline.
    """
    raw = ad.get(key)
    if not raw:
        return None
    value = datetime.fromisoformat(str(raw))
    if value.tzinfo is None:
        raise ValueError(f"ad {ad.get('id')}: naive {key} {raw!r}")
    return value


def _description_text(raw: str | None) -> str:
    text = _TAGS.sub("\n", raw or "")
    text = _ANY_TAG.sub("", text)
    return html_lib.unescape(text).strip()


def ad_to_payload(ad: dict[str, Any], phones: list[str]) -> RawPayload:
    amount, currency = _price(ad)
    structured: dict[str, Any] = {"title": ad.get("title") or ""}
    if amount is not None:
        structured["price_amount_minor"], structured["price_currency"] = amount, currency
    structured.update(_params(ad))
    district = match_district(((ad.get("location") or {}).get("districtName")) or "")
    if district:
        structured["district"] = district
    lat, lon, radius_m, precise = _map(ad)
    if lat is not None and lon is not None:
        structured["latitude"], structured["longitude"] = lat, lon
        structured["location_radius_m"], structured["location_precise"] = radius_m, precise
    label = _location_label(ad)
    if label:
        structured["location_label"] = label
    top_attrs, bag = _attributes(ad)
    structured.update(top_attrs)
    if bag:
        structured["attributes"] = bag
    hints: list[tuple[str, str]] = []
    user_id = (ad.get("user") or {}).get("id")
    if user_id is not None:
        hints.append(("olx_user", str(user_id)))
    hints.extend(("phone", p) for p in (normalize_phone(x) for x in phones) if p)
    text = f"{structured['title']}\n{_description_text(ad.get('description'))}".strip()
    return RawPayload(
        external_id=str(ad["id"]),
        url=ad.get("url"),
        posted_at=ad_time(ad, "createdTime"),
        text=text,
        structured=structured,
        sender_username=None,
        contact_hints=hints,
        photo_refs=list(ad.get("photos") or []),
        # verbatim: the payload records what the source served, so `reparse` can redo
        # today's normalisation with tomorrow's rules
        payload={"ad": ad, "phones": list(phones)},
    )
