"""Bot Monitor endpoints (the "Xabarlar" screen).

`now` is the wall clock at request time; the service takes it as a parameter so tests can
freeze it. The resolve mutation commits in the router, matching `properties` / `queue` /
`duplicates`. Sending is OFF this milestone — this router only reads the monitor and records
an agent's manual classification of an `unclear` reply.
"""

import uuid
from datetime import UTC, datetime

from fastapi import APIRouter

from app.api.deps import CurrentUser, SessionDep
from app.api.problems import PROBLEM_422, problem_response
from app.modules.outreach.schemas import OutreachItemOut, OutreachMonitorOut, ResolveIn
from app.modules.outreach.service import outreach_monitor, resolve_unclear

router = APIRouter(tags=["bot"])

_UNKNOWN_MESSAGE = problem_response("unknown outreach message")
_NOT_RESOLVABLE = problem_response("message is not awaiting manual classification")


@router.get("/bot", response_model=OutreachMonitorOut)
async def get_bot_monitor(session: SessionDep, _: CurrentUser) -> OutreachMonitorOut:
    return await outreach_monitor(session, datetime.now(UTC))


@router.post(
    "/bot/{message_id}/resolve",
    response_model=OutreachItemOut,
    responses={404: _UNKNOWN_MESSAGE, 409: _NOT_RESOLVABLE, **PROBLEM_422},
)
async def resolve_bot_message(
    message_id: uuid.UUID, body: ResolveIn, session: SessionDep, _: CurrentUser
) -> OutreachItemOut:
    item = await resolve_unclear(session, message_id, body.result, datetime.now(UTC))
    await session.commit()
    return item
