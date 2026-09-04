"""GET /dashboard — real team-overview aggregates for the Dashboard screen.

`now` is the wall clock at request time; the service takes it as a parameter so tests can
freeze it, matching the availability router.
"""

from datetime import UTC, datetime

from fastapi import APIRouter

from app.api.deps import CurrentUser, SessionDep
from app.modules.dashboard.schemas import DashboardOut
from app.modules.dashboard.service import build_dashboard

router = APIRouter(tags=["dashboard"])


@router.get("/dashboard", response_model=DashboardOut)
async def get_dashboard(session: SessionDep, _: CurrentUser) -> DashboardOut:
    return await build_dashboard(session, datetime.now(UTC))
