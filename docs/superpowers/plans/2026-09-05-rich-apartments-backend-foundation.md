# Rich apartments — backend foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the location + rich attributes that already sit in every stored OLX payload (coordinates, a location label, building type, furnished, renovation, year built, and a display bag) into columns, roll them up to properties, expose them on the API with new filters and a lightweight `/properties/pins` endpoint, and backfill the 547 stored listings — all with no OLX re-crawl.

**Architecture:** The OLX parser (`ingestion/adapters/olx/state.py`) already writes a `structured` dict that flows `ad_to_payload → parse_text → ParsedListing → persist_parsed → Listing columns`, and `recompute` rolls a "best" listing up to its `Property`. We extend each stage with the new fields, add one Alembic migration, then run the existing network-free `reparse` (which re-runs the parser and calls `recompute`) to populate every stored row.

**Tech Stack:** Python 3.12, FastAPI, SQLAlchemy 2 async, Alembic, PostgreSQL 16, Pydantic v2, pytest.

## Global Constraints

- Python 3.12; SQLAlchemy 2 async; Pydantic v2. Follow the existing module layout under `backend/app/`.
- **New DB columns are nullable** (Telegram/manual listings have no coords/attributes); `attributes` JSONB is `NOT NULL DEFAULT '{}'`.
- **Coordinates are approximate** — never present them as exact; `location_radius_m` and `location_precise` travel with them.
- Run tests with: `TEST_DATABASE_URL=postgresql+asyncpg://realtor:realtor@localhost:5433/realtor_test .venv/bin/pytest` from `backend/` (the session fixture drops the schema and runs `alembic upgrade head`, so a broken migration fails every test). `make` is not installed — call `.venv/bin/*` directly.
- Every git commit message ends with the trailer:
  ```
  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01FaiSj2uQts7dvqkGSrWTm7
  ```
- **Correction to the spec discovered in planning:** the OLX `wc` param is a bathroom *type* ("Совмещенный"/combined), not a count. It becomes `bathroom_type` (string) inside the display `attributes` bag — there is **no** `bathrooms` integer column. `commission`, `kitchen_area_sqm`, `ceiling_height_m`, and amenity lists (`near_is`/`more`) also live in the `attributes` bag (display-only, not filtered).

---

## File Structure

- **Modify** `backend/app/modules/listings/models.py` — add location + attribute columns to `Listing`.
- **Modify** `backend/app/modules/properties/models.py` — add rolled-up columns to `Property`.
- **Create** `backend/alembic/versions/0007_rich_listing_attributes.py` — the migration (revision `0007`, down `0006`).
- **Modify** `backend/app/ingestion/adapters/olx/state.py` — `_map`, `_location_label`, `_attributes` helpers + vocabularies; `ad_to_payload` writes them into `structured`.
- **Modify** `backend/app/ingestion/parse/__init__.py` — `ParsedListing` gains the new fields; `parse_text` passes them through from `structured`.
- **Modify** `backend/app/modules/listings/service.py` — `persist_parsed` writes the new `Listing` columns + `attributes`.
- **Modify** `backend/app/modules/properties/service.py` — `recompute` rolls the new fields up to `Property`.
- **Modify** `backend/app/modules/properties/schemas.py` — `PropertyRow` + `ListingOut` gain the new fields; add `PinOut`.
- **Modify** `backend/app/modules/properties/query.py` — `PropertyFilters`, `select_rows` filters, `row_from`, `_listing_out`, and `list_pins`.
- **Modify** `backend/app/api/routers/properties.py` — new query params + `GET /properties/pins`.
- **Create** `backend/tests/test_rich_attributes.py` — parser + persist + rollup tests (uses the top-level `db` fixture; `asyncio_mode=auto`, so no `@pytest.mark.asyncio`).
- **Modify** `backend/tests/api/test_property_detail.py` — the new-fields-on-detail test (append).
- **Modify** `backend/tests/api/test_properties_list.py` — the new-filter and pins tests (append; reuse its `seed(...)` helper + `sources` fixture; do not rewrite existing tests).
- **Modify** `backend/openapi.json` and `web/src/shared/api/schema.d.ts` — regenerated in the final task.

---

## Task 1: Migration + model columns

**Files:**
- Modify: `backend/app/modules/listings/models.py` (the `Listing` class, after `parse_confidence` at line 121)
- Modify: `backend/app/modules/properties/models.py` (the `Property` class, after `area_sqm` at line 35)
- Create: `backend/alembic/versions/0007_rich_listing_attributes.py`
- Test: `backend/tests/test_rich_attributes.py`

**Interfaces:**
- Produces: new nullable columns on `Listing` — `latitude: float|None`, `longitude: float|None`, `location_radius_m: int|None`, `location_precise: bool|None`, `location_label: str|None`, `building_type: str|None`, `is_furnished: bool|None`, `renovation: str|None`, `year_built: int|None`, `attributes: dict` (NOT NULL default `{}`); and on `Property` the same minus `location_precise` and `attributes`.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_rich_attributes.py`:
```python
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `TEST_DATABASE_URL=postgresql+asyncpg://realtor:realtor@localhost:5433/realtor_test .venv/bin/pytest tests/test_rich_attributes.py -v`
Expected: FAIL — `AttributeError`/`TypeError` (models have no such columns), and the DB round-trip errors because the columns don't exist.

- [ ] **Step 3: Add the `Listing` columns**

