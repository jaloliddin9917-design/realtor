"""Service-level tests for the dashboard aggregates: status counts, new-listings-24h,
recheck membership/ordering, per-agent call tallies, and the honest zeros (bot, empty DB)."""

import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.availability.models import PropertyCheck
from app.modules.dashboard.service import build_dashboard
from app.modules.identity.models import User
from app.modules.identity.service import create_user
from app.modules.listings.models import Listing, RawListing, Source
from app.modules.properties.models import Property

NOW = datetime(2026, 9, 4, 12, 0, tzinfo=UTC)

_phone_seq = 0


async def make_agent(
    db: AsyncSession,
    name: str,
    *,
    role: str = "agent",
    active: bool = True,
    created_at: datetime | None = None,
) -> User:
    global _phone_seq
    _phone_seq += 1
    user = await create_user(
        db, phone_e164=f"+9989000{_phone_seq:05d}", name=name, password="secret1", role=role
    )
    # created_at is a server default (== transaction start, so identical for every row in a
    # test); set it explicitly when a test asserts ordering.
    if created_at is not None:
        user.created_at = created_at
    if not active:
        user.active = False
    await db.flush()
    return user


async def make_property(
    db: AsyncSession,
    *,
    status: str = "new",
    first_seen: datetime = NOW,
    last_checked_at: datetime | None = None,
    next_check_at: datetime | None = None,
    source_removed: bool = False,
    assigned_agent_id: uuid.UUID | None = None,
    assignment_expires_at: datetime | None = None,
    district: str | None = None,
    rooms: int | None = 2,
    price_usd_min_minor: int | None = 45000,
) -> Property:
    prop = Property(
        status=status,
        first_seen_at=first_seen,
        last_seen_at=first_seen,
        last_checked_at=last_checked_at,
        next_check_at=next_check_at,
        source_removed=source_removed,
        assigned_agent_id=assigned_agent_id,
        assignment_expires_at=assignment_expires_at,
        district=district,
        rooms=rooms,
        price_usd_min_minor=price_usd_min_minor,
    )
    db.add(prop)
    await db.flush()
    return prop


async def add_check(
    db: AsyncSession, prop: Property, agent: User, outcome: str, *, created_at: datetime
) -> PropertyCheck:
    chk = PropertyCheck(
        property_id=prop.id,
        agent_id=agent.id,
        outcome=outcome,
        channel="call",
        created_at=created_at,
    )
    db.add(chk)
    await db.flush()
    return chk


async def make_source(db: AsyncSession, kind: str, name: str) -> Source:
    src = Source(kind=kind, name=name)
    db.add(src)
    await db.flush()
    return src


async def make_listing(
    db: AsyncSession, source: Source, *, first_seen: datetime, ext: str
) -> Listing:
    raw = RawListing(
        source_id=source.id,
        external_id=ext,
        payload={},
        content_hash=f"h{ext}",
        fetched_at=first_seen,
    )
    db.add(raw)
    await db.flush()
    listing = Listing(raw_listing_id=raw.id, first_seen_at=first_seen, last_seen_at=first_seen)
    db.add(listing)
    await db.flush()
    return listing


# --- status counts -----------------------------------------------------------------------


async def test_status_counts_by_status_and_confirmed(db: AsyncSession) -> None:
    # two vacant (one confirmed within 3d, one confirmed 5d ago), one taken, three new
    await make_property(db, status="active", last_checked_at=NOW - timedelta(days=1))
    await make_property(db, status="active", last_checked_at=NOW - timedelta(days=5))
    await make_property(db, status="inactive")
    for _ in range(3):
        await make_property(db, status="new", first_seen=NOW)  # fresh -> not due

    out = await build_dashboard(db, NOW)
    sc = out.status_counts
    assert sc.vacant == 2
    assert sc.vacant_confirmed_3d == 1  # only the one checked within 3 days
    assert sc.taken == 1
    assert sc.new == 3


# --- new listings (24h) ------------------------------------------------------------------


async def test_new_listings_last_24h_by_source_kind(db: AsyncSession) -> None:
    olx = await make_source(db, "olx", "olx-tashkent")
    tg = await make_source(db, "telegram", "@chan")
    await make_listing(db, olx, first_seen=NOW - timedelta(hours=1), ext="o1")
    await make_listing(db, olx, first_seen=NOW - timedelta(hours=3), ext="o2")
    await make_listing(db, tg, first_seen=NOW - timedelta(hours=2), ext="t1")
    await make_listing(db, olx, first_seen=NOW - timedelta(days=2), ext="o_old")  # excluded

    out = await build_dashboard(db, NOW)
    nl = out.new_listings
    assert nl.olx == 2 and nl.telegram == 1 and nl.manual == 0
    assert nl.total == 3
    assert nl.duplicates == 0  # no readily-countable dedupe tally yet


# --- recheck list: membership, ordering, source-removed inclusion ------------------------


