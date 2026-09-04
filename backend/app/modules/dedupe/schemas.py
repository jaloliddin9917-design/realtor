"""Request/response models for the duplicates review queue (the Duplicates screen).

Snake_case throughout (like `properties.schemas`); the web maps these to the camelCase its
`DuplicatePair` renders. The six signals are named exactly as `dedupe.scoring.ScoreBreakdown`
writes them into `DedupeReview.breakdown` (spec §5.2 weights: contact, photo, description,
rooms_floors, area, price), so `breakdown[*].signal` is the same key the scorer stored.
Closed value sets are `Literal`s so they land in the OpenAPI contract as enums.
"""

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel

from app.modules.properties.schemas import ContactClassification, PriceOut, SourceRef

# The per-signal contributions dedupe.scoring writes into DedupeReview.breakdown, in the
# order the scorer builds `ScoreBreakdown.parts`.
DedupeSignal = Literal["contact", "photo", "description", "rooms_floors", "area", "price"]
SIGNAL_ORDER: tuple[DedupeSignal, ...] = (
    "contact",
    "photo",
    "description",
    "rooms_floors",
    "area",
    "price",
)
Decision = Literal["merge", "separate"]


class BreakdownItem(BaseModel):
    signal: DedupeSignal
    points: float
    # No per-signal params (pair count, hamming distance, similarity, ...) are persisted
    # today — only the points are — so this stays null until the scorer records them.
    detail: str | None = None


class DuplicateOwnerOut(BaseModel):
    phone: str | None  # the contact identifier when it is a phone, else null
    classification: ContactClassification  # owner | agent | unknown
    home_count: int | None  # distinct properties this contact is linked to (90d window)


class DuplicateSideOut(BaseModel):
    """One side of a review pair: a property, rendered through a representative listing."""

    property_id: uuid.UUID | None  # side A follows listing.property_id, which may be null
    source: SourceRef
    external_id: str
    url: str | None
    title: str
    description: str
    price: PriceOut
    rooms: int | None
    floor: int | None
    total_floors: int | None
    area_sqm: float | None
    district: str | None
    address_text: str | None
    posted_at: datetime | None
    first_seen_at: datetime
    owner: DuplicateOwnerOut | None
    photos: list[str]


class DuplicatePairOut(BaseModel):
    id: uuid.UUID  # the DedupeReview id — pass it to POST /duplicates/{id}/decide
    score: float
    created_at: datetime
    a: DuplicateSideOut
    b: DuplicateSideOut
    breakdown: list[BreakdownItem]
    # Null while pending; populated on the row returned by POST /decide.
    decision: Decision | None = None
    decided_by: uuid.UUID | None = None
    decided_at: datetime | None = None


class ThresholdsOut(BaseModel):
    review_threshold: float  # score at/above which a pair enters this queue
    merge_threshold: float  # score at/above which the scorer auto-merged (never in queue)


class DecidedRecentOut(BaseModel):
    days: int  # the trailing window these counts cover
    count: int  # reviews decided in the window
    merged_pct: int  # of those, the percentage decided "merge" (0 when count is 0)


class DuplicateQueueOut(BaseModel):
    items: list[DuplicatePairOut]
    thresholds: ThresholdsOut
    decided_recent: DecidedRecentOut


class DecideIn(BaseModel):
    decision: Decision
