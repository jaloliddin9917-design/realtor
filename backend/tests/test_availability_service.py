"""Service-level tests for the agent queue: membership/ordering, lock state per user,
retry classification, take atomicity, and every call-log outcome effect."""

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.problems import ApiError
from app.modules.availability.models import PropertyCheck
from app.modules.availability.query import LOCK_HOURS, RECHECK_DAYS, RETRY_HOURS, TAKEN_RECHECK_DAYS
from app.modules.availability.schemas import CallConditionsIn, CallLogIn, NextCheckIn
from app.modules.availability.service import build_queue, log_check, release, take
from app.modules.contacts.models import Contact
from app.modules.identity.models import User
from app.modules.identity.service import create_user
from app.modules.properties.models import Property, PropertyStatusEvent

NOW = datetime(2026, 9, 3, 12, 0, tzinfo=UTC)

_phone_seq = 0


async def make_agent(db: AsyncSession, name: str, role: str = "agent") -> User:
    global _phone_seq
    _phone_seq += 1
    return await create_user(
        db, phone_e164=f"+9989000{_phone_seq:05d}", name=name, password="secret1", role=role
    )


async def make_property(
    db: AsyncSession,
    *,
    status: str = "new",
    first_seen: datetime = NOW,
    last_seen: datetime = NOW,
    source_removed: bool = False,
    last_checked_at: datetime | None = None,
    next_check_at: datetime | None = None,
    assigned_agent_id: uuid.UUID | None = None,
    assignment_expires_at: datetime | None = None,
    owner: Contact | None = None,
    rooms: int | None = 2,
    price_usd_min_minor: int | None = 45000,
) -> Property:
    prop = Property(
        status=status,
        first_seen_at=first_seen,
        last_seen_at=last_seen,
        source_removed=source_removed,
        last_checked_at=last_checked_at,
        next_check_at=next_check_at,
        assigned_agent_id=assigned_agent_id,
        assignment_expires_at=assignment_expires_at,
        rooms=rooms,
        price_usd_min_minor=price_usd_min_minor,
        probable_owner_contact_id=owner.id if owner else None,
    )
    db.add(prop)
    await db.flush()
    # mirror create_from_listing: every real property is born with one status event, so
    # set_status's "unchanged -> no new event" branch has history to find.
    db.add(
        PropertyStatusEvent(
            property_id=prop.id, from_status=None, to_status=status, actor_type="crawler"
        )
    )
    await db.flush()
    return prop


async def make_contact(
    db: AsyncSession, identifier: str, *, kind: str = "phone", classification: str = "owner"
) -> Contact:
    c = Contact(
        kind=kind,
        identifier=identifier,
        display_name=None,
        classification=classification,
        distinct_property_count_90d=7 if classification == "agent" else 1,
    )
    db.add(c)
    await db.flush()
    return c


async def add_check(
    db: AsyncSession,
    prop: Property,
    agent: User,
    outcome: str,
    *,
    created_at: datetime,
    next_check_at: datetime | None = None,
) -> PropertyCheck:
    chk = PropertyCheck(
        property_id=prop.id,
        agent_id=agent.id,
        outcome=outcome,
        channel="call",
        created_at=created_at,
        next_check_at=next_check_at,
    )
    db.add(chk)
    await db.flush()
    return chk


def by_id(items: list, property_id: uuid.UUID):  # type: ignore[no-untyped-def]
    return next((i for i in items if i.property_id == property_id), None)


# --- pure helpers ------------------------------------------------------------------------


def test_sub_area_extracts_segment_after_district() -> None:
    from app.modules.availability.query import _sub_area

    assert _sub_area("Chilonzor, Qatortol", "chilonzor") == "Qatortol"
    assert _sub_area("Yunusobod 4-kvartal", "yunusobod") == "4-kvartal"
    assert _sub_area("Sergeli, 7-mavze, 12-uy", "sergeli") == "7-mavze"
    assert _sub_area(None, "chilonzor") == ""
    assert _sub_area("Mirobod", "mirobod") == ""  # nothing after the district


# --- schema / migration -----------------------------------------------------------------