async def test_recheck_membership_ordering_and_totals(db: AsyncSession) -> None:
    # distinct due times so ordering is deterministic (oldest-due first)
    p_old = await make_property(db, first_seen=NOW - timedelta(days=6))  # due NOW-4d
    p_removed = await make_property(
        db, next_check_at=NOW - timedelta(days=3), source_removed=True
    )  # due NOW-3d
    p_mid = await make_property(db, last_checked_at=NOW - timedelta(days=5))  # due NOW-2d
    p_soon = await make_property(db, next_check_at=NOW - timedelta(hours=6))  # due NOW-6h
    # not due:
    await make_property(db, next_check_at=NOW + timedelta(days=10))
    await make_property(db, first_seen=NOW)  # fresh -> due in 2 days

    out = await build_dashboard(db, NOW)
    assert out.recheck_total == 4
    assert out.status_counts.to_check_today == 4  # same population as recheck
    assert [i.id for i in out.recheck_items] == [p_old.id, p_removed.id, p_mid.id, p_soon.id]
    by_id = {i.id: i for i in out.recheck_items}
    assert by_id[p_removed.id].source_removed is True
    assert by_id[p_old.id].source_removed is False
    # never-checked property falls back to first_seen_at for last_checked_at
    assert by_id[p_old.id].last_checked_at == p_old.first_seen_at
    assert by_id[p_mid.id].last_checked_at == NOW - timedelta(days=5)
    assert by_id[p_old.id].price_usd == 450  # 45000 minor -> whole USD


async def test_recheck_price_null_stays_null(db: AsyncSession) -> None:
    p = await make_property(db, first_seen=NOW - timedelta(days=6), price_usd_min_minor=None)
    out = await build_dashboard(db, NOW)
    item = next(i for i in out.recheck_items if i.id == p.id)
    assert item.price_usd is None


# --- unassigned + agent-name on recheck items --------------------------------------------


async def test_unassigned_counts_due_without_live_lock(db: AsyncSession) -> None:
    a = await make_agent(db, "Aziz")
    live = await make_property(
        db,
        first_seen=NOW - timedelta(days=6),
        assigned_agent_id=a.id,
        assignment_expires_at=NOW + timedelta(hours=2),
    )
    expired = await make_property(
        db,
        first_seen=NOW - timedelta(days=6),
        assigned_agent_id=a.id,
        assignment_expires_at=NOW - timedelta(hours=1),
    )
    free = await make_property(db, first_seen=NOW - timedelta(days=6))

    out = await build_dashboard(db, NOW)
    # live lock is not unassigned; the expired one and the free one are
    assert out.unassigned == 2
    by_id = {i.id: i for i in out.recheck_items}
    assert by_id[live.id].agent == "Aziz"  # live holder shows a name
    assert by_id[expired.id].agent is None  # expired lock reads as unassigned
    assert by_id[free.id].agent is None


# --- agents today ------------------------------------------------------------------------


async def test_agents_today_calls_and_membership(db: AsyncSession) -> None:
    a = await make_agent(db, "Aziz", created_at=NOW - timedelta(days=2))
    b = await make_agent(db, "Bek", created_at=NOW - timedelta(days=1))
    await make_agent(db, "Gone", active=False, created_at=NOW - timedelta(days=3))  # inactive
    await make_agent(db, "Boss", role="admin", created_at=NOW - timedelta(days=4))  # not an agent

    plain = await make_property(db, first_seen=NOW - timedelta(days=6))
    # Aziz: 2 vacant + 1 no-answer today, and 1 vacant two days ago (excluded from "today")
    await add_check(db, plain, a, "still_available", created_at=NOW)
    await add_check(db, plain, a, "still_available", created_at=NOW - timedelta(hours=1))
    await add_check(db, plain, a, "no_answer", created_at=NOW - timedelta(hours=2))
    await add_check(db, plain, a, "still_available", created_at=NOW - timedelta(days=2))
    # Bek: 1 taken today
    await add_check(db, plain, b, "taken", created_at=NOW)
    # Bek holds a live lock on one property -> in_queue 1, working_on set
    await make_property(
        db,
        first_seen=NOW - timedelta(days=6),
        district="chilonzor",
        rooms=3,
        assigned_agent_id=b.id,
        assignment_expires_at=NOW + timedelta(hours=2),
    )

    out = await build_dashboard(db, NOW)
    assert [ag.name for ag in out.agents] == ["Aziz", "Bek"]  # active agents, oldest first
    az, bk = out.agents
    assert az.calls == 3 and az.found_vacant == 2  # today only; still_available -> found_vacant
    assert az.in_queue == 0 and az.working_on is None
    assert bk.calls == 1 and bk.found_vacant == 0
    assert bk.in_queue == 1 and bk.working_on == "chilonzor, 3 xona"


# --- honest zeros ------------------------------------------------------------------------


async def test_bot_replies_are_zero(db: AsyncSession) -> None:
    await make_property(db, status="active")
    out = await build_dashboard(db, NOW)
    br = out.bot_replies
    assert (br.sent, br.answered, br.vacant, br.taken, br.unclear) == (0, 0, 0, 0, 0)
    assert out.auto_distribute is False


async def test_empty_db_is_all_zeros(db: AsyncSession) -> None:
    out = await build_dashboard(db, NOW)
    sc = out.status_counts
    assert (sc.vacant, sc.taken, sc.new, sc.to_check_today) == (0, 0, 0, 0)
    assert out.new_listings.total == 0
    assert out.agents == []
    assert out.unassigned == 0
    assert out.recheck_total == 0 and out.recheck_items == []
