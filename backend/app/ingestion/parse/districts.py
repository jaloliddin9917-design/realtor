import re

from app.ingestion.parse.normalize import translit

# canonical key → alias patterns, matched on translit(text). Longer/more specific first.
DISTRICTS: dict[str, list[str]] = {
    "mirzo_ulugbek": [r"\bmirzo[\s-]*ulug'?bek\w*", r"\bm\.?\s*ulug'?bek\w*", r"\bttz\b"],
    "chilonzor": [r"\bchilonzor\w*", r"\bchilanzar\w*", r"\bch[\s-]?zor\b"],
    "yunusobod": [r"\byunusobod\w*", r"\byunusabad\w*", r"\byu[\s-]?obod\b"],
    "yakkasaroy": [r"\byakkasaroy\w*", r"\byakkasaray\w*"],
    "shayxontohur": [r"\bshayxonto[hx]ur\w*", r"\bshayxanta[hx]ur\w*", r"\bsh[\s-]?to[hx]ur\b"],
    "yashnobod": [r"\byashnobod\w*", r"\byashnabad\w*"],
    "olmazor": [r"\bolmazor\w*", r"\balmazar\w*"],
    "mirobod": [r"\bmirobod\w*", r"\bmirabad\w*"],
    "sergeli": [r"\bsergeli\w*"],
    "uchtepa": [r"\buchtepa\w*"],
    "bektemir": [r"\bbektemir\w*"],
    "yangihayot": [r"\byangi[\s-]?[hx]a[yeё]o?t\w*"],
}

_COMPILED: list[tuple[str, re.Pattern[str]]] = [
    (key, re.compile(p)) for key, patterns in DISTRICTS.items() for p in patterns
]


def match_district(text: str) -> str | None:
    t = translit(text)
    best: tuple[int, str] | None = None
    for key, pattern in _COMPILED:
        m = pattern.search(t)
        if m and (best is None or m.start() < best[0]):
            best = (m.start(), key)
    return best[1] if best else None
