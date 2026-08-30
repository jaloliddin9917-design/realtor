"""Manual ingestion: paste a link, or fill a form with photos (spec §3.4)."""

import uuid
from datetime import UTC, datetime
from typing import Annotated, Literal
from urllib.parse import urlsplit

from fastapi import APIRouter, File, Form, UploadFile
from pydantic import BaseModel

from app.api.deps import CurrentUser, DedupeConfigDep, RegistryDep, SessionDep, SettingsDep
from app.api.problems import ApiError
from app.ingestion.adapters.base import AdapterBackoff, ListingGone, LoginRequired
from app.ingestion.manual import HOST_KINDS, ManualListingForm, ingest_form, ingest_url
from app.ingestion.pipeline import IngestResult

router = APIRouter(tags=["listings"])
MAX_PHOTOS = 10


class ManualUrlIn(BaseModel):
    url: str


class ManualResult(BaseModel):
    property_id: uuid.UUID
    listing_id: uuid.UUID
    created: bool
    decision: str


def _result(r: IngestResult) -> ManualResult:
    return ManualResult(
        property_id=r.property.id, listing_id=r.listing.id, created=r.created, decision=r.decision
    )


@router.post(
    "/listings/manual",
    response_model=ManualResult,
    status_code=201,
    responses={
        422: {"description": "unsupported or invalid url"},
        503: {"description": "source unavailable"},
    },
)
async def add_listing_by_url(
    body: ManualUrlIn,
    session: SessionDep,
    _: CurrentUser,
    registry: RegistryDep,
    cfg: DedupeConfigDep,
    settings: SettingsDep,
) -> ManualResult:
    kind = HOST_KINDS.get(urlsplit(body.url).netloc.lower())
    if kind is None:
        raise ApiError(422, "listing.unsupported_url", f"unsupported url: {body.url}")
    try:
        registry.get(kind)
    except (KeyError, ValueError) as exc:
        raise ApiError(503, "source.misconfigured", f"{kind} adapter unavailable: {exc}") from exc
    try:
        result = await ingest_url(
            session,
            body.url,
            registry,
            cfg=cfg,
            photo_dir=settings.photo_dir,
            now=datetime.now(UTC),
        )
    except ListingGone as exc:
        raise ApiError(410, "listing.gone", f"listing no longer exists: {exc}") from exc
    except ValueError as exc:
        raise ApiError(422, "listing.invalid_url", str(exc)) from exc
    except (AdapterBackoff, LoginRequired) as exc:
        raise ApiError(503, "source.unavailable", str(exc)) from exc
    await session.commit()
    return _result(result)


@router.post("/listings/manual/form", response_model=ManualResult, status_code=201)
async def add_listing_by_form(
    session: SessionDep,
    _: CurrentUser,
    cfg: DedupeConfigDep,
    settings: SettingsDep,
    title: Annotated[str, Form(min_length=1, max_length=200)],
    description: Annotated[str, Form(max_length=5000)] = "",
    price_amount_minor: Annotated[int | None, Form(ge=0)] = None,
    price_currency: Annotated[Literal["USD", "UZS"] | None, Form()] = None,
    rooms: Annotated[int | None, Form(ge=0, le=20)] = None,
    floor: Annotated[int | None, Form(ge=0)] = None,
    total_floors: Annotated[int | None, Form(ge=1)] = None,
    area_sqm: Annotated[float | None, Form(gt=0)] = None,
    district: Annotated[str | None, Form(max_length=64)] = None,
    phone: Annotated[str | None, Form(max_length=32)] = None,
    photos: Annotated[list[UploadFile] | None, File()] = None,
) -> ManualResult:
    files = photos or []
    if len(files) > MAX_PHOTOS:
        raise ApiError(
            422,
            "validation_error",
            f"at most {MAX_PHOTOS} photos",
            extra={
                "errors": [
                    {
                        "loc": ["body", "photos"],
                        "msg": f"at most {MAX_PHOTOS} photos",
                        "type": "too_long",
                    }
                ]
            },
        )
    form = ManualListingForm(
        title=title,
        description=description,
        price_amount_minor=price_amount_minor,
        price_currency=price_currency,
        rooms=rooms,
        floor=floor,
        total_floors=total_floors,
        area_sqm=area_sqm,
        district=district,
        phone=phone,
    )
    data = [await f.read() for f in files]
    result = await ingest_form(
        session, form, data, cfg=cfg, photo_dir=settings.photo_dir, now=datetime.now(UTC)
    )
    await session.commit()
    return _result(result)
