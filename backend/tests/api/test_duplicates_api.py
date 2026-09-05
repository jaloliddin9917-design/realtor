"""API tests for the duplicates review queue via the httpx ASGITransport harness.

Two dissimilar listings are ingested through the real pipeline (different district, rooms
and phone, so the scorer never blocks them together and auto-creates no review), then a
`DedupeReview` is seeded by hand to pin the pending pair under test.
"""

import uuid
from datetime import UTC, datetime

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.settings import Settings
from app.ingestion.pipeline import ingest_payload
from app.modules.dedupe.config import load_config
from app.modules.dedupe.models import DedupeReview
from app.modules.identity.models import User
from app.modules.listings.models import Listing, Source
from app.modules.properties.models import Property
from tests.api.conftest import auth_headers
from tests.fakes import NOW, FakeAdapter, payload

CFG = load_config(Settings(_env_file=None).dedupe_config_path)

# The stored breakdown is exactly `dedupe.scoring.ScoreBreakdown.parts`: a shared phone
# (0.50) plus a similar description (0.15) — 0.65, in the manual-review band.
BREAKDOWN = {
    "contact": 0.5,
    "photo": 0.0,
    "description": 0.15,
    "rooms_floors": 0.0,
    "area": 0.0,
    "price": 0.0,
}


async def _ingest(db: AsyncSession, settings: Settings, source: Source, p: object) -> Property:
    result = await ingest_payload(
        db,
        source,
        p,
        adapter=FakeAdapter([p], None),
        cfg=CFG,
        photo_dir=settings.photo_dir,
        now=NOW,
    )
    return result.property


async def seed_pending_review(
    db: AsyncSession, settings: Settings
) -> tuple[DedupeReview, Property, Property]:
    """Two separate properties and one undecided review of A (side A) against B (side B)."""
    source = Source(kind="telegram", name="@chan", config={"peer": "@chan"})
    db.add(source)
    await db.flush()

    prop_a = await _ingest(
        db,
        settings,
        source,
        payload(
            "a",
            "Chilonzor Qatortol 2-xonali 3/9 qavat 54 m2 egasidan 450$ tel 90 811 24 37",
            photos=[7],
            structured={
                "rooms": 2,
                "floor": 3,
                "total_floors": 9,
                "district": "chilonzor",
                "price_amount_minor": 45000,
                "price_currency": "USD",
            },
        ),
    )
    prop_b = await _ingest(
        db,
        settings,
        source,
        payload(
            "b",
            "Yunusobod 11-kvartal 3-xonali 5/9 qavat 78 m2 650$ tel 94 128 44 60",
            structured={
                "rooms": 3,
                "floor": 5,
                "total_floors": 9,
                "district": "yunusobod",
                "price_amount_minor": 65000,
                "price_currency": "USD",
            },
        ),
    )
    assert prop_a.id != prop_b.id  # dissimilar -> not merged

    listing_a = (
        await db.execute(select(Listing).where(Listing.property_id == prop_a.id))
    ).scalar_one()
    review = DedupeReview(
        listing_id=listing_a.id,
        candidate_property_id=prop_b.id,
        score=0.65,
        breakdown=BREAKDOWN,
    )
    db.add(review)
    await db.flush()
    return review, prop_a, prop_b


# --- auth --------------------------------------------------------------------------------


async def test_endpoints_require_auth(client: httpx.AsyncClient) -> None:
    r = await client.get("/api/v1/duplicates")
    assert r.status_code == 401 and r.json()["code"] == "auth.missing_token"
    r = await client.post(f"/api/v1/duplicates/{uuid.uuid4()}/decide", json={"decision": "merge"})
    assert r.status_code == 401 and r.json()["code"] == "auth.missing_token"


# --- GET /duplicates ---------------------------------------------------------------------


