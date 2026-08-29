import re

import phonenumbers

from app.ingestion.parse.normalize import normalize, translit

_NUM = r"(?P<amt>\d{1,3}(?:[ \xa0.,]\d{3})+|\d+)(?:[.,](?P<dec>\d{1,2})(?!\d))?"
_MULT = r"(?:\s*(?P<mult>ming|tis|tys|mln|million|mlrd))?"
_USD = r"(?:\$|usd|u\.?\s?e\.?|ye\b|doll\w*)"
_UZS = r"(?:so'?m\b|sum\b|uzs\b|sўm\b)"
_PRICE_AFTER = re.compile(rf"{_NUM}{_MULT}\.?\s*(?P<cur>{_USD}|{_UZS})", re.IGNORECASE)
_PRICE_BEFORE = re.compile(rf"(?P<cur>{_USD})\s*{_NUM}{_MULT}", re.IGNORECASE)
_MULTIPLIERS = {
    "ming": 1_000,
    "tis": 1_000,
    "tys": 1_000,
    "mln": 1_000_000,
    "million": 1_000_000,
    "mlrd": 1_000_000_000,
}


def _amount(m: re.Match[str]) -> int:
    whole = re.sub(r"[ \xa0.,]", "", m.group("amt"))
    value = int(whole) * 100
    if m.group("dec"):
        value += int(m.group("dec").ljust(2, "0"))
    mult = m.group("mult")
    if mult:
        value *= _MULTIPLIERS[mult.lower()]
    return value


def extract_price(text: str) -> tuple[int, str] | None:
    t = translit(text)
    candidates: list[tuple[int, re.Match[str]]] = []
    for pattern in (_PRICE_AFTER, _PRICE_BEFORE):
        m = pattern.search(t)
        if m:
            candidates.append((m.start(), m))
    if not candidates:
        return None
    m = min(candidates, key=lambda c: c[0])[1]
    cur = m.group("cur")
    currency = "USD" if re.fullmatch(_USD, cur, re.IGNORECASE) else "UZS"
    return _amount(m), currency


_SHORT = re.compile(r"\b(\d)\s*/\s*(\d{1,2})\s*/\s*(\d{1,2})\b")
_ROOMS = re.compile(r"\b(\d)\s*[- ]?\s*(?:xonali|xona\b|x\.|komn\w*|k\.|kv\b|komnat\w*)")
_FLOOR_OF = re.compile(r"\b(\d{1,2})\s*/\s*(\d{1,2})\b")
_FLOOR_QAVAT = re.compile(r"\b(\d{1,2})\s*-?\s*qavat\b")
_TOTAL_QAVATLI = re.compile(r"\b(\d{1,2})\s*-?\s*qavatli\b")
_FLOOR_ETAJ = re.compile(r"\b(\d{1,2})\s*(?:-?\s*(?:y|i)?\s*)?etaj\w*(?:\s*iz\s*(\d{1,2}))?")


def extract_rooms_floors(text: str) -> tuple[int | None, int | None, int | None]:
    t = translit(text)
    if m := _SHORT.search(t):
        return int(m.group(1)), int(m.group(2)), int(m.group(3))
    rooms = int(m.group(1)) if (m := _ROOMS.search(t)) else None
    floor: int | None = None
    total: int | None = None
    if m := _FLOOR_OF.search(t):
        floor, total = int(m.group(1)), int(m.group(2))
    else:
        if m := _FLOOR_ETAJ.search(t):
            floor = int(m.group(1))
            total = int(m.group(2)) if m.group(2) else None
        if m := _FLOOR_QAVAT.search(t):
            floor = int(m.group(1))
        if m := _TOTAL_QAVATLI.search(t):
            total = int(m.group(1))
    return rooms, floor, total


_AREA = re.compile(
    r"\b(\d{2,3}(?:[.,]\d)?)\s*(?:m²|m2|kv\.?\s*m\b|kv\.?(?![a-z])|m\.?\s*kv\b|kvadrat)",
    re.IGNORECASE,
)


def extract_area(text: str) -> float | None:
    t = translit(text).replace("м", "m")
    m = _AREA.search(t)
    return float(m.group(1).replace(",", ".")) if m else None


_PHONE = re.compile(
    r"(?<!\d)(?:\+?998|8)?[\s(-]*(\d{2})[\s)-]*(\d{3})[\s-]*(\d{2})[\s-]*(\d{2})(?!\d)"
)
# a digit run immediately followed by a currency marker is a price, not a phone
# (checked on the original script — extract_phones runs on normalize(), not translit())
_PRICED = re.compile(
    r"^\s*(?:so'?m\b|sum\b|uzs\b|\$|usd\b|u\.?\s?e\b|у\.?\s?е\b|сум\b|сўм\b|"
    r"ming\b|mln\b|тыс\b|млн\b)",
    re.IGNORECASE,
)


def extract_phones(text: str) -> list[str]:
    out: list[str] = []
    clean = normalize(text)
    for m in _PHONE.finditer(clean):
        if _PRICED.match(clean[m.end() :]):
            continue
        candidate = "+998" + "".join(m.groups())
        try:
            parsed = phonenumbers.parse(candidate, "UZ")
        except phonenumbers.NumberParseException:
            continue
        if not phonenumbers.is_valid_number(parsed):
            continue
        e164 = phonenumbers.format_number(parsed, phonenumbers.PhoneNumberFormat.E164)
        if e164 not in out:
            out.append(e164)
    return out


_USERNAME = re.compile(r"@([A-Za-z][A-Za-z0-9_]{4,31})\b")


def extract_username(text: str) -> str | None:
    m = _USERNAME.search(text)
    return m.group(1) if m else None


_OWNER = re.compile(
    r"\b(?:egasidan|egasi\b|vositachi\w*siz|xo'?jayin\w*|xozyain\w*|sobstvennik\w*|bez\s+posrednik\w*|ot\s+xozyaina)"
)
_AGENT = re.compile(
    r"\b(?:ri[ye]ltor\w*|rieltor\w*|agent\w*|agentstv\w*|usluga\s*\d+\s*%|xizmat\s*(?:haqi\s*)?\d+\s*%|komissiya|komissi\w*)"
)


def extract_markers(text: str) -> tuple[bool, bool]:
    t = translit(text)
    return bool(_OWNER.search(t)), bool(_AGENT.search(t))
