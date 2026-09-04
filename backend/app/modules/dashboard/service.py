"""Read-only aggregates behind GET /dashboard (the admin team-overview screen).

Every number comes from a real query over existing tables. Where the underlying feature
hasn't produced data yet — the outreach bot, agents' logged calls — the honest result is
zero, never a fabricated figure. `now` is a parameter so tests can freeze it, matching the
availability service.

The "due for recheck" population reuses the availability service's factored-out
`due_at_expr()` (`next_check_at`, else last-check + recheck window, else new-listing grace),
so the dashboard and the agent queue agree on what is due. Unlike the per-agent queue this
overview keeps source-removed properties (they still need a "confirm it's gone" recheck),
which is why `RecheckItem` carries `source_removed`.
"""

from collections import defaultdict
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.modules.availability.models import PropertyCheck
from app.modules.availability.query import due_at_expr
from app.modules.dashboard.schemas import (
    AgentToday,
    BotReplies,
    DashboardOut,
    NewListings,
    RecheckItem,
    StatusCounts,
)
from app.modules.identity.models import User
from app.modules.listings.models import Listing, RawListing, Source
from app.modules.properties.models import Property

RECHECK_LIMIT = 8
VACANT_CONFIRM_DAYS = 3
NEW_LISTINGS_WINDOW_HOURS = 24

# Call-log outcomes whose result marks a property "active" (see availability.service
# `_STATUS_EFFECT`). Only `still_available` does today — an agent's "found vacant" tally.
VACANT_OUTCOMES = ("still_available",)


async def _status_counts(session: AsyncSession, now: datetime) -> StatusCounts:
    confirm_cutoff = now - timedelta(days=VACANT_CONFIRM_DAYS)
    due = due_at_expr()
    # One pass: five conditional counts over the properties table.
    row = (
        await session.execute(
            select(
                func.count().filter(Property.status == "active"),
                func.count().filter(
                    Property.status == "active", Property.last_checked_at >= confirm_cutoff
                ),
                func.count().filter(Property.status == "inactive"),
                func.count().filter(Property.status == "new"),
                func.count().filter(due <= now),
            )
        )
    ).one()
    return StatusCounts(
        vacant=int(row[0]),
        vacant_confirmed_3d=int(row[1]),
        taken=int(row[2]),
        new=int(row[3]),
        to_check_today=int(row[4]),
    )


async def _new_listings(session: AsyncSession, now: datetime) -> NewListings:
    since = now - timedelta(hours=NEW_LISTINGS_WINDOW_HOURS)
    rows = (
        await session.execute(
            select(Source.kind, func.count(Listing.id))
            .join(RawListing, RawListing.id == Listing.raw_listing_id)
            .join(Source, Source.id == RawListing.source_id)
            .where(Listing.first_seen_at >= since)
            .group_by(Source.kind)
        )
    ).all()
    by_kind = {kind: int(count) for kind, count in rows}
    return NewListings(
        olx=by_kind.get("olx", 0),
        telegram=by_kind.get("telegram", 0),
        manual=by_kind.get("manual", 0),
        # No readily-countable "duplicate among the new listings" signal yet; honest 0.
        duplicates=0,
        total=sum(by_kind.values()),
    )


def _assignment_summary(district: str | None, rooms: int | None) -> str:
    parts: list[str] = []
    if district:
        parts.append(district)
    if rooms is not None:
        parts.append(f"{rooms} xona")
    return ", ".join(parts) if parts else "1 obyekt"