async def test_list_returns_pending_pair_with_sides_breakdown_and_thresholds(
    client: httpx.AsyncClient, settings: Settings, agent: User, db: AsyncSession
) -> None:
    review, prop_a, prop_b = await seed_pending_review(db, settings)

    r = await client.get("/api/v1/duplicates", headers=auth_headers(settings, agent))
    assert r.status_code == 200, r.text
    body = r.json()
    assert set(body) == {"items", "thresholds", "decided_recent"}
    assert body["thresholds"] == {"review_threshold": 0.5, "merge_threshold": 0.75}

    (pair,) = body["items"]
    assert pair["id"] == str(review.id)
    assert pair["score"] == 0.65
    assert pair["decision"] is None

    assert pair["a"]["property_id"] == str(prop_a.id)
    assert pair["a"]["external_id"] == "a"
    assert pair["a"]["source"]["kind"] == "telegram"
    assert pair["a"]["photos"] and pair["a"]["photos"][0].startswith("/api/v1/photos/")
    assert pair["b"]["property_id"] == str(prop_b.id)
    assert pair["b"]["external_id"] == "b"

    # breakdown is the six scoring signals, in order, with their stored points
    assert [(x["signal"], x["points"]) for x in pair["breakdown"]] == [
        ("contact", 0.5),
        ("photo", 0.0),
        ("description", 0.15),
        ("rooms_floors", 0.0),
        ("area", 0.0),
        ("price", 0.0),
    ]


async def test_list_excludes_decided_rows(
    client: httpx.AsyncClient, settings: Settings, agent: User, db: AsyncSession
) -> None:
    review, _, prop_b = await seed_pending_review(db, settings)
    listing_a = (
        await db.execute(select(Listing).where(Listing.id == review.listing_id))
    ).scalar_one()
    db.add(
        DedupeReview(
            listing_id=listing_a.id,
            candidate_property_id=prop_b.id,
            score=0.80,
            breakdown=BREAKDOWN,
            decision="separate",
            decided_by=agent.id,
            decided_at=datetime.now(UTC),
        )
    )
    await db.flush()

    body = (await client.get("/api/v1/duplicates", headers=auth_headers(settings, agent))).json()
    assert [p["id"] for p in body["items"]] == [str(review.id)]  # only the pending one
    assert body["decided_recent"] == {"days": 30, "count": 1, "merged_pct": 0}


# --- POST /duplicates/{id}/decide --------------------------------------------------------


