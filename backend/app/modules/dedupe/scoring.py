from dataclasses import dataclass

from app.modules.dedupe.config import DedupeConfig


@dataclass
class ScoreInput:
    shared_contact: bool
    min_photo_distance: int | None
    description_similarity: float | None
    rooms_floors_equal: bool
    area_ratio: float | None
    price_ratio: float | None


@dataclass
class ScoreBreakdown:
    total: float
    parts: dict[str, float]


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
    return ScoreBreakdown(total=round(sum(parts.values()), 4), parts=parts)
