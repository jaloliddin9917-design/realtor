from pathlib import Path

from app.modules.dedupe.config import DedupeConfig, load_config
from app.modules.dedupe.scoring import ScoreInput, score

CFG = load_config(Path(__file__).resolve().parents[1] / "config" / "dedupe.yaml")


def test_config_loads_spec_values() -> None:
    assert (
        CFG.weights["contact"] == 0.5
        and CFG.merge_threshold == 0.75
        and CFG.review_threshold == 0.5
    )


def _inp(**kw: object) -> ScoreInput:
    base: dict[str, object] = dict(
        shared_contact=False,
        min_photo_distance=None,
        description_similarity=None,
        rooms_floors_equal=False,
        area_ratio=None,
        price_ratio=None,
    )
    base.update(kw)
    return ScoreInput(**base)  # type: ignore[arg-type]


def test_nothing_in_common_scores_zero() -> None:
    assert score(_inp(), CFG).total == 0.0


def test_full_match_sums_to_one_point_fifteen() -> None:
    s = score(
        _inp(
            shared_contact=True,
            min_photo_distance=0,
            description_similarity=0.9,
            rooms_floors_equal=True,
            area_ratio=1.0,
            price_ratio=1.0,
        ),
        CFG,
    )
    assert round(s.total, 2) == 1.15
    assert s.parts == {
        "contact": 0.5,
        "photo": 0.3,
        "description": 0.15,
        "rooms_floors": 0.1,
        "area": 0.05,
        "price": 0.05,
    }


def test_photo_distance_boundary() -> None:
    assert score(_inp(min_photo_distance=10), CFG).parts["photo"] == 0.3
    assert score(_inp(min_photo_distance=11), CFG).parts["photo"] == 0.0


def test_description_similarity_boundary() -> None:
    assert score(_inp(description_similarity=0.6), CFG).parts["description"] == 0.15
    assert score(_inp(description_similarity=0.59), CFG).parts["description"] == 0.0


def test_area_and_price_tolerances() -> None:
    assert score(_inp(area_ratio=0.96), CFG).parts["area"] == 0.05
    assert score(_inp(area_ratio=0.94), CFG).parts["area"] == 0.0
    assert score(_inp(price_ratio=1.10), CFG).parts["price"] == 0.05
    assert score(_inp(price_ratio=1.11), CFG).parts["price"] == 0.0


def test_spec_example_scores_0_65() -> None:
    # Chilonzor pair from the mockups: different phones, 2 similar photos, description 0.71,
    # rooms/floors equal, area 54 vs 55, $450 vs $480
    s = score(
        _inp(
            min_photo_distance=6,
            description_similarity=0.71,
            rooms_floors_equal=True,
            area_ratio=55 / 54,
            price_ratio=480 / 450,
        ),
        CFG,
    )
    assert round(s.total, 2) == 0.65


def test_custom_config() -> None:
    cfg = DedupeConfig(
        weights={
            "contact": 1.0,
            "photo": 0,
            "description": 0,
            "rooms_floors": 0,
            "area": 0,
            "price": 0,
        },
        photo_max_distance=10,
        description_min_similarity=0.6,
        area_tolerance=0.05,
        price_tolerance=0.1,
        merge_threshold=0.9,
        review_threshold=0.5,
    )
    assert score(_inp(shared_contact=True), cfg).total == 1.0