async def test_migration_created_property_checks_and_property_columns(db: AsyncSession) -> None:
    cols = set(
        (
            await db.execute(
                text(
                    "SELECT column_name FROM information_schema.columns "
                    "WHERE table_name = 'property_checks'"
                )
            )
        )
        .scalars()
        .all()
    )
    assert {
        "property_id",
        "agent_id",
        "contact_id",
        "channel",
        "outcome",
        "terms",
        "next_check_at",
        "created_at",
        "note",
        "id",
    } <= cols
    prop_cols = set(
        (
            await db.execute(
                text(
                    "SELECT column_name FROM information_schema.columns "
                    "WHERE table_name = 'properties'"
                )
            )
        )
        .scalars()
        .all()
    )
    assert {
        "last_checked_at",
        "next_check_at",
        "assigned_agent_id",
        "assignment_expires_at",
        "terms",
    } <= prop_cols


# --- build_queue: membership & ordering --------------------------------------------------


async def test_membership_and_ordering(db: AsyncSession) -> None:
    agent = await make_agent(db, "Aziz")
    # due 3 days ago (never checked, seen 5 days ago -> +2d grace)
    p_old = await make_property(db, first_seen=NOW - timedelta(days=5))
    # due 2 days ago (checked 5 days ago -> +3d recheck)
    p_checked = await make_property(db, last_checked_at=NOW - timedelta(days=5))
    # fresh: seen yesterday -> due tomorrow, not a member
    p_fresh = await make_property(db, first_seen=NOW - timedelta(days=1))
    # explicitly scheduled far out -> not a member
    p_future = await make_property(db, next_check_at=NOW + timedelta(days=10))
    # due but removed at source -> not a member
    p_removed = await make_property(db, first_seen=NOW - timedelta(days=5), source_removed=True)

    items = await build_queue(db, agent, "all", NOW)
    ids = [i.property_id for i in items]
    assert p_fresh.id not in ids and p_future.id not in ids and p_removed.id not in ids
    # ordered by due_at ascending: p_old (due -3d) before p_checked (due -2d)
    assert [i.property_id for i in items if i.property_id in {p_old.id, p_checked.id}] == [
        p_old.id,
        p_checked.id,
    ]


async def test_assigned_but_not_due_is_a_member(db: AsyncSession) -> None:
    a = await make_agent(db, "Aziz")
    # not due (fresh) but actively assigned -> still a member
    p = await make_property(
        db,
        first_seen=NOW,
        assigned_agent_id=a.id,
        assignment_expires_at=NOW + timedelta(hours=2),
    )
    items = await build_queue(db, a, "all", NOW)
    assert by_id(items, p.id) is not None


# --- build_queue: per-user state ---------------------------------------------------------


async def test_state_mine_vs_locked_and_new_and_retry(db: AsyncSession) -> None:
    a = await make_agent(db, "Aziz")
    b = await make_agent(db, "Bek")
    assigned = await make_property(
        db,
        first_seen=NOW - timedelta(days=5),
        assigned_agent_id=a.id,
        assignment_expires_at=NOW + timedelta(hours=3),
    )
    fresh_due = await make_property(db, first_seen=NOW - timedelta(days=5))
    retry_p = await make_property(
        db, last_checked_at=NOW - timedelta(hours=2), next_check_at=NOW - timedelta(hours=1)
    )
    await add_check(db, retry_p, a, "no_answer", created_at=NOW - timedelta(hours=2))

    mine = by_id(await build_queue(db, a, "all", NOW), assigned.id)
    assert mine.state.kind == "mine" and mine.state.until == NOW + timedelta(hours=3)
    locked = by_id(await build_queue(db, b, "all", NOW), assigned.id)
    assert locked.state.kind == "locked" and locked.state.agent_name == "Aziz"

    items_a = await build_queue(db, a, "all", NOW)
    assert by_id(items_a, fresh_due.id).state.kind == "new"
    assert by_id(items_a, retry_p.id).state.kind == "retry"


