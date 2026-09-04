"""Response models for GET /dashboard (the admin team-overview screen).

Snake_case throughout (like `properties.schemas.PropertyRow`); the web maps these to the
camelCase its Dashboard renders. Every field is a real aggregate — where a feature hasn't
produced data yet (the outreach bot, logged calls) the honest value is zero, not a fake.
"""

import uuid
from datetime import datetime

from pydantic import BaseModel


class StatusCounts(BaseModel):
    vacant: int  # properties with status "active"
    vacant_confirmed_3d: int  # of those, confirmed vacant in the last 3 days (0 until calls log)
    taken: int  # status "inactive"
    new: int  # status "new"
    to_check_today: int  # due for a recheck now (availability due-rule)


class NewListings(BaseModel):
    olx: int
    telegram: int
    manual: int
    duplicates: int  # 0 until dedupe exposes a readily-countable 24h duplicate tally
    total: int


class BotReplies(BaseModel):
    # There is no outreach bot in M1-2: every field stays 0 until M1's bot lands.
    sent: int
    answered: int
    vacant: int
    taken: int
    unclear: int


class AgentToday(BaseModel):
    id: uuid.UUID
    name: str
    in_queue: int  # properties currently locked to this agent
    calls: int  # call-log entries this agent recorded today
    found_vacant: int  # of those, ones that confirmed the property vacant
    working_on: str | None  # summary of a current assignment, or null when none


class RecheckItem(BaseModel):
    id: uuid.UUID
    district: str | None
    rooms: int | None
    price_usd: int | None  # whole USD (price_usd_min_minor // 100)
    last_checked_at: datetime  # last check, or first_seen_at when never checked
    source_removed: bool
    agent: str | None  # name of the agent holding a live lock, or null


class DashboardOut(BaseModel):
    status_counts: StatusCounts
    new_listings: NewListings
    bot_replies: BotReplies
    agents: list[AgentToday]
    unassigned: int  # due properties with no live assignment
    auto_distribute: bool  # always false; auto-distributing the queue isn't built yet
    recheck_total: int  # total due for recheck (recheck_items is the top few)
    recheck_items: list[RecheckItem]
