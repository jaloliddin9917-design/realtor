import uuid

import httpx
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.settings import Settings
from app.ingestion.manual import ManualAdapter
from app.ingestion.registry import AdapterRegistry
from app.modules.contacts.service import contacts_for_listing
from app.modules.identity.models import User
from app.modules.listings.models import Listing, ListingPhoto, Source
from app.modules.properties.models import Property
from tests.api.conftest import auth_headers
from tests.fakes import UrlFake, payload
from tests.helpers import make_jpeg

# The short literal secret in the `settings` fixture is an intentional test fixture, not
# a production value; PyJWT's InsecureKeyLengthWarning (HMAC key < 32 bytes) is expected noise.
pytestmark = pytest.mark.filterwarnings("ignore::jwt.InsecureKeyLengthWarning")

AD = payload("77", "Сдаётся 2-комн, Чиланзар, 400$ +998901110009", structured={"rooms": 2})


@pytest.fixture
def registry() -> AdapterRegistry:
    # `olx` answers URL fetches; no `telegram` adapter at all — exercises the misconfigured path
    return AdapterRegistry({"manual": ManualAdapter(), "olx": UrlFake("olx", AD)})  # type: ignore[dict-item]


async def test_add_by_url_creates_a_property(
    client: httpx.AsyncClient, settings: Settings, agent: User, db: AsyncSession
) -> None:
    db.add(Source(kind="olx", name="olx-tashkent", config={"url": "https://www.olx.uz/x/"}))
    await db.flush()
    h = auth_headers(settings, agent)
    r = await client.post(
        "/api/v1/listings/manual",
        json={"url": "https://www.olx.uz/d/obyavlenie/x-ID77.html"},
        headers=h,
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["created"] is True and body["decision"] in {"new", "review", "attached"}
    listing = await db.get(Listing, body["listing_id"])
    assert listing is not None and str(listing.property_id) == body["property_id"]
    # GET /properties is being built in a sibling worktree and isn't on this branch yet —
    # check the created property and its source kind directly against the DB instead.
    prop = await db.get(Property, uuid.UUID(body["property_id"]))
    assert prop is not None
    await db.refresh(listing, ["raw"])
    await db.refresh(listing.raw, ["source"])
    assert listing.raw.source.kind == "olx"
    again = await client.post(
        "/api/v1/listings/manual",
        json={"url": "https://www.olx.uz/d/obyavlenie/x-ID77.html"},
        headers=h,
    )
    assert again.status_code == 201 and again.json()["created"] is False


async def test_add_by_url_errors(
    client: httpx.AsyncClient, settings: Settings, agent: User
) -> None:
    h = auth_headers(settings, agent)
    r = await client.post(
        "/api/v1/listings/manual", json={"url": "https://example.com/flat/1"}, headers=h
    )
    assert r.status_code == 422 and r.json()["code"] == "listing.unsupported_url"
    r = await client.post(
        "/api/v1/listings/manual", json={"url": "https://t.me/somechannel/5"}, headers=h
    )
    assert r.status_code == 503 and r.json()["code"] == "source.misconfigured"
    r = await client.post(
        "/api/v1/listings/manual", json={"url": "https://www.olx.uz/d/obyavlenie/x-ID77.html"}
    )
    assert r.status_code == 401


async def test_add_by_form_with_photos(
    client: httpx.AsyncClient, settings: Settings, agent: User, db: AsyncSession
) -> None:
    h = auth_headers(settings, agent)
    r = await client.post(
        "/api/v1/listings/manual/form",
        data={
            "title": "2-комн Чиланзар",
            "description": "хозяин",
            "price_amount_minor": "40000",
            "price_currency": "USD",
            "rooms": "2",
            "district": "chilanzar",
            "phone": "+998 90 111 00 10",
        },
        files=[
            ("photos", ("a.jpg", make_jpeg(300, 200, 1), "image/jpeg")),
            ("photos", ("b.jpg", make_jpeg(300, 200, 2), "image/jpeg")),
        ],
        headers=h,
    )
    assert r.status_code == 201, r.text
    body = r.json()
    listing = await db.get(Listing, body["listing_id"])
    assert listing is not None and listing.rooms == 2 and listing.price_amount_minor == 40000
    photos = (
        (await db.execute(select(ListingPhoto).where(ListingPhoto.listing_id == listing.id)))
        .scalars()
        .all()
    )
    assert sorted(p.position for p in photos) == [0, 1] and all(p.storage_key for p in photos)
    # GET /properties/{id} is being built in a sibling worktree and isn't on this branch
    # yet — check contacts and source kind directly instead of via the detail endpoint.
    contacts = await contacts_for_listing(db, listing.id)
    assert [c.identifier for c in contacts] == ["+998901110010"]
    await db.refresh(listing, ["raw"])
    await db.refresh(listing.raw, ["source"])
    assert listing.raw.source.kind == "manual"


async def test_form_validation_and_photo_limit(
    client: httpx.AsyncClient, settings: Settings, agent: User
) -> None:
    h = auth_headers(settings, agent)
    r = await client.post(
        "/api/v1/listings/manual/form", data={"description": "no title"}, headers=h
    )
    assert r.status_code == 422 and r.json()["code"] == "validation_error"
    assert ["body", "title"] in [e["loc"] for e in r.json()["errors"]]
    files = [("photos", (f"{i}.jpg", make_jpeg(60, 40, i), "image/jpeg")) for i in range(11)]
    r = await client.post(
        "/api/v1/listings/manual/form", data={"title": "x"}, files=files, headers=h
    )
    assert r.status_code == 422 and r.json()["code"] == "validation_error"
