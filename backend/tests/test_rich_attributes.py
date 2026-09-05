from datetime import UTC, datetime

import pytest

from app.modules.listings.models import Listing
from app.modules.properties.models import Property


def test_models_have_new_columns():
    for col in (
        "latitude", "longitude", "location_radius_m", "location_precise",
        "location_label", "building_type", "is_furnished", "renovation",
        "year_built", "attributes",
    ):
        assert col in Listing.__table__.columns, f"Listing missing {col}"
    for col in (
        "latitude", "longitude", "location_radius_m", "location_label",
        "building_type", "is_furnished", "renovation", "year_built",
    ):
        assert col in Property.__table__.columns, f"Property missing {col}"


async def test_property_location_columns_round_trip(db):
    prop = Property(
        status="new",
        first_seen_at=datetime.now(UTC),
        last_seen_at=datetime.now(UTC),
        latitude=41.3109,
        longitude=69.2797,
        location_radius_m=2000,
        location_label="Ташкент, Юнусабадский район",
        building_type="brick",
        is_furnished=True,
        renovation="euro",
        year_built=2017,
    )
    db.add(prop)
    await db.flush()
    await db.refresh(prop)
    assert prop.latitude == pytest.approx(41.3109)
    assert prop.building_type == "brick"
    assert prop.year_built == 2017
