"""GET /meta — the session-global reference data the web loads once at start-up.

The closed value sets it builds its filter controls from (districts especially, which the
parser owns and will grow), plus the current FX rate and the config constants the system
actually enforces, so the Settings screen can show them without hard-coding a copy.
"""

from datetime import UTC, datetime
from typing import get_args

from fastapi import APIRouter
from pydantic import BaseModel

from app.api.deps import CurrentUser, DedupeConfigDep, SessionDep
from app.ingestion.parse.districts import DISTRICTS
from app.modules.availability.query import LOCK_HOURS, NEW_LISTING_CHECK_DAYS, RECHECK_DAYS
from app.modules.listings.fx import FX_STALE_DAYS, latest_rate
from app.modules.listings.schemas import FxOut, SourceKind
from app.modules.outreach.service import CHANNEL_LIMITS
from app.modules.properties.schemas import ContactClassification, PropertyStatus

router = APIRouter(tags=["meta"])


class RulesOut(BaseModel):
    """Only the config constants the system actually enforces, each read from its real source
    (not a literal here). Quiet-hours and per-contact send caps are deliberately absent: they
    are NOT implemented, so advertising them would imply a guarantee the backend does not make.
    """

    lock_hours: int  # availability.query.LOCK_HOURS
    recheck_days: int  # availability.query.RECHECK_DAYS
    new_listing_check_days: int  # availability.query.NEW_LISTING_CHECK_DAYS
    duplicate_merge_threshold: float  # loaded dedupe config's merge_threshold
    # outreach.service.CHANNEL_LIMITS — None means "no such cap" (SMS has no hourly limit).
    telegram_per_hour: int | None
    telegram_per_day: int | None
    sms_per_day: int | None


class MetaOut(BaseModel):
    districts: list[str]
    statuses: list[PropertyStatus]
    source_kinds: list[SourceKind]
    contact_classifications: list[ContactClassification]
    fx: FxOut | None
    rules: RulesOut


@router.get("/meta", response_model=MetaOut)
async def meta(session: SessionDep, cfg: DedupeConfigDep, _: CurrentUser) -> MetaOut:
    telegram_per_hour, telegram_per_day = CHANNEL_LIMITS["telegram"]
    sms_per_day = CHANNEL_LIMITS["sms"][1]
    rate = await latest_rate(session)
    return MetaOut(
        districts=sorted(DISTRICTS),
        statuses=list(get_args(PropertyStatus)),
        source_kinds=list(get_args(SourceKind)),
        contact_classifications=list(get_args(ContactClassification)),
        fx=FxOut.from_rate(rate, datetime.now(UTC).date(), FX_STALE_DAYS) if rate else None,
        rules=RulesOut(
            lock_hours=LOCK_HOURS,
            recheck_days=RECHECK_DAYS,
            new_listing_check_days=NEW_LISTING_CHECK_DAYS,
            duplicate_merge_threshold=cfg.merge_threshold,
            telegram_per_hour=telegram_per_hour,
            telegram_per_day=telegram_per_day,
            sms_per_day=sms_per_day,
        ),
    )
