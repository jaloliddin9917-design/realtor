"""GET /properties — seeded through the real pipeline so rows carry listings and contacts."""

import uuid
from datetime import timedelta
from typing import Any

import httpx
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.settings import Settings
from app.ingestion.pipeline import ingest_payload
from app.modules.contacts.scoring import rescore_contact, update_probable_owner
from app.modules.contacts.service import contacts_for_listing
from app.modules.dedupe.config import load_config
from app.modules.identity.models import User
from app.modules.listings.models import Listing, Source
from app.modules.properties.models import Property
from app.modules.properties.service import attach, set_status
from tests.api.conftest import auth_headers
from tests.fakes import NOW, FakeAdapter, payload

CFG = load_config(Settings(_env_file=None).dedupe_config_path)


async def seed(
    db: AsyncSession,
    settings: Settings,
    source: Source,
    ext: str,
    text: str,
    structured: dict[str, Any],
    *,
    posted: Any = NOW,
    photos: list[Any] | None = None,
) -> Property:
    result = await ingest_payload(
        db,
        source,
        payload(ext, text, posted=posted, structured=structured, photos=photos),
        adapter=FakeAdapter([], None),
        cfg=CFG,
        photo_dir=settings.photo_dir,
        now=posted,
    )
    return result.property


async def listing_of(db: AsyncSession, prop: Property) -> Listing:
    return (await db.execute(select(Listing).where(Listing.property_id == prop.id))).scalar_one()


@pytest.fixture
async def sources(db: AsyncSession) -> tuple[Source, Source]:
    tg = Source(kind="telegram", name="@chan", config={"peer": "@chan"})
    olx = Source(kind="olx", name="olx-tashkent", config={"url": "https://www.olx.uz/x/"})
    db.add_all([tg, olx])
    await db.flush()
    return tg, olx


@pytest.fixture
async def seeded(
    db: AsyncSession, settings: Settings, sources: tuple[Source, Source]
) -> dict[str, Property]:
    tg, olx = sources
    a = await seed(
        db,
        settings,
        tg,
        "a",
        "Сдаётся квартира, хозяин, +998901110001",
        {
            "rooms": 2,
            "district": "chilonzor",
            "price_amount_minor": 40000,
            "price_currency": "USD",
        },
    )
    b = await seed(
        db,
        settings,
        olx,
        "b",
        "Сдаётся квартира +998901110002",
        {
            "rooms": 3,
            "district": "yunusobod",
            "price_amount_minor": 70000,
            "price_currency": "USD",
        },
        posted=NOW - timedelta(days=1),
    )
    c = await seed(
        db,
        settings,
        tg,
        "c",
        "Квартира на длительный срок +998901110003",
        {
            "rooms": 1,
            "district": "chilonzor",
            "price_amount_minor": 25000,
            "price_currency": "USD",
        },
        posted=NOW - timedelta(days=2),
    )
    return {"a": a, "b": b, "c": c}


async def test_list_requires_auth(client: httpx.AsyncClient) -> None:
    r = await client.get("/api/v1/properties")
    assert r.status_code == 401 and r.json()["code"] == "auth.missing_token"


async def test_rows_carry_counts_sources_owner_and_paging(
    client: httpx.AsyncClient, settings: Settings, agent: User, seeded: dict[str, Property]
) -> None:
    r = await client.get("/api/v1/properties", headers=auth_headers(settings, agent))
    assert r.status_code == 200, r.text
    page = r.json()
    assert page["total"] == 3 and page["page"] == 1 and page["page_size"] == 20
    assert [row["id"] for row in page["items"]] == [
        str(seeded["a"].id),
        str(seeded["b"].id),
        str(seeded["c"].id),
    ]
    a = page["items"][0]
    assert a["listing_count"] == 1 and a["source_kinds"] == ["telegram"]
    assert a["price_usd_min_minor"] == 40000 and a["rooms"] == 2 and a["status"] == "new"
    assert a["probable_owner"]["identifier"] == "+998901110001"
    assert a["probable_owner"]["kind"] == "phone"
    assert a["photo_url"] is None and a["source_removed"] is False
    # every property is born with a crawler "new" event (properties.service.create_from_listing)
    assert a["last_status_event"]["to_status"] == "new"
    assert a["last_status_event"]["actor_type"] == "crawler"
    assert a["last_status_event"]["from_status"] is None


