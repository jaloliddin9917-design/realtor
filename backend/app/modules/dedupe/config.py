from pathlib import Path

import yaml
from pydantic import BaseModel


class DedupeConfig(BaseModel):
    weights: dict[str, float]
    photo_max_distance: int
    description_min_similarity: float
    area_tolerance: float
    price_tolerance: float
    merge_threshold: float
    review_threshold: float


def load_config(path: Path) -> DedupeConfig:
    with path.open() as fh:
        return DedupeConfig.model_validate(yaml.safe_load(fh))
