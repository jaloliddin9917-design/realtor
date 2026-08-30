import asyncio
import uuid
from datetime import timedelta

import httpx
import pytest
from fastapi import FastAPI
from pydantic import field_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.routers import listings as listings_router
from app.core.settings import Settings
from app.ingestion.adapters.base import (
    AdapterBackoff,
    InvalidListingUrl,
    ListingGone,
    LoginRequired,
    RawPayload,
)
from app.ingestion.manual import ManualAdapter, ManualListingForm
from app.ingestion.registry import AdapterRegistry
from app.modules.contacts.service import contacts_for_listing
from app.modules.identity.models import User
from app.modules.listings.models import Listing, ListingPhoto, Source
from app.modules.properties.models import Property
from tests.api.conftest import auth_headers
from tests.fakes import UrlFake, payload
from tests.helpers import make_jpeg

AD = payload("77", "Сдаётся 2-комн, Чиланзар, 400$ +998901110009", structured={"rooms": 2})
OLX_URL = "https://www.olx.uz/d/obyavlenie/x-ID77.html"


@pytest.fixture
def registry() -> AdapterRegistry:
    # `olx` answers URL fetches; no `telegram` adapter at all — exercises the misconfigured path
    return AdapterRegistry({"manual": ManualAdapter(), "olx": UrlFake("olx", AD)})  # type: ignore[dict-item]


class _SlowFake(UrlFake):
    async def fetch_by_url(self, url: str) -> RawPayload:
        await asyncio.sleep(3)
        return await super().fetch_by_url(url)


class _FailingFake(UrlFake):
    def __init__(self, kind: str, p: RawPayload, error: Exception) -> None:
        super().__init__(kind, p)
        self.error = error

    async def fetch_by_url(self, url: str) -> RawPayload:
        raise self.error


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
    assert r.json()["errors"][0]["loc"] == ["body", "url"]
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


async def test_a_source_that_does_not_answer_in_time_is_503(
    api: tuple[FastAPI, httpx.AsyncClient], settings: Settings, agent: User
) -> None:
    """Spec §2: a pasted link calls the adapter synchronously, with a timeout — and it is
    the *configured* number of seconds that fires, not just some timeout: a small
    positive value with a longer sleep proves the setting is actually threaded through."""
    app, client = api
    app.state.registry = AdapterRegistry({"olx": _SlowFake("olx", AD)})  # type: ignore[dict-item]
    settings.manual_fetch_timeout_seconds = 1
    r = await client.post(
        "/api/v1/listings/manual", json={"url": OLX_URL}, headers=auth_headers(settings, agent)
    )
    assert r.status_code == 503, r.text
    assert r.json()["code"] == "source.unavailable"
    assert r.json()["detail"] == "the source did not answer within 1 s"


@pytest.mark.parametrize(
    ("error", "status", "code"),
    [
        (LoginRequired("session revoked"), 503, "source.login_required"),
        (AdapterBackoff(timedelta(minutes=5), "http 429"), 503, "source.unavailable"),
        (ListingGone("77"), 410, "listing.gone"),
        (InvalidListingUrl("no ad id in https://www.olx.uz/x"), 422, "listing.invalid_url"),
    ],
)
async def test_adapter_failures_map_to_their_own_codes(
    api: tuple[FastAPI, httpx.AsyncClient],
    settings: Settings,
    agent: User,
    error: Exception,
    status: int,
    code: str,
) -> None:
    app, client = api
    app.state.registry = AdapterRegistry({"olx": _FailingFake("olx", AD, error)})  # type: ignore[dict-item]
    r = await client.post(
        "/api/v1/listings/manual", json={"url": OLX_URL}, headers=auth_headers(settings, agent)
    )
    assert r.status_code == status, r.text
    assert r.json()["code"] == code
    if code == "listing.invalid_url":
        assert r.json()["errors"][0]["loc"] == ["body", "url"]


async def test_a_value_error_from_deeper_in_the_pipeline_is_not_a_url_problem(
    api: tuple[FastAPI, httpx.AsyncClient],
    settings: Settings,
    agent: User,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Only `InvalidListingUrl` means "bad link"; any other ValueError is our bug — a 500."""
    app, _ = api

    async def boom(*args: object, **kwargs: object) -> None:
        raise ValueError("boom")

    monkeypatch.setattr(listings_router, "ingest_url", boom)
    # Starlette re-raises after the handler answers, so this client must not raise.
    transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as local:
        r = await local.post(
            "/api/v1/listings/manual", json={"url": OLX_URL}, headers=auth_headers(settings, agent)
        )
    assert r.status_code == 500
    assert r.json()["code"] == "internal_error" and "boom" not in r.text


async def test_a_rejected_form_model_is_a_validation_problem(
    client: httpx.AsyncClient,
    settings: Settings,
    agent: User,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """`ManualListingForm(...)` is built by hand from the multipart fields, so its own
    pydantic errors never reached FastAPI's validation handler."""

    class Picky(ManualListingForm):
        @field_validator("title")
        @classmethod
        def _reject(cls, value: str) -> str:
            if value == "reject-me":
                raise ValueError("title is not allowed")
            return value

    monkeypatch.setattr(listings_router, "ManualListingForm", Picky)
    r = await client.post(
        "/api/v1/listings/manual/form",
        data={"title": "reject-me"},
        headers=auth_headers(settings, agent),
    )
    assert r.status_code == 422, r.text
    body = r.json()
    assert body["code"] == "validation_error"
    assert body["errors"][0]["loc"] == ["body", "title"]