async def test_expired_assignment_is_not_mine(db: AsyncSession) -> None:
    a = await make_agent(db, "Aziz")
    p = await make_property(
        db,
        first_seen=NOW - timedelta(days=5),
        assigned_agent_id=a.id,
        assignment_expires_at=NOW - timedelta(minutes=1),  # expired
    )
    item = by_id(await build_queue(db, a, "all", NOW), p.id)
    assert item is not None and item.state.kind == "new"  # lock lapsed -> back in the pool


# --- build_queue: scope ------------------------------------------------------------------


async def test_scope_today_and_retry(db: AsyncSession) -> None:
    a = await make_agent(db, "Aziz")
    due_plain = await make_property(db, first_seen=NOW - timedelta(days=5))
    retry_p = await make_property(
        db, last_checked_at=NOW - timedelta(hours=2), next_check_at=NOW - timedelta(hours=1)
    )
    await add_check(db, retry_p, a, "call_back", created_at=NOW - timedelta(hours=2))

    all_ids = {i.property_id for i in await build_queue(db, a, "all", NOW)}
    assert {due_plain.id, retry_p.id} <= all_ids

    today_ids = {i.property_id for i in await build_queue(db, a, "today", NOW)}
    assert due_plain.id in today_ids and retry_p.id not in today_ids  # retry excluded from today

    retry_ids = {i.property_id for i in await build_queue(db, a, "retry", NOW)}
    assert retry_p.id in retry_ids and due_plain.id not in retry_ids


# --- build_queue: field mapping ----------------------------------------------------------


async def test_item_fields_owner_availability_price(db: AsyncSession) -> None:
    a = await make_agent(db, "Aziz")
    owner = await make_contact(db, "+998901112233", classification="owner")
    p = await make_property(
        db,
        status="active",
        first_seen=NOW - timedelta(days=5),
        last_checked_at=NOW - timedelta(days=4),
        owner=owner,
        price_usd_min_minor=45000,
    )
    item = by_id(await build_queue(db, a, "all", NOW), p.id)
    assert item.price_usd == 450  # minor -> whole USD
    assert item.availability.status == "vacant" and item.availability.at == NOW - timedelta(days=4)
    assert item.owner.phone == "+998901112233" and item.owner.classification == "owner"
    assert item.owner.home_count is None  # only agents carry a home_count
    assert item.source == "manual"  # no listings
    assert item.last_activity.text == "Hech kim hali aloqa qilmagan"


async def test_agent_owner_carries_home_count(db: AsyncSession) -> None:
    a = await make_agent(db, "Aziz")
    owner = await make_contact(db, "+998905556677", classification="agent")
    p = await make_property(db, first_seen=NOW - timedelta(days=5), owner=owner)
    item = by_id(await build_queue(db, a, "all", NOW), p.id)
    assert item.owner.classification == "agent" and item.owner.home_count == 7
    assert item.owner.phone == "+998905556677"


# --- take: atomic claim ------------------------------------------------------------------


async def test_take_claims_then_second_agent_gets_409(db: AsyncSession) -> None:
    a = await make_agent(db, "Aziz")
    b = await make_agent(db, "Bek")
    p = await make_property(db, first_seen=NOW - timedelta(days=5))

    item = await take(db, p.id, a, NOW)
    assert item.state.kind == "mine" and item.state.until == NOW + timedelta(hours=LOCK_HOURS)
    await db.refresh(p)
    assert p.assigned_agent_id == a.id

    with pytest.raises(ApiError) as exc:
        await take(db, p.id, b, NOW)
    assert exc.value.status == 409 and exc.value.code == "queue.locked"

    # the original holder re-taking their own live lock is idempotent
    again = await take(db, p.id, a, NOW)
    assert again.state.kind == "mine"


async def test_take_after_expiry_succeeds(db: AsyncSession) -> None:
    a = await make_agent(db, "Aziz")
    b = await make_agent(db, "Bek")
    p = await make_property(
        db,
        first_seen=NOW - timedelta(days=5),
        assigned_agent_id=a.id,
        assignment_expires_at=NOW - timedelta(minutes=1),  # lapsed
    )
    item = await take(db, p.id, b, NOW)  # b may claim a lapsed lock
    assert item.state.kind == "mine"
    await db.refresh(p)
    assert p.assigned_agent_id == b.id


