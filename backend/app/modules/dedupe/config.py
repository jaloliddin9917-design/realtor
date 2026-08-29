from pathlib import Path

import yaml
from pydantic import BaseModel, model_validator

_REQUIRED_WEIGHT_KEYS = {"contact", "photo", "description", "rooms_floors", "area", "price"}


class DedupeConfig(BaseModel):
    weights: dict[str, float]
    photo_max_distance: int
    description_min_similarity: float
    area_tolerance: float
    price_tolerance: float
    merge_threshold: float
    review_threshold: float

    @model_validator(mode="after")
    def _validate(self) -> "DedupeConfig":
        if set(self.weights) != _REQUIRED_WEIGHT_KEYS:
            raise ValueError(
                f"weights must have exactly the keys {sorted(_REQUIRED_WEIGHT_KEYS)}, "
                f"got {sorted(self.weights)}"
            )
        if not (0 <= self.review_threshold <= self.merge_threshold <= 1):
            raise ValueError(
                "thresholds must satisfy 0 <= review_threshold <= merge_threshold <= 1, got "
                f"review_threshold={self.review_threshold}, merge_threshold={self.merge_threshold}"
            )
        return self


def load_config(path: Path) -> DedupeConfig:
    with path.open() as fh:
        return DedupeConfig.model_validate(yaml.safe_load(fh))
