import uuid
from typing import Annotated, Literal

from fastapi import APIRouter, Query

from app.api.deps import CurrentUser, SessionDep
from app.api.problems import PROBLEM_422, ApiError, problem_response
from app.modules.properties.models import Property
from app.modules.properties.query import (
    PropertyFilters,
    event_out,
    list_pins,
    list_properties,
    load_property_detail,
)
from app.modules.properties.schemas import (
    PinOut,
    PropertyDetail,
    PropertyPage,
    PropertyStatus,
    SortKey,
    StatusEventOut,
    StatusIn,
)
from app.modules.properties.service import set_status

router = APIRouter(tags=["properties"])


@router.get("/properties", response_model=PropertyPage, responses=PROBLEM_422)
async def list_properties_endpoint(
    session: SessionDep,
    _: CurrentUser,
    district: Annotated[list[str] | None, Query()] = None,
    rooms: Annotated[list[int] | None, Query()] = None,
    price_min: Annotated[int | None, Query(ge=0, description="whole USD")] = None,
    price_max: Annotated[int | None, Query(ge=0, description="whole USD")] = None,
    status: Annotated[list[PropertyStatus] | None, Query()] = None,
    source: Annotated[Literal["olx", "telegram", "manual"] | None, Query()] = None,
    owner_only: bool = False,
    removed: Annotated[bool, Query(description="include properties removed at the source")] = False,
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
    q: Annotated[str | None, Query(max_length=200)] = None,
    sort: SortKey = "last_seen",
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 20,
) -> PropertyPage:
    filters = PropertyFilters(
        district=district or [],
        rooms=rooms or [],
        price_min=price_min,
        price_max=price_max,
        status=status or [],
        source=source,
        owner_only=owner_only,
        removed=removed,
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
            if min_lat is not None
            and min_lon is not None
            and max_lat is not None
            and max_lon is not None
            else None
        ),
        q=q,
        sort=sort,
        page=page,
        page_size=page_size,
    )
    items, total = await list_properties(session, filters)
    return PropertyPage(items=items, total=total, page=page, page_size=page_size)


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
        district=district or [],
        rooms=rooms or [],
        price_min=price_min,
        price_max=price_max,
        status=status or [],
        source=source,
        owner_only=owner_only,
        removed=removed,
        q=q,
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
            if min_lat is not None
            and min_lon is not None
            and max_lat is not None
            and max_lon is not None
            else None
        ),
    )
    return await list_pins(session, filters)


@router.get(
    "/properties/{property_id}",
    response_model=PropertyDetail,
    responses={404: problem_response("unknown property"), **PROBLEM_422},
)
async def property_detail(
    property_id: uuid.UUID, session: SessionDep, _: CurrentUser
) -> PropertyDetail:
    detail = await load_property_detail(session, property_id)
    if detail is None:
        raise ApiError(404, "not_found", "property not found")
    return detail


@router.post(
    "/properties/{property_id}/status",
    response_model=StatusEventOut,
    responses={404: problem_response("unknown property"), **PROBLEM_422},
)
async def set_property_status(
    property_id: uuid.UUID, body: StatusIn, session: SessionDep, user: CurrentUser
) -> StatusEventOut:
    prop = await session.get(Property, property_id)
    if prop is None:
        raise ApiError(404, "not_found", "property not found")
    event = await set_status(
        session, prop, body.status, actor_type=user.role, actor_id=user.id, note=body.note
    )
    await session.commit()
    out = event_out(event)
    if out is None:  # set_status always returns an event; `-O` must not skip the check
        raise RuntimeError("set_status returned no event")
    return out