In `backend/app/modules/listings/models.py`, immediately after the `parse_confidence` column (line 121), add:
```python
    latitude: Mapped[float | None] = mapped_column(Float)
    longitude: Mapped[float | None] = mapped_column(Float)
    location_radius_m: Mapped[int | None] = mapped_column(Integer)
    location_precise: Mapped[bool | None] = mapped_column(Boolean)
    location_label: Mapped[str | None] = mapped_column(Text)
    building_type: Mapped[str | None] = mapped_column(String(16))
    is_furnished: Mapped[bool | None] = mapped_column(Boolean)
    renovation: Mapped[str | None] = mapped_column(String(16))
    year_built: Mapped[int | None] = mapped_column(Integer)
    attributes: Mapped[dict[str, Any]] = mapped_column(
        JSONB, nullable=False, default=dict, server_default=text("'{}'::jsonb")
    )
```
(`Any`, `JSONB`, and `text` are already imported in this file.)

- [ ] **Step 4: Add the `Property` columns**

In `backend/app/modules/properties/models.py`, immediately after `area_sqm` (line 35), add:
```python
    latitude: Mapped[float | None] = mapped_column(Float)
    longitude: Mapped[float | None] = mapped_column(Float)
    location_radius_m: Mapped[int | None] = mapped_column(Integer)
    location_label: Mapped[str | None] = mapped_column(Text)
    building_type: Mapped[str | None] = mapped_column(String(16))
    is_furnished: Mapped[bool | None] = mapped_column(Boolean)
    renovation: Mapped[str | None] = mapped_column(String(16))
    year_built: Mapped[int | None] = mapped_column(Integer)
```
(`Float`, `Integer`, `Text`, `String`, `Boolean` are already imported.)

- [ ] **Step 5: Write the migration**

Create `backend/alembic/versions/0007_rich_listing_attributes.py`:
```python
"""rich apartments: location + attribute columns on listings and properties

Adds the coordinates (approximate — radius + precise flag travel with them), a
human-readable location label, and the parsed attributes (building type, furnished,
renovation, year built) that already sit unparsed in raw_listings.payload, plus a
display-only JSONB `attributes` bag on listings. Populated by a network-free `reparse`.

Revision ID: 0007
Revises: 0006
Create Date: 2026-09-05
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def _shared_columns() -> list[sa.Column]:
    """Fresh Column objects each call — a Column instance belongs to one table, and
    SQLAlchemy 2.0 removed Column.copy(), so listings and properties each get their own."""
    return [
        sa.Column("latitude", sa.Float(), nullable=True),
        sa.Column("longitude", sa.Float(), nullable=True),
        sa.Column("location_radius_m", sa.Integer(), nullable=True),
        sa.Column("location_label", sa.Text(), nullable=True),
        sa.Column("building_type", sa.String(length=16), nullable=True),
        sa.Column("is_furnished", sa.Boolean(), nullable=True),
        sa.Column("renovation", sa.String(length=16), nullable=True),
        sa.Column("year_built", sa.Integer(), nullable=True),
    ]


def upgrade() -> None:
    for col in _shared_columns():
        op.add_column("listings", col)
    op.add_column("listings", sa.Column("location_precise", sa.Boolean(), nullable=True))
    op.add_column(
        "listings",
        sa.Column(
            "attributes",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
    )
    for col in _shared_columns():
        op.add_column("properties", col)
    op.create_index(
        "ix_properties_lat_lon",
        "properties",
        ["latitude", "longitude"],
        postgresql_where=sa.text("latitude IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("ix_properties_lat_lon", table_name="properties")
    for name in ("latitude", "longitude", "location_radius_m", "location_label",
                 "building_type", "is_furnished", "renovation", "year_built"):
        op.drop_column("properties", name)
    for name in ("attributes", "latitude", "longitude", "location_radius_m",
                 "location_precise", "location_label", "building_type",
                 "is_furnished", "renovation", "year_built"):
        op.drop_column("listings", name)
```

- [ ] **Step 6: Run test to verify it passes**

Run: `TEST_DATABASE_URL=postgresql+asyncpg://realtor:realtor@localhost:5433/realtor_test .venv/bin/pytest tests/test_rich_attributes.py -v`
Expected: PASS (the session fixture runs `alembic upgrade head`, applying `0007`).

- [ ] **Step 7: Commit**

```bash
git add backend/app/modules/listings/models.py backend/app/modules/properties/models.py backend/alembic/versions/0007_rich_listing_attributes.py backend/tests/test_rich_attributes.py
git commit -m "feat(db): location + rich attribute columns on listings and properties (0007)"
```

---

## Task 2: Parser extracts coordinates, location label, and attributes

**Files:**
- Modify: `backend/app/ingestion/adapters/olx/state.py`
- Modify: `backend/app/ingestion/parse/__init__.py`
- Test: `backend/tests/test_rich_attributes.py` (append)

**Interfaces:**
- Consumes: `ParsedListing` from Task 1's columns are the storage target (Task 3 writes them).
- Produces: `ad_to_payload` writes into `structured` the keys `latitude`, `longitude`, `location_radius_m`, `location_precise`, `location_label`, `building_type`, `is_furnished`, `renovation`, `year_built`, and `attributes` (a dict). `ParsedListing` gains matching fields (`attributes: dict[str, Any] = {}`, the rest `… | None = None`). `parse_text` copies them from `structured`.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_rich_attributes.py`:
```python
from app.ingestion.adapters.olx.state import ad_to_payload, extract_state, detail_ad
from app.ingestion.parse import parse_text


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
    ad = {"id": 2, "title": "T", "params": [], "photos": [], "createdTime": "2026-09-01T10:00:00+05:00"}
    s = _payload_structured(ad)
    assert "latitude" not in s and "longitude" not in s


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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `TEST_DATABASE_URL=postgresql+asyncpg://realtor:realtor@localhost:5433/realtor_test .venv/bin/pytest tests/test_rich_attributes.py -k "parses or parse_text or missing_map" -v`
Expected: FAIL (`KeyError`/`AttributeError` — the parser writes none of these yet).