async def test_filters(
    client: httpx.AsyncClient,
    settings: Settings,
    agent: User,
    seeded: dict[str, Property],
    db: AsyncSession,
) -> None:
    h = auth_headers(settings, agent)

    async def ids(**params: Any) -> list[str]:
        r = await client.get("/api/v1/properties", params=params, headers=h)
        assert r.status_code == 200, r.text
        return [row["id"] for row in r.json()["items"]]

    a, b, c = (str(seeded[k].id) for k in "abc")
    district = seeded["a"].district
    assert district is not None
    assert await ids(district=district) == [a, c]
    assert await ids(rooms=[1, 3]) == [b, c]
    assert await ids(price_min=300, price_max=500) == [a]
    assert await ids(source="olx") == [b]
    assert await ids(q="длительный") == [c]
    assert await ids(sort="first_seen") == [a, b, c]
    assert await ids(sort="price_asc") == [c, a, b]
    assert await ids(sort="price_desc") == [b, a, c]
    assert await ids(page=2, page_size=2) == [c]
    await set_status(db, seeded["b"], "active", actor_type="agent")
    assert await ids(status=["active"]) == [b]
    assert await ids(status=["new"]) == [a, c]
    r = await client.get("/api/v1/properties", params={"status": "sold"}, headers=h)
    assert r.status_code == 422 and r.json()["code"] == "validation_error"


async def test_owner_only_and_removed(
    client: httpx.AsyncClient,
    settings: Settings,
    agent: User,
    seeded: dict[str, Property],
    sources: tuple[Source, Source],
    db: AsyncSession,
) -> None:
    h = auth_headers(settings, agent)
    seeded["c"].source_removed = True
    await db.flush()
    r = await client.get("/api/v1/properties", headers=h)
    assert [row["id"] for row in r.json()["items"]] == [str(seeded["a"].id), str(seeded["b"].id)]
    r = await client.get("/api/v1/properties", params={"removed": "true"}, headers=h)
    assert r.json()["total"] == 3

    # Every seeded contact is alone on its property, so it auto-classifies "owner" —
    # `owner_only` would pass even as a no-op filter unless at least one property is
    # NOT an owner. Demote "b"'s only contact by human override (as an operator would),
    # then recompute the property's probable owner the same way
    # `rescore_property_contacts` does after any listing edit.
    tg, _ = sources
    b_listing = await listing_of(db, seeded["b"])
    b_contact = (await contacts_for_listing(db, b_listing.id))[0]
    b_contact.human_decision = "agent"
    await rescore_contact(db, b_contact, NOW)
    assert b_contact.classification == "agent"
    await update_probable_owner(db, seeded["b"])

    # No phone or telegram username anywhere in the text: zero contacts, so this
    # property has no probable owner at all.
    d = await seed(db, settings, tg, "d", "Сдаётся квартира без мебели", {"district": "chilonzor"})

    r = await client.get(
        "/api/v1/properties", params={"owner_only": "true", "removed": "true"}, headers=h
    )
    body = r.json()
    items = body["items"]
    ids = {row["id"] for row in items}
    # "b" (now an agent) and "d" (no probable owner) are excluded; "a" and "c" remain.
    assert str(seeded["b"].id) not in ids and str(d.id) not in ids
    assert ids == {str(seeded["a"].id), str(seeded["c"].id)}
    assert body["total"] == 2
    assert all(row["probable_owner"]["classification"] == "owner" for row in items)


async def test_last_status_event_is_the_newest(
    client: httpx.AsyncClient,
    settings: Settings,
    agent: User,
    seeded: dict[str, Property],
    db: AsyncSession,
) -> None:
    await set_status(db, seeded["a"], "active", actor_type="agent", actor_id=agent.id)
    await set_status(
        db, seeded["a"], "inactive", actor_type="agent", actor_id=agent.id, note="rented"
    )
    r = await client.get("/api/v1/properties", headers=auth_headers(settings, agent))
    row = next(x for x in r.json()["items"] if x["id"] == str(seeded["a"].id))
    ev = row["last_status_event"]
    assert ev["to_status"] == "inactive" and ev["from_status"] == "active"
    assert (
        ev["actor_type"] == "agent" and ev["actor_id"] == str(agent.id) and ev["note"] == "rented"
    )
    assert row["status"] == "inactive"


