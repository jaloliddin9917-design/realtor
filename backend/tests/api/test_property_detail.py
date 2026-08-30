"""GET /properties/{id} and POST /properties/{id}/status — detail, photos, status timeline."""

import uuid

import httpx
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.settings import Settings
from app.ingestion.pipeline import ingest_payload
from app.modules.dedupe.config import load_config
from app.modules.dedupe.models import DedupeReview
from app.modules.identity.models import User
from app.modules.listings.models import Listing, Source
from app.modules.properties.models import Property, PropertyStatusEvent
from tests.api.conftest import auth_headers
from tests.fakes import NOW, FakeAdapter, payload

# The short literal secret in the `settings` fixture is an intentional test fixture, not
# a production value; PyJWT's InsecureKeyLengthWarning (HMAC key < 32 bytes) is expected noise.
pytestmark = pytest.mark.filterwarnings("ignore::jwt.InsecureKeyLengthWarning")

CFG = load_config(Settings(_env_file=None).dedupe_config_path)


async def seed_with_photo(db: AsyncSession, settings: Settings) -> tuple[Property, Source]:
    source = Source(kind="telegram", name="@chan", config={"peer": "@chan"})
    db.add(source)
    await db.flush()
    # photo ref 7: FakeAdapter.download_photo renders make_jpeg(300, 200, seed=7) for it
    p = payload(
        "a",
        "Сдаётся 2-комн, хозяин, +998901110001",
        photos=[7],
        structured={
            "rooms": 2,
            "district": "chilonzor",
            "price_amount_minor": 40000,
            "price_currency": "USD",
        },
    )
    result = await ingest_payload(
        db,
        source,
        p,
        adapter=FakeAdapter([p], None),
        cfg=CFG,
        photo_dir=settings.photo_dir,
        now=NOW,
    )
    return result.property, source


async def test_detail_shows_listings_photos_contacts_and_source(
    client: httpx.AsyncClient, settings: Settings, agent: User, db: AsyncSession
) -> None:
    prop, source = await seed_with_photo(db, settings)
    r = await client.get(f"/api/v1/properties/{prop.id}", headers=auth_headers(settings, agent))
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["id"] == str(prop.id)
    assert d["listing_count"] == 1
    assert d["duplicates"] == []
    # every property is born with a crawler "new" event (properties.service.create_from_listing)
    (event,) = d["status_events"]
    assert event["to_status"] == "new"
    assert event["actor_type"] == "crawler"
    assert event["from_status"] is None
    (listing,) = d["listings"]
    assert listing["source"] == {"id": str(source.id), "kind": "telegram", "name": "@chan"}
    assert listing["url"] == "https://t.me/t/a"
    assert listing["external_id"] == "a"
    assert listing["price"] == {"amount_minor": 40000, "currency": "USD", "usd_minor": 40000}
    assert [c["identifier"] for c in listing["contacts"]] == ["+998901110001"]
    (photo,) = listing["photos"]
    assert photo["position"] == 0
    assert photo["url"].startswith("/photos/")
    assert photo["width"] and photo["height"]
    assert d["photo_url"] == photo["url"]
    img = await client.get(photo["url"])
    assert img.status_code == 200
    assert img.headers["content-type"] == "image/jpeg"


async def test_status_change_records_the_agent(
    client: httpx.AsyncClient, settings: Settings, agent: User, db: AsyncSession
) -> None:
    prop, _ = await seed_with_photo(db, settings)
    h = auth_headers(settings, agent)
    r = await client.post(
        f"/api/v1/properties/{prop.id}/status", json={"status": "active"}, headers=h
    )
    assert r.status_code == 200, r.text
    ev = r.json()
    assert ev["from_status"] == "new" and ev["to_status"] == "active"
    assert ev["actor_type"] == "agent" and ev["actor_id"] == str(agent.id)
    r = await client.post(
        f"/api/v1/properties/{prop.id}/status",
        json={"status": "inactive", "note": "ijaraga berildi"},
        headers=h,
    )
    assert r.status_code == 200
    assert r.json()["note"] == "ijaraga berildi"
    d = (await client.get(f"/api/v1/properties/{prop.id}", headers=h)).json()
    assert d["status"] == "inactive"
    # newest first; the crawler's original "new" event is still the oldest entry
    assert [e["to_status"] for e in d["status_events"]] == ["inactive", "active", "new"]
    assert d["last_status_event"]["to_status"] == "inactive"
    stmt = select(PropertyStatusEvent).where(PropertyStatusEvent.property_id == prop.id)
    events = (await db.execute(stmt)).scalars().all()
    assert len(events) == 3


async def test_status_rejects_new_and_unknown_property(
    client: httpx.AsyncClient, settings: Settings, admin: User, db: AsyncSession
) -> None:
    prop, _ = await seed_with_photo(db, settings)
    h = auth_headers(settings, admin)
    r = await client.post(f"/api/v1/properties/{prop.id}/status", json={"status": "new"}, headers=h)
    assert r.status_code == 422
    assert r.json()["code"] == "validation_error"
    r = await client.post(
        f"/api/v1/properties/{uuid.uuid4()}/status", json={"status": "active"}, headers=h
    )
    assert r.status_code == 404
    assert r.json()["code"] == "not_found"
    r = await client.get(f"/api/v1/properties/{uuid.uuid4()}", headers=h)
    assert r.status_code == 404
    r = await client.post(
        f"/api/v1/properties/{prop.id}/status", json={"status": "active"}, headers=h
    )
    assert r.json()["actor_type"] == "admin"


async def test_duplicates_list_the_other_property_with_best_score(
    client: httpx.AsyncClient, settings: Settings, agent: User, db: AsyncSession
) -> None:
    prop, source = await seed_with_photo(db, settings)
    other = await ingest_payload(
        db,
        source,
        payload(
            "b", "Сдаётся 2-комн +998901110002", structured={"rooms": 2, "district": "chilonzor"}
        ),
        adapter=FakeAdapter([], None),
        cfg=CFG,
        photo_dir=settings.photo_dir,
        now=NOW,
    )
    ours = (await db.execute(select(Listing).where(Listing.property_id == prop.id))).scalar_one()
    db.add(
        DedupeReview(
            listing_id=ours.id, candidate_property_id=other.property.id, score=0.55, breakdown={}
        )
    )
    db.add(
        DedupeReview(
            listing_id=other.listing.id, candidate_property_id=prop.id, score=0.62, breakdown={}
        )
    )
    await db.flush()
    r = await client.get(f"/api/v1/properties/{prop.id}", headers=auth_headers(settings, agent))
    assert r.json()["duplicates"] == [{"property_id": str(other.property.id), "score": 0.62}]
    r2 = await client.get(
        f"/api/v1/properties/{other.property.id}", headers=auth_headers(settings, agent)
    )
    assert r2.json()["duplicates"] == [{"property_id": str(prop.id), "score": 0.62}]
