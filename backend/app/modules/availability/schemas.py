"""Request/response models for the agent queue and call-log.

Snake_case throughout (like `properties.schemas.PropertyRow`); the web client maps these
to its camelCase `QueueItem` / `CallLogResult`. Closed value sets are `Literal`s so they
land in the OpenAPI contract as enums the web generates against.
"""

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

# The frontend's six call outcomes plus `still_available` (the positive "yes, it's free"
# result the web folds into its default). `resulting_status` collapses these to three.
CallOutcome = Literal[
    "still_available",
    "taken",
    "no_answer",
    "call_back",
    "realtor_not_owner",
    "do_not_contact",
    "wrong_number",
]
ResultingStatus = Literal["vacant", "taken", "unchanged"]
AvailabilityStatus = Literal["vacant", "taken", "unknown"]
OwnerClassification = Literal["owner", "agent", "unknown"]
QueueStateKind = Literal["mine", "locked", "new", "retry"]
QueueSource = Literal["olx", "telegram", "manual"]
QueueScope = Literal["all", "today", "retry"]
NextCheckChoice = Literal["in_3_days", "tomorrow", "date"]


class AvailabilityOut(BaseModel):
    status: AvailabilityStatus
    at: datetime


class QueueOwnerOut(BaseModel):
    phone: str
    classification: OwnerClassification
    home_count: int | None


class LastActivityOut(BaseModel):
    text: str
    at: datetime


class QueueStateOut(BaseModel):
    kind: QueueStateKind
    until: datetime | None = None
    agent_name: str | None = None


class QueueItemOut(BaseModel):
    id: str
    property_id: uuid.UUID
    district: str | None
    sub_area: str
    rooms: int | None
    floor: int | None
    total_floors: int | None
    area_sqm: float | None
    price_usd: int
    availability: AvailabilityOut
    owner: QueueOwnerOut
    last_activity: LastActivityOut
    state: QueueStateOut
    source: QueueSource


class CallConditionsIn(BaseModel):
    foreigners: bool = False
    deposit_months: int | None = Field(default=None, ge=0, le=60)
    family_only: bool = False


class NextCheckIn(BaseModel):
    choice: NextCheckChoice
    # Only meaningful (and required) when choice == "date".
    date: datetime | None = None


class CallLogIn(BaseModel):
    outcome: CallOutcome
    conditions: CallConditionsIn = CallConditionsIn()
    note: str = Field("", max_length=2000)
    next_check: NextCheckIn | None = None


class CheckOut(BaseModel):
    id: uuid.UUID
    property_id: uuid.UUID
    outcome: CallOutcome
    resulting_status: ResultingStatus
    logged_at: datetime
