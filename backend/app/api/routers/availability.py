"""Agent queue + call-log endpoints (the Queue and Call screens).

`now` is the wall clock at request time; the service layer takes it as a parameter so tests
can freeze it. Mutations commit in the router, matching `properties.set_property_status`.
"""

import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Response

from app.api.deps import CurrentUser, SessionDep
from app.api.problems import PROBLEM_422, problem_response
from app.modules.availability.schemas import CallLogIn, CheckOut, QueueItemOut, QueueScope
from app.modules.availability.service import build_queue, log_check, release, take

router = APIRouter(tags=["queue"])

_LOCKED = problem_response("another agent holds this property")
_UNKNOWN_PROPERTY = problem_response("unknown property")


@router.get("/queue", response_model=list[QueueItemOut], responses=PROBLEM_422)
async def get_queue(
    session: SessionDep, user: CurrentUser, scope: QueueScope = "all"
) -> list[QueueItemOut]:
    return await build_queue(session, user, scope, datetime.now(UTC))


@router.post(
    "/queue/{property_id}/take",
    response_model=QueueItemOut,
    responses={404: _UNKNOWN_PROPERTY, 409: _LOCKED, **PROBLEM_422},
)
async def take_queue_item(
    property_id: uuid.UUID, session: SessionDep, user: CurrentUser
) -> QueueItemOut:
    item = await take(session, property_id, user, datetime.now(UTC))
    await session.commit()
    return item


@router.post(
    "/queue/{property_id}/release",
    status_code=204,
    responses={404: _UNKNOWN_PROPERTY, **PROBLEM_422},
)
async def release_queue_item(
    property_id: uuid.UUID, session: SessionDep, user: CurrentUser
) -> Response:
    await release(session, property_id, user)
    await session.commit()
    return Response(status_code=204)


@router.post(
    "/properties/{property_id}/call-log",
    response_model=CheckOut,
    responses={404: _UNKNOWN_PROPERTY, **PROBLEM_422},
)
async def create_call_log(
    property_id: uuid.UUID, body: CallLogIn, session: SessionDep, user: CurrentUser
) -> CheckOut:
    out = await log_check(session, property_id, user, body, datetime.now(UTC))
    await session.commit()
    return out