- [ ] **Step 3: Add vocabularies + helpers to the OLX parser**

In `backend/app/ingestion/adapters/olx/state.py`, add near the top (after the existing `from app.ingestion.parse.districts import match_district`):
```python
from app.ingestion.parse.normalize import translit
```
After the `CURRENCY_CODES` constant (line 25), add:
```python
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
```

- [ ] **Step 4: Write them into `structured` in `ad_to_payload`**

In `ad_to_payload`, after the district block (lines 114-116, ending `structured["district"] = district`) and before `hints: list[...]`, insert:
```python
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
```

- [ ] **Step 5: Extend `ParsedListing` and thread it through `parse_text`**

In `backend/app/ingestion/parse/__init__.py`, add to the `ParsedListing` model (after `parse_confidence` at line 32):
```python
    latitude: float | None = None
    longitude: float | None = None
    location_radius_m: int | None = None
    location_precise: bool | None = None
    location_label: str | None = None
    building_type: str | None = None
    is_furnished: bool | None = None
    renovation: str | None = None
    year_built: int | None = None
    attributes: dict[str, Any] = {}
```
Then in `parse_text`, in the `ParsedListing(...)` constructor call (after `district=...` at line 82), add these direct passthroughs (they have no free-text extraction, so read straight from `structured`):
```python
        latitude=s.get("latitude"),
        longitude=s.get("longitude"),
        location_radius_m=s.get("location_radius_m"),
        location_precise=s.get("location_precise"),
        location_label=s.get("location_label"),
        building_type=s.get("building_type"),
        is_furnished=s.get("is_furnished"),
        renovation=s.get("renovation"),
        year_built=s.get("year_built"),
        attributes=s.get("attributes") or {},
```

- [ ] **Step 6: Run test to verify it passes**

Run: `TEST_DATABASE_URL=postgresql+asyncpg://realtor:realtor@localhost:5433/realtor_test .venv/bin/pytest tests/test_rich_attributes.py -k "parses or parse_text or missing_map" -v`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/app/ingestion/adapters/olx/state.py backend/app/ingestion/parse/__init__.py backend/tests/test_rich_attributes.py
git commit -m "feat(ingest): parse OLX coordinates, location label and rich attributes"
```

---

## Task 3: `persist_parsed` writes the new listing columns

**Files:**
- Modify: `backend/app/modules/listings/service.py` (`persist_parsed`, around lines 96-118)
- Test: `backend/tests/test_rich_attributes.py` (append)

**Interfaces:**
- Consumes: `ParsedListing` fields from Task 2.
- Produces: a persisted `Listing` carries `latitude/longitude/location_radius_m/location_precise/location_label/building_type/is_furnished/renovation/year_built/attributes`.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_rich_attributes.py`:
```python
from datetime import UTC, datetime as _dt

from app.ingestion.parse import ParsedListing
from app.modules.listings.models import RawListing, Source
from app.modules.listings.service import persist_parsed


async def test_persist_writes_location_and_attributes(db):
    source = Source(kind="olx", name="olx-test", config={}, state={})
    db.add(source)
    await db.flush()
    raw = RawListing(
        source_id=source.id, external_id="e1", url="u", payload={"ad": {}},
        content_hash="h", fetched_at=_dt.now(UTC),
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
        db, raw, parsed, posted_at=None, now=_dt.now(UTC), usd_rate=None,
    )
    assert listing.latitude == pytest.approx(41.5)
    assert listing.building_type == "brick"
    assert listing.is_furnished is True
    assert listing.year_built == 2017
    assert listing.attributes == {"bathroom_type": "combined"}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `TEST_DATABASE_URL=postgresql+asyncpg://realtor:realtor@localhost:5433/realtor_test .venv/bin/pytest tests/test_rich_attributes.py::test_persist_writes_location_and_attributes -v`
Expected: FAIL — `AttributeError` (persist_parsed never sets these columns; they stay NULL/`{}`).

- [ ] **Step 3: Set the columns in `persist_parsed`**

In `backend/app/modules/listings/service.py`, in `persist_parsed`, after the line `listing.area_sqm, listing.district = parsed.area_sqm, parsed.district` (line 105) and before `listing.posted_at = posted_at`, insert:
```python
    listing.latitude, listing.longitude = parsed.latitude, parsed.longitude
    listing.location_radius_m = parsed.location_radius_m
    listing.location_precise = parsed.location_precise
    listing.location_label = parsed.location_label
    listing.building_type = parsed.building_type
    listing.is_furnished = parsed.is_furnished
    listing.renovation = parsed.renovation
    listing.year_built = parsed.year_built
    listing.attributes = parsed.attributes
```

- [ ] **Step 4: Run test to verify it passes**

Run: `TEST_DATABASE_URL=postgresql+asyncpg://realtor:realtor@localhost:5433/realtor_test .venv/bin/pytest tests/test_rich_attributes.py::test_persist_writes_location_and_attributes -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/modules/listings/service.py backend/tests/test_rich_attributes.py
git commit -m "feat(listings): persist parsed location and attribute fields"
```

---

## Task 4: `recompute` rolls the new fields up to the property

**Files:**
- Modify: `backend/app/modules/properties/service.py` (`recompute`, lines 20-43)
- Test: `backend/tests/test_rich_attributes.py` (append)

**Interfaces:**
- Consumes: `Listing.latitude/…/year_built` from Task 3.
- Produces: after `recompute`, the `Property` carries `latitude/longitude/location_radius_m/location_label/building_type/is_furnished/renovation/year_built` taken from its highest-confidence ("best") listing.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_rich_attributes.py`:
```python
from app.modules.properties.models import Property
from app.modules.properties.service import recompute


