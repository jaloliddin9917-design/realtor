"""Duplicates review queue endpoints (the Duplicates screen).

`now` is the wall clock at request time; the review layer takes it as a parameter so tests
can freeze it. The decide mutation commits in the router, matching `properties` / `queue`.
"""

import uuid
from datetime import UTC, datetime

from fastapi import APIRouter

from app.api.deps import CurrentUser, DedupeConfigDep, SessionDep
from app.api.problems import PROBLEM_422, problem_response
from app.modules.dedupe.review import decide_review, list_pending_pairs
from app.modules.dedupe.schemas import DecideIn, DuplicatePairOut, DuplicateQueueOut

router = APIRouter(tags=["duplicates"])

_UNKNOWN_REVIEW = problem_response("unknown review")
_ALREADY_DECIDED = problem_response("this review has already been decided")


@router.get("/duplicates", response_model=DuplicateQueueOut)
async def list_duplicates(
    session: SessionDep, _: CurrentUser, cfg: DedupeConfigDep
) -> DuplicateQueueOut:
    return await list_pending_pairs(session, cfg, datetime.now(UTC))


@router.post(
    "/duplicates/{review_id}/decide",
    response_model=DuplicatePairOut,
    responses={404: _UNKNOWN_REVIEW, 409: _ALREADY_DECIDED, **PROBLEM_422},
)
async def decide_duplicate(
    review_id: uuid.UUID, body: DecideIn, session: SessionDep, user: CurrentUser
) -> DuplicatePairOut:
    pair = await decide_review(session, review_id, user, body.decision, datetime.now(UTC))
    await session.commit()
    return pair
