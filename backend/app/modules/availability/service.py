"""Mutations behind the agent queue: build, take/lock, release, and the call-log.

The lock is a short-lived, self-expiring claim on a property (`assigned_agent_id` +
`assignment_expires_at`), taken by a single conditional UPDATE so two agents racing for the
same property can never both win. Logging a check records the outcome, reschedules the next
check, applies the outcome's side effects, and releases the lock.
"""

import uuid
from datetime import datetime, timedelta
from typing import Any, cast

from sqlalchemy import CursorResult, or_, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.problems import ApiError
from app.modules.availability.models import PropertyCheck
from app.modules.availability.query import (
    LOCK_HOURS,
    RECHECK_DAYS,
    RETRY_HOURS,
    TAKEN_RECHECK_DAYS,
    assemble_items,
    is_retry,
    latest_checks,
    select_queue,
)
from app.modules.availability.schemas import (
    CallLogIn,
    CheckOut,
    NextCheckIn,
    QueueItemOut,
    QueueScope,
    ResultingStatus,
)
from app.modules.contacts.models import Contact
from app.modules.identity.models import User
from app.modules.properties.models import Property
from app.modules.properties.service import set_status

# outcome -> (new property status | None, resulting_status, updates property.terms)
_STATUS_EFFECT: dict[str, tuple[str | None, ResultingStatus, bool]] = {
    "still_available": ("active", "vacant", True),
    "taken": ("inactive", "taken", True),
    "no_answer": (None, "unchanged", False),
    "call_back": (None, "unchanged", False),
    "realtor_not_owner": (None, "unchanged", False),
    "do_not_contact": (None, "unchanged", False),
    "wrong_number": (None, "unchanged", False),
}


async def build_queue(
    session: AsyncSession, user: User, scope: QueueScope, now: datetime
) -> list[QueueItemOut]:
    """Queue members for `scope`: `all` (every member), `today` (due and not awaiting a
    retry), or `retry` (latest check outcome is a no-answer / call-back)."""
    rows = (await session.execute(select_queue(now))).all()
    props: list[tuple[Property, datetime]] = [(r[0], r[1]) for r in rows]
    checks = await latest_checks(session, [p.id for p, _ in props])
    if scope == "today":
        props = [(p, d) for p, d in props if d <= now and not is_retry(checks.get(p.id))]
    elif scope == "retry":
        props = [(p, d) for p, d in props if is_retry(checks.get(p.id))]
    return await assemble_items(session, props, user, now, checks)


def _explicit_next_check(next_check: NextCheckIn | None, now: datetime) -> datetime | None:
    """The agent's chosen next-check time, or None when they made no choice."""
    if next_check is None:
        return None
    if next_check.choice == "in_3_days":
        return now + timedelta(days=RECHECK_DAYS)
    if next_check.choice == "tomorrow":
        return now + timedelta(days=1)
    return next_check.date  # choice == "date"


def _default_next_check(outcome: str, now: datetime) -> datetime | None:
    """Per-outcome fallback schedule, used when the agent gave no explicit next check."""
    if outcome in ("still_available", "realtor_not_owner", "wrong_number"):
        return now + timedelta(days=RECHECK_DAYS)
    if outcome == "taken":
        return now + timedelta(days=TAKEN_RECHECK_DAYS)
    if outcome == "no_answer":
        return now + timedelta(hours=RETRY_HOURS)
    # call_back with no explicit date, and do_not_contact, schedule nothing here.
    return None


async def _reload_item(
    session: AsyncSession, prop: Property, user: User, now: datetime
) -> QueueItemOut:
    """Render one property as a `QueueItemOut` (the due value is unused off the list path)."""
    await session.refresh(prop)
    return (await assemble_items(session, [(prop, now)], user, now))[0]


