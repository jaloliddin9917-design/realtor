"""Manual ingestion: paste a link, or fill a form with photos (spec §3.4)."""

import asyncio
import uuid
from datetime import UTC, datetime
from typing import Annotated, Any, Literal
from urllib.parse import urlsplit

from fastapi import APIRouter, File, Form, UploadFile
from pydantic import BaseModel, ValidationError

from app.api.deps import CurrentUser, DedupeConfigDep, RegistryDep, SessionDep, SettingsDep
from app.api.problems import PROBLEM_422, ApiError, problem_response
from app.ingestion.adapters.base import (
    AdapterBackoff,
    InvalidListingUrl,
    ListingGone,
    LoginRequired,
)
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


def _issues(exc: ValidationError) -> list[dict[str, Any]]:
    """Pydantic errors in the same `{loc, msg, type}` shape `problems.py` emits, with
    `loc` rooted at "body" — the fields came from the multipart body."""
    return [
        {
            "loc": ["body", *(str(p) for p in e["loc"])],
            "msg": e["msg"],
            "type": e["type"],
        }
        for e in exc.errors()
    ]


def _result(r: IngestResult) -> ManualResult:
    return ManualResult(
        property_id=r.property.id, listing_id=r.listing.id, created=r.created, decision=r.decision
    )


@router.post(
    "/listings/manual",
    response_model=ManualResult,
    status_code=201,
    responses={
        410: problem_response("the listing no longer exists at the source"),
        **PROBLEM_422,
        503: problem_response("the source is unavailable, blocked or misconfigured"),
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
        detail = f"unsupported url: {body.url}"
        raise ApiError(
            422,
            "listing.unsupported_url",
            detail,
            extra={"errors": [{"loc": ["body", "url"], "msg": detail, "type": "value_error"}]},
        )
    try:
        registry.get(kind)
    except (KeyError, ValueError) as exc:
        raise ApiError(503, "source.misconfigured", f"{kind} adapter unavailable: {exc}") from exc
    seconds = settings.manual_fetch_timeout_seconds
    try:
        # The only request in the API that goes out to the network (spec §2), so it is
        # the only one that can hang on someone else's server: give it a hard ceiling.
        async with asyncio.timeout(seconds):
            result = await ingest_url(
                session,
                body.url,
                registry,
                cfg=cfg,
                photo_dir=settings.photo_dir,
                now=datetime.now(UTC),
            )
    except TimeoutError as exc:
        raise ApiError(
            503, "source.unavailable", f"the source did not answer within {seconds} s"
        ) from exc
    except ListingGone as exc:
        raise ApiError(410, "listing.gone", f"listing no longer exists: {exc}") from exc
    except InvalidListingUrl as exc:
        # Narrow on purpose: any other ValueError is a bug in our own parsing, and must
        # reach the catch-all 500 rather than be reported to the user as a bad link.
        detail = str(exc)
        raise ApiError(
            422,
            "listing.invalid_url",
            detail,
            extra={"errors": [{"loc": ["body", "url"], "msg": detail, "type": "value_error"}]},
        ) from exc
    except LoginRequired as exc:
        raise ApiError(503, "source.login_required", str(exc)) from exc
    except AdapterBackoff as exc:
        raise ApiError(503, "source.unavailable", str(exc)) from exc
    await session.commit()
    return _result(result)


@router.post(
    "/listings/manual/form", response_model=ManualResult, status_code=201, responses=PROBLEM_422
)
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
    try:
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
    except ValidationError as exc:
        # The model is built by hand from the multipart fields, so FastAPI's own
        # validation handler never sees these errors; shape them like it would.
        raise ApiError(
            422, "validation_error", "request validation failed", extra={"errors": _issues(exc)}
        ) from exc
    data = [await f.read() for f in files]
    result = await ingest_form(
        session, form, data, cfg=cfg, photo_dir=settings.photo_dir, now=datetime.now(UTC)
    )
    await session.commit()
    return _result(result)