async def test_recompute_rolls_location_up_to_property(db):
    source = Source(kind="olx", name="olx-roll", config={}, state={})
    db.add(source)
    await db.flush()
    raw = RawListing(source_id=source.id, external_id="r1", url="u", payload={"ad": {}},
                     content_hash="h", fetched_at=_dt.now(UTC))
    db.add(raw)
    await db.flush()
    prop = Property(status="new", first_seen_at=_dt.now(UTC), last_seen_at=_dt.now(UTC))
    db.add(prop)
    await db.flush()
    parsed = ParsedListing(
        title="T", description="d", parse_confidence=0.9,
        latitude=41.9, longitude=69.9, location_radius_m=3000, location_label="Loc",
        building_type="panel", is_furnished=False, renovation="cosmetic", year_built=2005,
    )
    listing = await persist_parsed(db, raw, parsed, posted_at=None, now=_dt.now(UTC), usd_rate=None)
    listing.property_id = prop.id
    await db.flush()
    await recompute(db, prop)
    assert prop.latitude == pytest.approx(41.9)
    assert prop.location_label == "Loc"
    assert prop.building_type == "panel"
    assert prop.is_furnished is False
    assert prop.year_built == 2005
```

- [ ] **Step 2: Run test to verify it fails**

Run: `TEST_DATABASE_URL=postgresql+asyncpg://realtor:realtor@localhost:5433/realtor_test .venv/bin/pytest tests/test_rich_attributes.py::test_recompute_rolls_location_up_to_property -v`
Expected: FAIL — the property's `latitude`/`building_type`/… stay `None`.

- [ ] **Step 3: Roll the fields up in `recompute`**

In `backend/app/modules/properties/service.py`, in `recompute`, after `prop.total_floors, prop.area_sqm = best.total_floors, best.area_sqm` (line 29), insert:
```python
    prop.latitude, prop.longitude = best.latitude, best.longitude
    prop.location_radius_m = best.location_radius_m
    prop.location_label = best.location_label
    prop.building_type = best.building_type
    prop.is_furnished = best.is_furnished
    prop.renovation = best.renovation
    prop.year_built = best.year_built
```

- [ ] **Step 4: Run test to verify it passes**

Run: `TEST_DATABASE_URL=postgresql+asyncpg://realtor:realtor@localhost:5433/realtor_test .venv/bin/pytest tests/test_rich_attributes.py::test_recompute_rolls_location_up_to_property -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/modules/properties/service.py backend/tests/test_rich_attributes.py
git commit -m "feat(properties): roll location and attributes up to the property"
```

---

## Task 5: API schemas + row/listing builders expose the new fields

**Files:**
- Modify: `backend/app/modules/properties/schemas.py` (`PropertyRow` ~line 42, `ListingOut` ~line 91; add `PinOut`)
- Modify: `backend/app/modules/properties/query.py` (`row_from` ~line 189, `_listing_out` ~line 235)
- Test: `backend/tests/api/test_property_detail.py` (append)

**Interfaces:**
- Produces: `PropertyRow`/`PropertyDetail` and `ListingOut` JSON now include `latitude`, `longitude`, `location_radius_m`, `location_label`, `building_type`, `is_furnished`, `renovation`, `year_built` (and `ListingOut` also `location_precise` + `attributes: dict`). New `PinOut` model `{id, latitude, longitude, price_usd_min_minor, rooms, status, source_removed}` for Task 7.

> **Test conventions in this file (verified):** `pyproject.toml` sets `asyncio_mode = "auto"`, so tests are bare `async def test_…` with **no** `@pytest.mark.asyncio`. Properties are seeded through the real pipeline: `payload(ext, text, *, structured=…, photos=…)` (from `tests.fakes`) → `ingest_payload(db, source, p, adapter=FakeAdapter([p], None), cfg=CFG, photo_dir=settings.photo_dir, now=NOW)`. The `structured` dict is exactly what `parse_text` reads — so seeding coords/attributes means putting **already-normalized** values (`"brick"`, floats) into `structured`. Auth is `headers=auth_headers(settings, agent)`. `test_property_detail.py` already imports `httpx, Settings, ingest_payload, CFG, User, Source, auth_headers, NOW, FakeAdapter, payload`; add `import pytest` (for `pytest.approx`).

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/api/test_property_detail.py`:
```python
async def test_detail_exposes_location_and_attributes(
    client: httpx.AsyncClient, settings: Settings, agent: User, db: AsyncSession
) -> None:
    source = Source(kind="olx", name="olx-detail", config={"url": "https://www.olx.uz/x/"})
    db.add(source)
    await db.flush()
    p = payload(
        "loc1",
        "Сдаётся 2-комн +998901110001",
        structured={
            "rooms": 2, "district": "yunusobod",
            "latitude": 41.31, "longitude": 69.28, "location_radius_m": 2000,
            "location_precise": False, "location_label": "Ташкент, Юнусабадский район",
            "building_type": "brick", "is_furnished": True, "renovation": "euro",
            "year_built": 2017, "attributes": {"bathroom_type": "combined"},
        },
    )
    result = await ingest_payload(
        db, source, p, adapter=FakeAdapter([p], None), cfg=CFG,
        photo_dir=settings.photo_dir, now=NOW,
    )
    r = await client.get(
        f"/api/v1/properties/{result.property.id}", headers=auth_headers(settings, agent)
    )
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["latitude"] == pytest.approx(41.31)
    assert d["building_type"] == "brick"
    assert d["year_built"] == 2017
    listing = d["listings"][0]
    assert listing["location_precise"] is False
    assert listing["attributes"]["bathroom_type"] == "combined"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `TEST_DATABASE_URL=postgresql+asyncpg://realtor:realtor@localhost:5433/realtor_test .venv/bin/pytest tests/api/test_property_detail.py::test_detail_exposes_location_and_attributes -v`