async def test_decide_records_decision_and_conflicts_on_second_call(
    client: httpx.AsyncClient, settings: Settings, agent: User, db: AsyncSession
) -> None:
    review, _, _ = await seed_pending_review(db, settings)
    h = auth_headers(settings, agent)

    r = await client.post(
        f"/api/v1/duplicates/{review.id}/decide", json={"decision": "merge"}, headers=h
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["id"] == str(review.id)
    assert body["decision"] == "merge"
    assert body["decided_by"] == str(agent.id)
    assert body["decided_at"] is not None
    assert body["a"]["external_id"] == "a" and body["b"]["external_id"] == "b"

    await db.refresh(review)
    assert review.decision == "merge"
    assert review.decided_by == agent.id and review.decided_at is not None

    # a second decision conflicts
    r = await client.post(
        f"/api/v1/duplicates/{review.id}/decide", json={"decision": "separate"}, headers=h
    )
    assert r.status_code == 409 and r.json()["code"] == "dedupe.already_decided"

    # and the pair has left the pending queue
    body = (await client.get("/api/v1/duplicates", headers=h)).json()
    assert all(p["id"] != str(review.id) for p in body["items"])


async def test_decide_merge_reattaches_listings_and_retires_source(
    client: httpx.AsyncClient, settings: Settings, agent: User, db: AsyncSession
) -> None:
    review, prop_a, prop_b = await seed_pending_review(db, settings)
    h = auth_headers(settings, agent)
    moved_listing_id = review.listing_id  # side A's triggering listing

    r = await client.post(
        f"/api/v1/duplicates/{review.id}/decide", json={"decision": "merge"}, headers=h
    )
    assert r.status_code == 200, r.text
    assert r.json()["decision"] == "merge"

    # Every listing of A now sits on B (the survivor); A holds none and is retired.
    on_b = set(
        (await db.execute(select(Listing.id).where(Listing.property_id == prop_b.id)))
        .scalars()
        .all()
    )
    on_a = (
        (await db.execute(select(Listing.id).where(Listing.property_id == prop_a.id)))
        .scalars()
        .all()
    )
    assert moved_listing_id in on_b and len(on_b) == 2  # B's own listing plus A's, moved over
    assert list(on_a) == []
    await db.refresh(prop_a)
    await db.refresh(prop_b)
    assert prop_a.source_removed is True
    assert prop_b.price_usd_min_minor == 45000  # rollups recomputed: cheapest of 450$ / 650$

    # The decided pair (and any self-pair the merge created) is gone from the queue.
    body = (await client.get("/api/v1/duplicates", headers=h)).json()
    assert body["items"] == []

    # A subsequent list / pins view does not return the retired property A.
    listed = (await client.get("/api/v1/properties", headers=h)).json()
    ids = {row["id"] for row in listed["items"]}
    assert str(prop_a.id) not in ids and str(prop_b.id) in ids
    pins = (await client.get("/api/v1/properties/pins", headers=h)).json()
    assert all(pin["id"] != str(prop_a.id) for pin in pins)


async def test_decide_separate_leaves_both_properties_intact(
    client: httpx.AsyncClient, settings: Settings, agent: User, db: AsyncSession
) -> None:
    review, prop_a, prop_b = await seed_pending_review(db, settings)
    h = auth_headers(settings, agent)

    r = await client.post(
        f"/api/v1/duplicates/{review.id}/decide", json={"decision": "separate"}, headers=h
    )
    assert r.status_code == 200 and r.json()["decision"] == "separate"

    # No reattachment: each property keeps its own single listing.
    for prop in (prop_a, prop_b):
        count = (
            (await db.execute(select(Listing.id).where(Listing.property_id == prop.id)))
            .scalars()
            .all()
        )
        assert len(count) == 1
    await db.refresh(prop_a)
    assert prop_a.source_removed is False


async def _ingest_contact_pair(db: AsyncSession, settings: Settings) -> None:
    """Two ads sharing one phone plus matching rooms/floors (a corroborating signal) but
    different districts and dissimilar text — lands in the review band, so the pipeline
    auto-creates one DedupeReview whose contact signal carries the matched phone."""
    source = Source(kind="telegram", name="@dupchan", config={"peer": "@dupchan"})
    db.add(source)
    await db.flush()
    await _ingest(
        db,
        settings,
        source,
        payload(
            "x",
            "Yunusobod dahasi tinch hovli, uzoq muddat oilaga beriladi. Aloqa 90 811 24 37",
            structured={"rooms": 2, "floor": 3, "total_floors": 9, "district": "yunusobod"},
        ),
    )
    await _ingest(
        db,
        settings,
        source,
        payload(
            "y",
            "Sergeli metro yonida yangi bino, shoshilinch. Qongiroq qiling 90 811 24 37",
            structured={"rooms": 2, "floor": 3, "total_floors": 9, "district": "sergeli"},
        ),
    )


async def test_breakdown_contact_detail_shows_matched_phone(
    client: httpx.AsyncClient, settings: Settings, agent: User, db: AsyncSession
) -> None:
    await _ingest_contact_pair(db, settings)

    body = (await client.get("/api/v1/duplicates", headers=auth_headers(settings, agent))).json()
    (pair,) = body["items"]
    contact = next(item for item in pair["breakdown"] if item["signal"] == "contact")
    assert contact["points"] == 0.5
    assert contact["detail"]  # Fix 3: the phone the contact actually matched on, not null
    assert contact["detail"] == pair["a"]["owner"]["phone"]  # same shared contact identifier
    # A signal that did not contribute keeps a null detail.
    photo = next(item for item in pair["breakdown"] if item["signal"] == "photo")
    assert photo["points"] == 0.0 and photo["detail"] is None


async def test_decide_unknown_review_404(
    client: httpx.AsyncClient, settings: Settings, agent: User
) -> None:
    r = await client.post(
        f"/api/v1/duplicates/{uuid.uuid4()}/decide",
        json={"decision": "merge"},
        headers=auth_headers(settings, agent),
    )
    assert r.status_code == 404 and r.json()["code"] == "not_found"


async def test_decide_bad_decision_422(
    client: httpx.AsyncClient, settings: Settings, agent: User, db: AsyncSession
) -> None:
    review, _, _ = await seed_pending_review(db, settings)
    r = await client.post(
        f"/api/v1/duplicates/{review.id}/decide",
        json={"decision": "banana"},
        headers=auth_headers(settings, agent),
    )
    assert r.status_code == 422 and r.json()["code"] == "validation_error"
