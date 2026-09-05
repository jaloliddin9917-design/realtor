from datetime import UTC, datetime

import pytest

from app.ingestion.adapters.olx.state import ad_to_payload, detail_ad, extract_state
from app.ingestion.parse import ParsedListing, parse_text
from app.modules.listings.models import Listing, RawListing, Source
from app.modules.listings.service import persist_parsed
from app.modules.properties.models import Property
from app.modules.properties.service import recompute


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


def _payload_structured(ad, phones=()):
    return ad_to_payload(ad, list(phones)).structured


def test_parses_map_coordinates():
    ad = {
        "id": 1, "title": "T", "url": "u",
        "map": {"lat": 41.2637, "lon": 69.2300, "zoom": 13, "radius": 2, "show_detailed": False},
        "location": {"pathName": "Ташкентская область, Ташкент, Юнусабадский район"},
        "params": [], "photos": [], "createdTime": "2026-09-01T10:00:00+05:00",
    }
    s = _payload_structured(ad)
    assert s["latitude"] == 41.2637
    assert s["longitude"] == 69.2300
    assert s["location_radius_m"] == 2000
    assert s["location_precise"] is False
    assert s["location_label"] == "Ташкентская область, Ташкент, Юнусабадский район"


def test_parses_attributes_from_real_fixture():
    ad = detail_ad(extract_state(open("tests/fixtures/olx/detail_page.html").read()))
    s = _payload_structured(ad)
    assert s["building_type"] == "brick"        # house_type=Кирпичный
    assert s["is_furnished"] is True            # furnished=Да
    assert s["renovation"] == "euro"            # repairs=Евроремонт
    assert s["year_built"] == 2017
    assert s["attributes"]["bathroom_type"] == "combined"   # wc=Совмещенный
    assert s["attributes"]["commission"] is True            # comission=Да
    assert "latitude" not in s                  # this fixture has no ad.map -> graceful


def test_missing_map_yields_no_coordinates():
    ad = {
        "id": 2, "title": "T", "params": [], "photos": [],
        "createdTime": "2026-09-01T10:00:00+05:00",
    }
    s = _payload_structured(ad)
    assert "latitude" not in s and "longitude" not in s


def test_unmatched_attributes_are_omitted_or_other():
    ad = {
        "id": 9, "title": "T", "photos": [], "createdTime": "2026-09-01T10:00:00+05:00",
        "params": [
            {"key": "house_type", "value": "Неизвестный тип"},  # present but unmatched -> "other"
            {"key": "comission", "value": "Возможно"},          # _yesno can't classify -> omitted
        ],
    }
    s = ad_to_payload(ad, []).structured
    assert s["building_type"] == "other"
    assert "commission" not in s.get("attributes", {})


def test_parse_text_threads_structured_attributes():
    parsed = parse_text(
        "T\ndesc",
        structured={"title": "T", "latitude": 41.5, "longitude": 69.1, "building_type": "panel",
                    "is_furnished": False, "renovation": "cosmetic", "year_built": 2010,
                    "location_label": "L", "location_radius_m": 3000, "location_precise": True,
                    "attributes": {"bathroom_type": "separate"}},
    )
    assert parsed.latitude == 41.5
    assert parsed.building_type == "panel"
    assert parsed.is_furnished is False
    assert parsed.year_built == 2010
    assert parsed.attributes == {"bathroom_type": "separate"}


async def test_persist_writes_location_and_attributes(db):
    source = Source(kind="olx", name="olx-test", config={}, state={})
    db.add(source)
    await db.flush()
    raw = RawListing(
        source_id=source.id, external_id="e1", url="u", payload={"ad": {}},
        content_hash="h", fetched_at=datetime.now(UTC),
    )
    db.add(raw)
    await db.flush()
    parsed = ParsedListing(
        title="T", description="d", latitude=41.5, longitude=69.1,
        location_radius_m=2000, location_precise=False, location_label="Tashkent",
        building_type="brick", is_furnished=True, renovation="euro", year_built=2017,
        attributes={"bathroom_type": "combined"},
    )
    listing = await persist_parsed(
        db, raw, parsed, posted_at=None, now=datetime.now(UTC), usd_rate=None,
    )
    await db.refresh(listing)  # real read-back from Postgres, not the mutated in-memory object
    assert listing.latitude == pytest.approx(41.5)
    assert listing.longitude == pytest.approx(69.1)
    assert listing.location_radius_m == 2000
    assert listing.location_precise is False
    assert listing.location_label == "Tashkent"
    assert listing.building_type == "brick"
    assert listing.is_furnished is True
    assert listing.renovation == "euro"
    assert listing.year_built == 2017
    assert listing.attributes == {"bathroom_type": "combined"}


async def test_recompute_rolls_location_up_to_property(db):
    source = Source(kind="olx", name="olx-roll", config={}, state={})
    db.add(source)
    await db.flush()
    raw = RawListing(
        source_id=source.id, external_id="r1", url="u", payload={"ad": {}},
        content_hash="h", fetched_at=datetime.now(UTC),
    )
    db.add(raw)
    await db.flush()
    prop = Property(
        status="new", first_seen_at=datetime.now(UTC), last_seen_at=datetime.now(UTC)
    )
    db.add(prop)
    await db.flush()
    parsed = ParsedListing(
        title="T", description="d", parse_confidence=0.9,
        latitude=41.9, longitude=69.9, location_radius_m=3000, location_label="Loc",
        building_type="panel", is_furnished=False, renovation="cosmetic", year_built=2005,
    )
    listing = await persist_parsed(
        db, raw, parsed, posted_at=None, now=datetime.now(UTC), usd_rate=None,
    )
    listing.property_id = prop.id
    await db.flush()
    await recompute(db, prop)
    await db.refresh(prop)  # real read-back from Postgres, not the mutated in-memory object
    assert prop.latitude == pytest.approx(41.9)
    assert prop.longitude == pytest.approx(69.9)
    assert prop.location_radius_m == 3000
    assert prop.location_label == "Loc"
    assert prop.building_type == "panel"
    assert prop.is_furnished is False
    assert prop.renovation == "cosmetic"
    assert prop.year_built == 2005