Expected: FAIL — `KeyError`/assertion (`latitude` absent from the response).

- [ ] **Step 3: Extend the schemas**

In `backend/app/modules/properties/schemas.py`, add to `PropertyRow` (after `area_sqm: float | None` at line 49):
```python
    latitude: float | None
    longitude: float | None
    location_radius_m: int | None
    location_label: str | None
    building_type: str | None
    is_furnished: bool | None
    renovation: str | None
    year_built: int | None
```
Add to `ListingOut` (after `district: str | None` at line 103):
```python
    latitude: float | None
    longitude: float | None
    location_radius_m: int | None
    location_precise: bool | None
    location_label: str | None
    building_type: str | None
    is_furnished: bool | None
    renovation: str | None
    year_built: int | None
    attributes: dict[str, Any]
```
Add `from typing import Any, Literal` (extend the existing `from typing import Literal` import). Add a new model after `PropertyPage` (line 66):
```python
class PinOut(BaseModel):
    id: uuid.UUID
    latitude: float
    longitude: float
    price_usd_min_minor: int | None
    rooms: int | None
    status: PropertyStatus
    source_removed: bool
```

- [ ] **Step 4: Populate them in the builders**

In `backend/app/modules/properties/query.py`, in `row_from` (the `PropertyRow(...)` return at line 197), add after `area_sqm=prop.area_sqm,` (line 204):
```python
        latitude=prop.latitude,
        longitude=prop.longitude,
        location_radius_m=prop.location_radius_m,
        location_label=prop.location_label,
        building_type=prop.building_type,
        is_furnished=prop.is_furnished,
        renovation=prop.renovation,
        year_built=prop.year_built,
```
In `_listing_out` (the `ListingOut(...)` return at line 238), add after `district=listing.district,` (line 256):
```python
        latitude=listing.latitude,
        longitude=listing.longitude,
        location_radius_m=listing.location_radius_m,
        location_precise=listing.location_precise,
        location_label=listing.location_label,
        building_type=listing.building_type,
        is_furnished=listing.is_furnished,
        renovation=listing.renovation,
        year_built=listing.year_built,
        attributes=listing.attributes,
```

- [ ] **Step 5: Run test to verify it passes**

Run: `TEST_DATABASE_URL=postgresql+asyncpg://realtor:realtor@localhost:5433/realtor_test .venv/bin/pytest tests/api/test_property_detail.py::test_detail_exposes_location_and_attributes -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/app/modules/properties/schemas.py backend/app/modules/properties/query.py backend/tests/api/test_property_detail.py
git commit -m "feat(api): expose location and attributes on property rows, detail and listings"
```

---

## Task 6: New filters + router query params