async def take(
    session: AsyncSession, property_id: uuid.UUID, user: User, now: datetime
) -> QueueItemOut:
    """Atomically claim a property. 404 if unknown; 409 `queue.locked` if another agent
    holds an unexpired claim. Re-taking one's own live lock is idempotent."""
    prop = await session.get(Property, property_id)
    if prop is None:
        raise ApiError(404, "not_found", "property not found")
    expires = now + timedelta(hours=LOCK_HOURS)
    result = cast(
        CursorResult[Any],
        await session.execute(
            update(Property)
            .where(
                Property.id == property_id,
                or_(
                    Property.assigned_agent_id.is_(None),
                    Property.assignment_expires_at <= now,
                ),
            )
            .values(assigned_agent_id=user.id, assignment_expires_at=expires)
            .execution_options(synchronize_session=False)
        ),
    )
    await session.flush()
    if result.rowcount == 0:
        # Claimed nothing: either someone else holds it, or it is already mine (idempotent).
        await session.refresh(prop)
        if prop.assigned_agent_id != user.id:
            raise ApiError(409, "queue.locked", "property is locked by another agent")
    return await _reload_item(session, prop, user, now)


async def release(session: AsyncSession, property_id: uuid.UUID, user: User) -> None:
    """Clear the assignment if this user holds it; an admin may force-release any lock."""
    prop = await session.get(Property, property_id)
    if prop is None:
        raise ApiError(404, "not_found", "property not found")
    if prop.assigned_agent_id is None:
        return
    if prop.assigned_agent_id == user.id or user.role == "admin":
        prop.assigned_agent_id = None
        prop.assignment_expires_at = None
        await session.flush()


async def log_check(
    session: AsyncSession,
    property_id: uuid.UUID,
    user: User,
    body: CallLogIn,
    now: datetime,
) -> CheckOut:
    """Record a contact attempt: schedule the next check, apply the outcome's side effects,
    release the lock, and emit a status event only when the status actually changes."""
    prop = await session.get(Property, property_id)
    if prop is None:
        raise ApiError(404, "not_found", "property not found")

    contact: Contact | None = None
    if prop.probable_owner_contact_id is not None:
        contact = await session.get(Contact, prop.probable_owner_contact_id)

    terms: dict[str, Any] = {
        "foreigners": body.conditions.foreigners,
        "deposit_months": body.conditions.deposit_months,
        "family_only": body.conditions.family_only,
    }
    outcome = body.outcome
    new_status, resulting, updates_terms = _STATUS_EFFECT[outcome]

    # Next check: the agent's explicit choice wins; otherwise the per-outcome default.
    # `do_not_contact` is terminal — never reschedule, whatever the body says.
    if outcome == "do_not_contact":
        next_check_at: datetime | None = None
    else:
        next_check_at = _explicit_next_check(body.next_check, now) or _default_next_check(
            outcome, now
        )

    # Contact-side effects.
    if outcome == "realtor_not_owner" and contact is not None:
        contact.classification = "agent"
    if outcome == "do_not_contact" and contact is not None:
        contact.do_not_contact = True

    if updates_terms:
        prop.terms = terms
    if new_status is not None:
        # set_status writes an event only when the status actually changes.
        await set_status(
            session,
            prop,
            new_status,
            actor_type=user.role,
            actor_id=user.id,
            note=body.note or None,
        )

    prop.last_checked_at = now
    prop.next_check_at = next_check_at
    # Logging a check always releases the lock back to the open pool.
    prop.assigned_agent_id = None
    prop.assignment_expires_at = None

    check = PropertyCheck(
        property_id=prop.id,
        agent_id=user.id,
        contact_id=contact.id if contact is not None else None,
        channel="call",
        outcome=outcome,
        note=body.note or None,
        terms=terms,
        next_check_at=next_check_at,
        created_at=now,
    )
    session.add(check)
    await session.flush()

    return CheckOut(
        id=check.id,
        property_id=prop.id,
        outcome=outcome,
        resulting_status=resulting,
        logged_at=now,
    )