async def _agents_today(session: AsyncSession, now: datetime) -> list[AgentToday]:
    agents = list(
        (
            await session.execute(
                select(User)
                .where(User.role == "agent", User.active.is_(True))
                .order_by(User.created_at, User.id)
            )
        )
        .scalars()
        .all()
    )
    if not agents:
        return []
    agent_ids = [a.id for a in agents]
    today_start = datetime(now.year, now.month, now.day, tzinfo=UTC)

    # calls + found-vacant recorded today, per agent.
    calls: dict[object, tuple[int, int]] = {}
    for agent_id, n_calls, n_vacant in (
        await session.execute(
            select(
                PropertyCheck.agent_id,
                func.count(),
                func.count().filter(PropertyCheck.outcome.in_(VACANT_OUTCOMES)),
            )
            .where(
                PropertyCheck.agent_id.in_(agent_ids),
                PropertyCheck.created_at >= today_start,
            )
            .group_by(PropertyCheck.agent_id)
        )
    ).all():
        calls[agent_id] = (int(n_calls), int(n_vacant))

    # Properties each agent currently holds a live lock on (drives in_queue + working_on).
    held: dict[object, list[tuple[str | None, int | None]]] = defaultdict(list)
    for agent_id, district, rooms in (
        await session.execute(
            select(Property.assigned_agent_id, Property.district, Property.rooms)
            .where(
                Property.assigned_agent_id.in_(agent_ids),
                Property.assignment_expires_at > now,
            )
            .order_by(Property.assignment_expires_at.desc())
        )
    ).all():
        held[agent_id].append((district, rooms))

    out: list[AgentToday] = []
    for agent in agents:
        n_calls, n_vacant = calls.get(agent.id, (0, 0))
        assignments = held.get(agent.id, [])
        working_on = _assignment_summary(*assignments[0]) if assignments else None
        out.append(
            AgentToday(
                id=agent.id,
                name=agent.name,
                in_queue=len(assignments),
                calls=n_calls,
                found_vacant=n_vacant,
                working_on=working_on,
            )
        )
    return out


async def _unassigned(session: AsyncSession, now: datetime) -> int:
    due = due_at_expr()
    return int(
        (
            await session.execute(
                select(func.count())
                .select_from(Property)
                .where(
                    due <= now,
                    or_(
                        Property.assigned_agent_id.is_(None),
                        Property.assignment_expires_at <= now,
                    ),
                )
            )
        ).scalar_one()
    )


async def _recheck(session: AsyncSession, now: datetime) -> tuple[int, list[RecheckItem]]:
    due = due_at_expr()
    total = int(
        (
            await session.execute(select(func.count()).select_from(Property).where(due <= now))
        ).scalar_one()
    )
    # Agent name only when the lock is still live; an expired assignment reads as unassigned.
    holder = aliased(User)
    rows = (
        await session.execute(
            select(Property, holder.name)
            .outerjoin(
                holder,
                (holder.id == Property.assigned_agent_id) & (Property.assignment_expires_at > now),
            )
            .where(due <= now)
            .order_by(due.asc(), Property.id)
            .limit(RECHECK_LIMIT)
        )
    ).all()
    items = [
        RecheckItem(
            id=prop.id,
            district=prop.district,
            rooms=prop.rooms,
            price_usd=(
                prop.price_usd_min_minor // 100 if prop.price_usd_min_minor is not None else None
            ),
            last_checked_at=prop.last_checked_at or prop.first_seen_at,
            source_removed=prop.source_removed,
            agent=agent_name,
        )
        for prop, agent_name in rows
    ]
    return total, items


async def build_dashboard(session: AsyncSession, now: datetime) -> DashboardOut:
    status_counts = await _status_counts(session, now)
    new_listings = await _new_listings(session, now)
    agents = await _agents_today(session, now)
    unassigned = await _unassigned(session, now)
    recheck_total, recheck_items = await _recheck(session, now)
    return DashboardOut(
        status_counts=status_counts,
        new_listings=new_listings,
        # No bot subsystem yet; lights up when M1's outreach bot lands.
        bot_replies=BotReplies(sent=0, answered=0, vacant=0, taken=0, unclear=0),
        agents=agents,
        unassigned=unassigned,
        auto_distribute=False,  # auto-distribution of the unassigned queue isn't built
        recheck_total=recheck_total,
        recheck_items=recheck_items,
    )