async def test_take_unknown_property_404(db: AsyncSession) -> None:
    a = await make_agent(db, "Aziz")
    with pytest.raises(ApiError) as exc:
        await take(db, uuid.uuid4(), a, NOW)
    assert exc.value.status == 404


async def test_release_clears_only_own_lock_admin_forces(db: AsyncSession) -> None:
    a = await make_agent(db, "Aziz")
    b = await make_agent(db, "Bek")
    admin = await make_agent(db, "Boss", role="admin")
    p = await make_property(
        db,
        first_seen=NOW - timedelta(days=5),
        assigned_agent_id=a.id,
        assignment_expires_at=NOW + timedelta(hours=3),
    )
    await release(db, p.id, b)  # not the holder -> no-op
    await db.refresh(p)
    assert p.assigned_agent_id == a.id
    await release(db, p.id, admin)  # admin force-releases
    await db.refresh(p)
    assert p.assigned_agent_id is None


# --- log_check: outcome effects ----------------------------------------------------------


async def _event_count(db: AsyncSession, property_id: uuid.UUID) -> int:
    return int(
        (
            await db.execute(
                select(func.count(PropertyStatusEvent.id)).where(
                    PropertyStatusEvent.property_id == property_id
                )
            )
        ).scalar_one()
    )


def _body(outcome: str, next_check: NextCheckIn | None = None, **conditions) -> CallLogIn:  # type: ignore[no-untyped-def]
    return CallLogIn(
        outcome=outcome,
        conditions=CallConditionsIn(**conditions),
        note="izoh",
        next_check=next_check,
    )


async def test_log_still_available_activates_and_updates_terms(db: AsyncSession) -> None:
    a = await make_agent(db, "Aziz")
    p = await make_property(
        db,
        status="new",
        first_seen=NOW - timedelta(days=5),
        assigned_agent_id=a.id,
        assignment_expires_at=NOW + timedelta(hours=2),
    )
    before = await _event_count(db, p.id)
    out = await log_check(
        db, p.id, a, _body("still_available", foreigners=True, deposit_months=2), NOW
    )
    await db.refresh(p)
    assert out.resulting_status == "vacant"
    assert p.status == "active"
    assert await _event_count(db, p.id) == before + 1  # status changed -> one event
    assert p.terms == {"foreigners": True, "deposit_months": 2, "family_only": False}
    assert p.next_check_at == NOW + timedelta(days=RECHECK_DAYS)
    assert p.last_checked_at == NOW
    assert p.assigned_agent_id is None  # lock released


async def test_log_taken_deactivates_and_schedules_30d(db: AsyncSession) -> None:
    a = await make_agent(db, "Aziz")
    p = await make_property(db, status="active", first_seen=NOW - timedelta(days=5))
    before = await _event_count(db, p.id)
    out = await log_check(db, p.id, a, _body("taken"), NOW)
    await db.refresh(p)
    assert out.resulting_status == "taken" and p.status == "inactive"
    assert await _event_count(db, p.id) == before + 1
    assert p.next_check_at == NOW + timedelta(days=TAKEN_RECHECK_DAYS)


async def test_log_still_available_when_already_active_emits_no_event(db: AsyncSession) -> None:
    a = await make_agent(db, "Aziz")
    p = await make_property(db, status="active", first_seen=NOW - timedelta(days=5))
    before = await _event_count(db, p.id)
    out = await log_check(db, p.id, a, _body("still_available"), NOW)
    await db.refresh(p)
    assert out.resulting_status == "vacant" and p.status == "active"
    assert await _event_count(db, p.id) == before  # unchanged -> no new event


async def test_log_no_answer_unchanged_and_retry_schedule(db: AsyncSession) -> None:
    a = await make_agent(db, "Aziz")
    p = await make_property(db, status="active", first_seen=NOW - timedelta(days=5))
    before = await _event_count(db, p.id)
    out = await log_check(db, p.id, a, _body("no_answer"), NOW)
    await db.refresh(p)
    assert out.resulting_status == "unchanged" and p.status == "active"
    assert await _event_count(db, p.id) == before
    assert p.next_check_at == NOW + timedelta(hours=RETRY_HOURS)


