from datetime import UTC, datetime, timedelta

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from sqlalchemy import select, text
from sqlalchemy.exc import SQLAlchemyError

from app.api.deps import SessionDep
from app.worker.models import WorkerHeartbeat

router = APIRouter(tags=["health"])
HEARTBEAT_MAX_AGE = timedelta(minutes=5)


@router.get("/healthz", responses={503: {"description": "database unreachable or worker stale"}})
async def healthz(session: SessionDep) -> JSONResponse:
    db_ok = worker_ok = False
    age: float | None = None
    try:
        await session.execute(text("SELECT 1"))
        db_ok = True
        stmt = select(WorkerHeartbeat).where(WorkerHeartbeat.name == "worker")
        row = (await session.execute(stmt)).scalar_one_or_none()
        if row is not None:
            age = (datetime.now(UTC) - row.last_tick_at).total_seconds()
            worker_ok = age < HEARTBEAT_MAX_AGE.total_seconds()
    except SQLAlchemyError:
        db_ok = False
    ok = db_ok and worker_ok
    body = {
        "status": "ok" if ok else "degraded",
        "db": db_ok,
        "worker": worker_ok,
        "worker_heartbeat_age_seconds": age,
    }
    return JSONResponse(body, status_code=200 if ok else 503)
