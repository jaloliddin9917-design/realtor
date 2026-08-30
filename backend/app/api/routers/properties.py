import uuid
from typing import Annotated, Literal

from fastapi import APIRouter, Query

from app.api.deps import CurrentUser, SessionDep
from app.api.problems import ApiError
from app.modules.properties.models import Property
from app.modules.properties.query import (
    PropertyFilters,
    event_out,
    list_properties,
    load_property_detail,
)
from app.modules.properties.schemas import (
    PropertyDetail,
    PropertyPage,
    SortKey,
    StatusEventOut,
    StatusIn,
)
from app.modules.properties.service import STATUSES, set_status

router = APIRouter(tags=["properties"])


@router.get("/properties", response_model=PropertyPage)
async def list_properties_endpoint(
    session: SessionDep,
    _: CurrentUser,
    district: Annotated[list[str] | None, Query()] = None,
    rooms: Annotated[list[int] | None, Query()] = None,
    price_min: Annotated[int | None, Query(ge=0, description="whole USD")] = None,
    price_max: Annotated[int | None, Query(ge=0, description="whole USD")] = None,
    status: Annotated[list[str] | None, Query()] = None,
    source: Annotated[Literal["olx", "telegram", "manual"] | None, Query()] = None,
    owner_only: bool = False,
    removed: Annotated[bool, Query(description="include properties removed at the source")] = False,
    q: Annotated[str | None, Query(max_length=200)] = None,
    sort: SortKey = "last_seen",
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 20,
) -> PropertyPage:
    unknown = [s for s in (status or []) if s not in STATUSES]
    if unknown:
        message = f"unknown status {unknown[0]!r}"
        raise ApiError(
            422,
            "validation_error",
            message,
            extra={"errors": [{"loc": ["query", "status"], "msg": message, "type": "enum"}]},
        )
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
        sort=sort,
        page=page,
        page_size=page_size,
    )
    items, total = await list_properties(session, filters)
    return PropertyPage(items=items, total=total, page=page, page_size=page_size)


@router.get(
    "/properties/{property_id}",
    response_model=PropertyDetail,
    responses={404: {"description": "unknown property"}},
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
    responses={404: {"description": "unknown property"}},
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
    assert out is not None  # set_status always returns an event
    return out