async def test_log_call_back_uses_input_next_check(db: AsyncSession) -> None:
    a = await make_agent(db, "Aziz")
    p = await make_property(db, status="active", first_seen=NOW - timedelta(days=5))
    out = await log_check(
        db, p.id, a, _body("call_back", next_check=NextCheckIn(choice="tomorrow")), NOW
    )
    await db.refresh(p)
    assert out.resulting_status == "unchanged"
    assert p.next_check_at == NOW + timedelta(days=1)


async def test_log_call_back_with_explicit_date(db: AsyncSession) -> None:
    a = await make_agent(db, "Aziz")
    p = await make_property(db, status="active", first_seen=NOW - timedelta(days=5))
    when = NOW + timedelta(days=6, hours=3)
    await log_check(
        db, p.id, a, _body("call_back", next_check=NextCheckIn(choice="date", date=when)), NOW
    )
    await db.refresh(p)
    assert p.next_check_at == when


async def test_log_realtor_not_owner_reclassifies_contact(db: AsyncSession) -> None:
    a = await make_agent(db, "Aziz")
    owner = await make_contact(db, "+998901234567", classification="owner")
    p = await make_property(db, status="active", first_seen=NOW - timedelta(days=5), owner=owner)
    out = await log_check(db, p.id, a, _body("realtor_not_owner"), NOW)
    await db.refresh(owner)
    await db.refresh(p)
    assert out.resulting_status == "unchanged"
    assert owner.classification == "agent"
    assert p.next_check_at == NOW + timedelta(days=RECHECK_DAYS)


async def test_log_do_not_contact_flags_contact_and_stops_scheduling(db: AsyncSession) -> None:
    a = await make_agent(db, "Aziz")
    owner = await make_contact(db, "+998907654321", classification="owner")
    p = await make_property(db, status="active", first_seen=NOW - timedelta(days=5), owner=owner)
    # even with an explicit next_check, do_not_contact is terminal
    out = await log_check(
        db, p.id, a, _body("do_not_contact", next_check=NextCheckIn(choice="in_3_days")), NOW
    )
    await db.refresh(owner)
    await db.refresh(p)
    assert out.resulting_status == "unchanged"
    assert owner.do_not_contact is True
    assert p.next_check_at is None


async def test_log_wrong_number_reschedules_recheck(db: AsyncSession) -> None:
    a = await make_agent(db, "Aziz")
    p = await make_property(db, status="active", first_seen=NOW - timedelta(days=5))
    await log_check(db, p.id, a, _body("wrong_number"), NOW)
    await db.refresh(p)
    assert p.next_check_at == NOW + timedelta(days=RECHECK_DAYS)


async def test_log_creates_check_row_with_terms_and_agent(db: AsyncSession) -> None:
    a = await make_agent(db, "Aziz")
    p = await make_property(db, status="active", first_seen=NOW - timedelta(days=5))
    out = await log_check(db, p.id, a, _body("no_answer", deposit_months=1, family_only=True), NOW)
    chk = await db.get(PropertyCheck, out.id)
    assert chk is not None
    assert chk.property_id == p.id and chk.agent_id == a.id and chk.outcome == "no_answer"
    assert chk.terms == {"foreigners": False, "deposit_months": 1, "family_only": True}
    assert chk.created_at == NOW


async def test_log_check_then_last_activity_shows_agent_and_uz_label(db: AsyncSession) -> None:
    a = await make_agent(db, "Aziz")
    # keep it due after the check so it stays a queue member
    p = await make_property(db, status="active", first_seen=NOW - timedelta(days=5))
    await log_check(
        db, p.id, a, _body("call_back", next_check=NextCheckIn(choice="date", date=NOW)), NOW
    )
    item = by_id(await build_queue(db, a, "all", NOW), p.id)
    assert item is not None
    assert item.last_activity.text.startswith("Aziz — ")
    assert item.last_activity.at == NOW