**Files:**
- Modify: `backend/app/modules/properties/query.py` (`PropertyFilters` line 42-55; `select_rows` line 80-158)
- Modify: `backend/app/api/routers/properties.py` (`list_properties_endpoint` line 28-60)
- Test: `backend/tests/api/test_properties_list.py` (append; reuse this file's `seed(...)` helper and `sources` fixture)

**Interfaces:**
- Consumes: the new `Property` columns.
- Produces: `PropertyFilters` gains `area_min: float|None`, `area_max: float|None`, `floor_min: int|None`, `floor_max: int|None`, `not_first_floor: bool=False`, `not_top_floor: bool=False`, `building_type: list[str]`, `furnished: bool|None`, `renovation: list[str]`, `posted_within: str|None` (`"24h"|"3d"|"7d"`), `has_photos: bool=False`, `bbox: tuple[float,float,float,float]|None` (min_lat, min_lon, max_lat, max_lon). `GET /properties` accepts matching query params.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/api/test_properties_list.py`. It reuses this file's `seed(db, settings, source, ext, text, structured, ...)` helper and `sources` fixture (`tg, olx`); distinct phone numbers keep the seeded properties from deduping into one:
```python
async def test_filters_by_building_type_and_area(
    client: httpx.AsyncClient, settings: Settings, agent: User,
    sources: tuple[Source, Source], db: AsyncSession,
) -> None:
    _tg, olx = sources
    await seed(db, settings, olx, "bt1", "Сдаётся +998900000001",
               {"building_type": "brick", "area_sqm": 80.0})
    await seed(db, settings, olx, "bt2", "Сдаётся +998900000002",
               {"building_type": "panel", "area_sqm": 40.0})
    h = auth_headers(settings, agent)
    r1 = await client.get("/api/v1/properties", params={"building_type": "brick"}, headers=h)
    assert r1.status_code == 200, r1.text
    assert r1.json()["total"] == 1
    assert r1.json()["items"][0]["building_type"] == "brick"
    r2 = await client.get("/api/v1/properties", params={"area_min": 60}, headers=h)
    assert r2.json()["total"] == 1
    assert r2.json()["items"][0]["area_sqm"] >= 60


async def test_filters_by_bbox(
    client: httpx.AsyncClient, settings: Settings, agent: User,
    sources: tuple[Source, Source], db: AsyncSession,
) -> None:
    _tg, olx = sources
    await seed(db, settings, olx, "in1", "Сдаётся +998900000003",
               {"latitude": 41.31, "longitude": 69.28})
    await seed(db, settings, olx, "out1", "Сдаётся +998900000004",
               {"latitude": 40.00, "longitude": 65.00})
    r = await client.get(
        "/api/v1/properties",
        params={"min_lat": 41.0, "min_lon": 69.0, "max_lat": 42.0, "max_lon": 70.0},
        headers=auth_headers(settings, agent),
    )
    assert r.status_code == 200
    assert r.json()["total"] == 1


async def test_not_first_floor(
    client: httpx.AsyncClient, settings: Settings, agent: User,
    sources: tuple[Source, Source], db: AsyncSession,
) -> None:
    _tg, olx = sources
    await seed(db, settings, olx, "fl1", "Сдаётся +998900000005", {"floor": 1, "total_floors": 5})
    await seed(db, settings, olx, "fl3", "Сдаётся +998900000006", {"floor": 3, "total_floors": 5})
    r = await client.get(
        "/api/v1/properties", params={"not_first_floor": "true"},
        headers=auth_headers(settings, agent),
    )
    assert r.json()["total"] == 1
    assert r.json()["items"][0]["floor"] == 3
```

- [ ] **Step 2: Run test to verify it fails**

Run: `TEST_DATABASE_URL=postgresql+asyncpg://realtor:realtor@localhost:5433/realtor_test .venv/bin/pytest tests/api/test_properties_list.py -k "building_type or bbox or not_first_floor" -v`
Expected: FAIL — the query params are ignored, so totals are 2 not 1.

- [ ] **Step 3: Extend `PropertyFilters`**

In `backend/app/modules/properties/query.py`, add to the `PropertyFilters` dataclass (after `removed: bool = False` at line 51):
```python
    area_min: float | None = None
    area_max: float | None = None
    floor_min: int | None = None
    floor_max: int | None = None
    not_first_floor: bool = False
    not_top_floor: bool = False
    building_type: list[str] = field(default_factory=list)
    furnished: bool | None = None
    renovation: list[str] = field(default_factory=list)
    posted_within: str | None = None
    has_photos: bool = False
    bbox: tuple[float, float, float, float] | None = None
```

- [ ] **Step 4: Add the WHERE clauses in `select_rows`**

In `select_rows`, immediately before `return stmt` (line 158), insert:
```python
    if f.area_min is not None:
        stmt = stmt.where(Property.area_sqm >= f.area_min)
    if f.area_max is not None:
        stmt = stmt.where(Property.area_sqm <= f.area_max)
    if f.floor_min is not None:
        stmt = stmt.where(Property.floor >= f.floor_min)
    if f.floor_max is not None:
        stmt = stmt.where(Property.floor <= f.floor_max)
    if f.not_first_floor:
        stmt = stmt.where(Property.floor.is_not(None), Property.floor > 1)
    if f.not_top_floor:
        stmt = stmt.where(
            Property.floor.is_not(None),
            Property.total_floors.is_not(None),
            Property.floor < Property.total_floors,
        )
    if f.building_type:
        stmt = stmt.where(Property.building_type.in_(f.building_type))
    if f.furnished is not None:
        stmt = stmt.where(Property.is_furnished.is_(f.furnished))
    if f.renovation:
        stmt = stmt.where(Property.renovation.in_(f.renovation))
    if f.posted_within:
        cutoff = {"24h": timedelta(hours=24), "3d": timedelta(days=3), "7d": timedelta(days=7)}.get(
            f.posted_within
        )
        if cutoff is not None:
            stmt = stmt.where(Property.last_seen_at >= func.now() - cutoff)
    if f.has_photos:
        has_photo = (
            select(Listing.property_id)
            .join(ListingPhoto, ListingPhoto.listing_id == Listing.id)
            .where(ListingPhoto.storage_key.is_not(None))
        )
        stmt = stmt.where(Property.id.in_(has_photo))
    if f.bbox is not None:
        min_lat, min_lon, max_lat, max_lon = f.bbox
        stmt = stmt.where(
            Property.latitude.is_not(None),
            Property.latitude >= min_lat,
            Property.latitude <= max_lat,
            Property.longitude >= min_lon,
            Property.longitude <= max_lon,
        )
```
Add `from datetime import timedelta` at the top of the file (there is no datetime import there yet).

> Note on `posted_within`: `Listing.posted_at` is often NULL for OLX, so the cutoff filters on `Property.last_seen_at` (always set) — "seen in the last N" is the meaningful, non-null recency signal. This is intentional.

- [ ] **Step 5: Add the query params to the router**

In `backend/app/api/routers/properties.py`, add these parameters to `list_properties_endpoint` (after `removed: … = False` at line 39, before `q:`):
```python
    area_min: Annotated[float | None, Query(ge=0)] = None,
    area_max: Annotated[float | None, Query(ge=0)] = None,
    floor_min: Annotated[int | None, Query(ge=0)] = None,
    floor_max: Annotated[int | None, Query(ge=0)] = None,
    not_first_floor: bool = False,
    not_top_floor: bool = False,
    building_type: Annotated[list[str] | None, Query()] = None,
    furnished: Annotated[bool | None, Query()] = None,
    renovation: Annotated[list[str] | None, Query()] = None,
    posted_within: Annotated[Literal["24h", "3d", "7d"] | None, Query()] = None,
    has_photos: bool = False,
    min_lat: Annotated[float | None, Query(ge=-90, le=90)] = None,
    min_lon: Annotated[float | None, Query(ge=-180, le=180)] = None,
    max_lat: Annotated[float | None, Query(ge=-90, le=90)] = None,
    max_lon: Annotated[float | None, Query(ge=-180, le=180)] = None,
```
And pass them into `PropertyFilters(...)` (extend the constructor call at line 45), after `removed=removed,`:
```python
        area_min=area_min,
        area_max=area_max,
        floor_min=floor_min,
        floor_max=floor_max,
        not_first_floor=not_first_floor,
        not_top_floor=not_top_floor,
        building_type=building_type or [],
        furnished=furnished,
        renovation=renovation or [],
        posted_within=posted_within,
        has_photos=has_photos,
        bbox=(
            (min_lat, min_lon, max_lat, max_lon)
            if None not in (min_lat, min_lon, max_lat, max_lon)
            else None
        ),
```

- [ ] **Step 6: Run test to verify it passes**

Run: `TEST_DATABASE_URL=postgresql+asyncpg://realtor:realtor@localhost:5433/realtor_test .venv/bin/pytest tests/api/test_properties_list.py -k "building_type or bbox or not_first_floor" -v`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/app/modules/properties/query.py backend/app/api/routers/properties.py backend/tests/api/test_properties_list.py
git commit -m "feat(api): area/floor/building-type/furnished/renovation/posted-within/has-photos/bbox filters"
```

---

## Task 7: `GET /properties/pins` endpoint

**Files:**
- Modify: `backend/app/modules/properties/query.py` (add `list_pins`)
- Modify: `backend/app/api/routers/properties.py` (add the route **before** `/properties/{property_id}`)
- Test: `backend/tests/api/test_properties_list.py` (append; reuse `seed(...)` + `sources`)

**Interfaces:**
- Consumes: `PropertyFilters` (Task 6), `PinOut` (Task 5).
- Produces: `async def list_pins(session, f: PropertyFilters, *, cap: int = 2000) -> list[PinOut]`; `GET /properties/pins` returns `list[PinOut]` for all matches that have coordinates, newest-first, capped.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/api/test_properties_list.py`:
```python
async def test_pins_returns_only_located_matches(
    client: httpx.AsyncClient, settings: Settings, agent: User,
    sources: tuple[Source, Source], db: AsyncSession,
) -> None:
    _tg, olx = sources
    await seed(db, settings, olx, "pin1", "Сдаётся +998900000011",
               {"latitude": 41.31, "longitude": 69.28, "building_type": "brick"})
    await seed(db, settings, olx, "pin2", "Сдаётся +998900000012", {})  # no coords -> omitted
    await seed(db, settings, olx, "pin3", "Сдаётся +998900000013",
               {"latitude": 41.20, "longitude": 69.10, "building_type": "panel"})
    h = auth_headers(settings, agent)
    r = await client.get("/api/v1/properties/pins", headers=h)
    assert r.status_code == 200, r.text
    pins = r.json()
    assert len(pins) == 2
    assert all(p["latitude"] is not None and p["longitude"] is not None for p in pins)
    r2 = await client.get("/api/v1/properties/pins", params={"building_type": "brick"}, headers=h)
    assert len(r2.json()) == 1
```

- [ ] **Step 2: Run test to verify it fails**

Run: `TEST_DATABASE_URL=postgresql+asyncpg://realtor:realtor@localhost:5433/realtor_test .venv/bin/pytest tests/api/test_properties_list.py -k pins -v`
Expected: FAIL — 404 (route does not exist).

- [ ] **Step 3: Add `list_pins` to the query module**

In `backend/app/modules/properties/query.py`, add after `list_properties` (line 229). It reuses `select_rows` for the filter WHERE-clauses, then narrows the selection to located rows:
```python
async def list_pins(session: AsyncSession, f: PropertyFilters, *, cap: int = 2000) -> list[PinOut]:
    stmt = (
        select_rows(f, count=False)
        .where(Property.latitude.is_not(None), Property.longitude.is_not(None))
        .order_by(Property.last_seen_at.desc(), Property.id)
        .limit(cap)
    )
    rows = (await session.execute(stmt)).all()
    return [
        PinOut(
            id=prop.id,
            latitude=prop.latitude,
            longitude=prop.longitude,
            price_usd_min_minor=prop.price_usd_min_minor,
            rooms=prop.rooms,
            status=cast(PropertyStatus, prop.status),
            source_removed=prop.source_removed,
        )
        for (prop, *_rest) in rows
    ]
```
Add `PinOut` to the imports from `app.modules.properties.schemas` (the block at line 24).

> `select_rows(count=False)` returns tuples `(Property, listing_count, source_kinds, Owner, PropertyStatusEvent, photo_key)`; `list_pins` uses only the first element, hence `(prop, *_rest)`.

- [ ] **Step 4: Add the route (before the `{property_id}` route)**

In `backend/app/api/routers/properties.py`, add imports: `list_pins` (from `...query`) and `PinOut` (from `...schemas`). Insert this route **immediately after** `list_properties_endpoint` and **before** `property_detail` (so the literal `/properties/pins` is declared ahead of `/properties/{property_id}`):
```python
@router.get("/properties/pins", response_model=list[PinOut], responses=PROBLEM_422)
async def property_pins(
    session: SessionDep,
    _: CurrentUser,
    district: Annotated[list[str] | None, Query()] = None,
    rooms: Annotated[list[int] | None, Query()] = None,
    price_min: Annotated[int | None, Query(ge=0)] = None,
    price_max: Annotated[int | None, Query(ge=0)] = None,
    status: Annotated[list[PropertyStatus] | None, Query()] = None,
    source: Annotated[Literal["olx", "telegram", "manual"] | None, Query()] = None,
    owner_only: bool = False,
    removed: bool = False,
    q: Annotated[str | None, Query(max_length=200)] = None,
    area_min: Annotated[float | None, Query(ge=0)] = None,
    area_max: Annotated[float | None, Query(ge=0)] = None,
    floor_min: Annotated[int | None, Query(ge=0)] = None,
    floor_max: Annotated[int | None, Query(ge=0)] = None,
    not_first_floor: bool = False,
    not_top_floor: bool = False,
    building_type: Annotated[list[str] | None, Query()] = None,
    furnished: Annotated[bool | None, Query()] = None,
    renovation: Annotated[list[str] | None, Query()] = None,
    posted_within: Annotated[Literal["24h", "3d", "7d"] | None, Query()] = None,
    has_photos: bool = False,
    min_lat: Annotated[float | None, Query(ge=-90, le=90)] = None,
    min_lon: Annotated[float | None, Query(ge=-180, le=180)] = None,
    max_lat: Annotated[float | None, Query(ge=-90, le=90)] = None,
    max_lon: Annotated[float | None, Query(ge=-180, le=180)] = None,
) -> list[PinOut]:
    filters = PropertyFilters(
        district=district or [], rooms=rooms or [], price_min=price_min, price_max=price_max,
        status=status or [], source=source, owner_only=owner_only, removed=removed, q=q,
        area_min=area_min, area_max=area_max, floor_min=floor_min, floor_max=floor_max,
        not_first_floor=not_first_floor, not_top_floor=not_top_floor,
        building_type=building_type or [], furnished=furnished, renovation=renovation or [],
        posted_within=posted_within, has_photos=has_photos,
        bbox=(
            (min_lat, min_lon, max_lat, max_lon)
            if None not in (min_lat, min_lon, max_lat, max_lon)
            else None
        ),
    )
    return await list_pins(session, filters)
```

- [ ] **Step 5: Run test to verify it passes**

Run: `TEST_DATABASE_URL=postgresql+asyncpg://realtor:realtor@localhost:5433/realtor_test .venv/bin/pytest tests/api/test_properties_list.py -k pins -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/app/modules/properties/query.py backend/app/api/routers/properties.py backend/tests/api/test_properties_list.py
git commit -m "feat(api): GET /properties/pins — lightweight located rows for the map"
```

---

## Task 8: Full suite, backfill the stored data, regenerate the client

**Files:**
- Modify: `backend/openapi.json` (regenerated)
- Modify: `web/src/shared/api/schema.d.ts` (regenerated)

**Interfaces:** none (verification + data + generated artifacts).

- [ ] **Step 1: Run the full backend suite**

Run: `TEST_DATABASE_URL=postgresql+asyncpg://realtor:realtor@localhost:5433/realtor_test .venv/bin/pytest -q`
Expected: PASS (all prior tests plus the new ones; ~444 tests).

- [ ] **Step 2: Lint + typecheck**

Run: `.venv/bin/ruff check app tests && .venv/bin/mypy app`
Expected: clean. Fix any issue (e.g. an unused import) before continuing.

- [ ] **Step 3: Apply the migration to the dev database**

Run: `DATABASE_URL=postgresql+asyncpg://realtor:realtor@localhost:5433/realtor .venv/bin/alembic upgrade head`
Expected: `Running upgrade 0006 -> 0007`.

- [ ] **Step 4: Backfill the 547 stored OLX listings (no network)**

Run: `DATABASE_URL=postgresql+asyncpg://realtor:realtor@localhost:5433/realtor .venv/bin/python -m app.cli reparse --source olx-rent`
Expected: `reparsed <N> listings, 0 failed`.

- [ ] **Step 5: Verify the backfill populated coordinates**

Run:
```bash
export DOCKER_HOST=unix:///var/run/docker.sock
docker exec deploy-postgres-1 psql -U realtor -d realtor -t -c \
  "SELECT count(*) FILTER (WHERE latitude IS NOT NULL) AS with_coords, count(*) AS total, count(*) FILTER (WHERE building_type IS NOT NULL) AS with_building_type FROM properties;"
```
Expected: `with_coords` and `with_building_type` are both large (most of `total`).

- [ ] **Step 6: Regenerate the OpenAPI spec + the web client**

Run:
```bash
cd /home/jaloliddin/DataMicron/StartUp/realtor-app/backend && .venv/bin/python -m app.api openapi > openapi.json
cd /home/jaloliddin/DataMicron/StartUp/realtor-app && pnpm --dir web api:generate && pnpm --dir web api:check
```
Expected: `openapi.json` gains `/api/v1/properties/pins` and the new fields/params; `api:check` prints "api client is current".

- [ ] **Step 7: Commit**

```bash
git add backend/openapi.json web/src/shared/api/schema.d.ts
git commit -m "chore(api): regenerate OpenAPI + web client for rich apartments; backfill stored OLX data"
```

---

## Self-Review

**Spec coverage:** §2 findings → confirmed; §3.1 parser → Task 2; §3.2 columns → Task 1; §3.3 backfill → Task 8; §4 schemas/filters/pins → Tasks 5–7. Rich-detail/filters/map UI (§5–§8 of the spec) are **Plan 2 (frontend)**, written after this plan lands. §11 backend tests → Tasks 1–7. §12 acceptance #1 (coords/label/attrs populated) → Task 8 Step 5.

**Placeholder scan:** none — every step has concrete code or an exact command. Test snippets use the codebase's real seeding path (`payload(structured=…)` → `ingest_payload` + `FakeAdapter`, and this file's `seed(...)`/`sources`) and `auth_headers(settings, agent)`, verified against `test_properties_list.py`/`test_property_detail.py`.

**Type consistency:** `ParsedListing` fields (Task 2) ⇄ `persist_parsed` assignments (Task 3) ⇄ `Listing` columns (Task 1) ⇄ `recompute` rollup (Task 4) ⇄ `PropertyRow`/`ListingOut` builders (Task 5) — names match exactly (`latitude`, `longitude`, `location_radius_m`, `location_precise` [listing only], `location_label`, `building_type`, `is_furnished`, `renovation`, `year_built`, `attributes` [listing only]). `PinOut` (Task 5) ⇄ `list_pins` (Task 7) fields match. `PropertyFilters` new fields (Task 6) ⇄ both router endpoints (Tasks 6, 7) match. `bbox` is built identically in both endpoints.