async def test_two_listings_collapse_to_one_row_with_the_first_photo(
    client: httpx.AsyncClient,
    settings: Settings,
    agent: User,
    sources: tuple[Source, Source],
    db: AsyncSession,
) -> None:
    """Two listings on one property, both telegram: one row, one source kind, one photo."""
    tg, _ = sources
    structured = {"district": "chilonzor", "price_currency": "USD"}
    prop = await seed(
        db,
        settings,
        tg,
        "p1",
        "Сдаётся квартира +998901110004",
        {**structured, "rooms": 2, "price_amount_minor": 40000},
        photos=["1"],
    )
    with_photo = await listing_of(db, prop)
    orphan = await seed(
        db,
        settings,
        tg,
        "p2",
        "Та же квартира, другой пост +998901110005",
        {**structured, "rooms": 4, "price_amount_minor": 90000},
    )
    await attach(db, prop, await listing_of(db, orphan), NOW)

    r = await client.get("/api/v1/properties", headers=auth_headers(settings, agent))
    assert r.status_code == 200, r.text
    page = r.json()
    # `attach()` is called directly above to reassign a listing that already has a
    # property — the real pipeline never does that (dedupe.service.assign
    # short-circuits to a listing's existing property instead of moving it), so
    # `orphan` ending up with zero listings is a synthetic state, not one ingestion
    # can reach on its own. It must still not be a row.
    assert page["total"] == 1
    row = page["items"][0]
    assert row["id"] == str(prop.id)
    assert row["listing_count"] == 2 and row["source_kinds"] == ["telegram"]
    assert row["photo_url"] == f"/api/v1/photos/{with_photo.id}/0.jpg"


async def test_unknown_uuid_filters_do_not_crash(
    client: httpx.AsyncClient, settings: Settings, agent: User
) -> None:
    params = {"q": str(uuid.uuid4())}
    r = await client.get("/api/v1/properties", params=params, headers=auth_headers(settings, agent))
    assert r.status_code == 200 and r.json()["total"] == 0


async def test_filters_by_building_type_and_area(
    client: httpx.AsyncClient,
    settings: Settings,
    agent: User,
    sources: tuple[Source, Source],
    db: AsyncSession,
) -> None:
    _tg, olx = sources
    await seed(
        db,
        settings,
        olx,
        "bt1",
        "Сдаётся +998900000001",
        {"building_type": "brick", "area_sqm": 80.0},
    )
    await seed(
        db,
        settings,
        olx,
        "bt2",
        "Сдаётся +998900000002",
        {"building_type": "panel", "area_sqm": 40.0},
    )
    h = auth_headers(settings, agent)
    r1 = await client.get("/api/v1/properties", params={"building_type": "brick"}, headers=h)
    assert r1.status_code == 200, r1.text
    assert r1.json()["total"] == 1
    assert r1.json()["items"][0]["building_type"] == "brick"
    r2 = await client.get("/api/v1/properties", params={"area_min": 60}, headers=h)
    assert r2.json()["total"] == 1
    assert r2.json()["items"][0]["area_sqm"] >= 60


async def test_filters_by_bbox(
    client: httpx.AsyncClient,
    settings: Settings,
    agent: User,
    sources: tuple[Source, Source],
    db: AsyncSession,
) -> None:
    _tg, olx = sources
    await seed(
        db, settings, olx, "in1", "Сдаётся +998900000003", {"latitude": 41.31, "longitude": 69.28}
    )
    await seed(
        db, settings, olx, "out1", "Сдаётся +998900000004", {"latitude": 40.00, "longitude": 65.00}
    )
    r = await client.get(
        "/api/v1/properties",
        params={"min_lat": 41.0, "min_lon": 69.0, "max_lat": 42.0, "max_lon": 70.0},
        headers=auth_headers(settings, agent),
    )
    assert r.status_code == 200
    assert r.json()["total"] == 1


async def test_not_first_floor(
    client: httpx.AsyncClient,
    settings: Settings,
    agent: User,
    sources: tuple[Source, Source],
    db: AsyncSession,
) -> None:
    _tg, olx = sources
    await seed(db, settings, olx, "fl1", "Сдаётся +998900000005", {"floor": 1, "total_floors": 5})
    await seed(db, settings, olx, "fl3", "Сдаётся +998900000006", {"floor": 3, "total_floors": 5})
    r = await client.get(
        "/api/v1/properties",
        params={"not_first_floor": "true"},
        headers=auth_headers(settings, agent),
    )
    assert r.json()["total"] == 1
    assert r.json()["items"][0]["floor"] == 3
