from dataclasses import dataclass, field

from app.modules.dedupe.config import DedupeConfig


@dataclass
class ScoreInput:
    shared_contact: bool
    min_photo_distance: int | None
    description_similarity: float | None
    rooms_floors_equal: bool
    area_ratio: float | None
    price_ratio: float | None
    # The identifier (phone/telegram/olx_user) of a contact both sides share, when any —
    # carried through so the persisted breakdown can name the phone the match was on.
    shared_contact_value: str | None = None


@dataclass
class ScoreBreakdown:
    total: float
    parts: dict[str, float]
    # signal -> human-readable detail (e.g. the matched phone for `contact`), when known.
    details: dict[str, str] = field(default_factory=dict)

    @property
    def has_corroborating_signal(self) -> bool:
        """Whether any NON-contact signal matched.

        A shared contact alone (a landlord or agent reusing one phone across genuinely
        different listings) is not evidence of a duplicate, so the caller requires at
        least one corroborating signal — photo, description, rooms_floors, area or price —
        before a pair may enter the review queue or auto-merge.
        """
        return any(points > 0 for signal, points in self.parts.items() if signal != "contact")


def _within(ratio: float | None, tolerance: float) -> bool:
    return ratio is not None and abs(ratio - 1.0) <= tolerance + 1e-9


def score(inp: ScoreInput, cfg: DedupeConfig) -> ScoreBreakdown:
    w = cfg.weights
    parts = {
        "contact": w["contact"] if inp.shared_contact else 0.0,
        "photo": w["photo"]
        if inp.min_photo_distance is not None and inp.min_photo_distance <= cfg.photo_max_distance
        else 0.0,
        "description": w["description"]
        if inp.description_similarity is not None
        and inp.description_similarity >= cfg.description_min_similarity
        else 0.0,
        "rooms_floors": w["rooms_floors"] if inp.rooms_floors_equal else 0.0,
        "area": w["area"] if _within(inp.area_ratio, cfg.area_tolerance) else 0.0,
        "price": w["price"] if _within(inp.price_ratio, cfg.price_tolerance) else 0.0,
    }
    details: dict[str, str] = {}
    if parts["contact"] > 0 and inp.shared_contact_value:
        details["contact"] = inp.shared_contact_value
    return ScoreBreakdown(total=round(sum(parts.values()), 4), parts=parts, details=details)
