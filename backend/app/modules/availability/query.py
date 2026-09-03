"""Read side of the agent queue: which properties are due, and how each renders.

`due_at` per property is the earliest of an explicit `next_check_at`, a recheck after the
last check, or the first-of-a-new-listing grace period — computed in SQL so membership and
ordering happen in one indexed pass. Everything a `QueueItemOut` needs beyond the property
row (latest check, listings, owner contact, agent names) is gathered in a handful of
`IN (...)` queries and assembled in Python, mirroring `properties.query`.
"""

import uuid
from collections import defaultdict
from datetime import datetime, timedelta
from typing import cast

from sqlalchemy import ColumnElement, Select, and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.modules.availability.models import PropertyCheck
from app.modules.availability.schemas import (
    AvailabilityOut,
    AvailabilityStatus,
    LastActivityOut,
    OwnerClassification,
    QueueItemOut,
    QueueOwnerOut,
    QueueSource,
    QueueStateOut,
)
from app.modules.contacts.models import Contact
from app.modules.identity.models import User
from app.modules.listings.models import Listing, RawListing
from app.modules.properties.models import Property

NEW_LISTING_CHECK_DAYS = 2
RECHECK_DAYS = 3
LOCK_HOURS = 4
RETRY_HOURS = 20  # "next day" without landing on the same clock time as a fresh recheck
TAKEN_RECHECK_DAYS = 30

RETRY_OUTCOMES = ("no_answer", "call_back")

# Short Uzbek labels for the composed `last_activity.text`. Server-composed uz copy is a
# deliberate, pragmatic choice for now (the web owns richer i18n phrasing later); noted in
# the module report.
OUTCOME_LABEL_UZ: dict[str, str] = {
    "still_available": "bo'sh ekan",
    "taken": "topshirilgan",
    "no_answer": "javob yo'q",
    "call_back": "keyinroq qo'ng'iroq qilishni so'radi",
    "realtor_not_owner": "rieltor, uy egasi emas",
    "do_not_contact": "qo'ng'iroq qilmaslikni so'radi",
    "wrong_number": "noto'g'ri raqam",
}

_AVAILABILITY: dict[str, AvailabilityStatus] = {
    "active": "vacant",
    "inactive": "taken",
    "new": "unknown",
}


def due_at_expr() -> ColumnElement[datetime]:
    """`next_check_at`, else recheck-after-last-check, else new-listing grace period.

    `coalesce` picks the first non-null: when `last_checked_at` is null the recheck term is
    null too, so a never-checked property falls through to `first_seen_at + NEW_LISTING`.
    """
    return func.coalesce(
        Property.next_check_at,
        Property.last_checked_at + timedelta(days=RECHECK_DAYS),
        Property.first_seen_at + timedelta(days=NEW_LISTING_CHECK_DAYS),
    )


def _is_assigned(now: datetime) -> ColumnElement[bool]:
    return and_(
        Property.assigned_agent_id.is_not(None),
        Property.assignment_expires_at > now,
    )


def select_queue(now: datetime) -> Select[tuple[Property, datetime]]:
    """Every queue member — not source-removed, and either actively assigned or due —
    ordered by `due_at` ascending."""
    due = due_at_expr()
    return (
        select(Property, due.label("due_at"))
        .where(
            Property.source_removed.is_(False),
            or_(_is_assigned(now), due <= now),
        )
        .order_by(due.asc(), Property.id)
    )


async def latest_checks(
    session: AsyncSession, property_ids: list[uuid.UUID]
) -> dict[uuid.UUID, PropertyCheck]:
    """The most recent `PropertyCheck` per property (DISTINCT ON), keyed by property id."""
    if not property_ids:
        return {}
    stmt = (
        select(PropertyCheck)
        .where(PropertyCheck.property_id.in_(property_ids))
        .order_by(
            PropertyCheck.property_id,
            PropertyCheck.created_at.desc(),
            PropertyCheck.id.desc(),
        )
        .distinct(PropertyCheck.property_id)
    )
    rows = (await session.execute(stmt)).scalars().all()
    return {c.property_id: c for c in rows}


def is_retry(check: PropertyCheck | None) -> bool:
    return check is not None and check.outcome in RETRY_OUTCOMES


async def _listings_by_property(
    session: AsyncSession, property_ids: list[uuid.UUID]
) -> dict[uuid.UUID, list[Listing]]:
    if not property_ids:
        return {}
    stmt = (
        select(Listing)
        .options(selectinload(Listing.raw).selectinload(RawListing.source))
        .where(Listing.property_id.in_(property_ids))
    )
    out: dict[uuid.UUID, list[Listing]] = defaultdict(list)
    for listing in (await session.execute(stmt)).scalars().all():
        if listing.property_id is not None:
            out[listing.property_id].append(listing)
    return out


def _best_listing(listings: list[Listing]) -> Listing | None:
    """Same ranking as `properties.service.recompute`: highest-confidence, then newest."""
    if not listings:
        return None
    return max(
        listings,
        key=lambda x: (x.parse_confidence, x.posted_at or x.created_at, x.created_at, x.id),
    )


def _primary_source(listings: list[Listing]) -> QueueSource:
    if not listings:
        return "manual"
    recent = max(listings, key=lambda x: (x.last_seen_at, x.id))
    return cast(QueueSource, recent.raw.source.kind)


def _sub_area(address_text: str | None, district: str | None) -> str:
    """Best-effort micro-district: the piece of the address after the district name."""
    if not address_text:
        return ""
    text = address_text.strip()
    d = (district or "").strip()
    if d:
        idx = text.lower().find(d.lower())
        if idx != -1:
            after = text[idx + len(d) :].lstrip(" ,;:-–—").strip()
            first = after.split(",")[0].strip()
            if first:
                return first
    for part in (p.strip() for p in text.split(",")):
        if part and (not d or part.lower() != d.lower()):
            return part
    return ""


def _owner_out(contact: Contact | None) -> QueueOwnerOut:
    if contact is None:
        return QueueOwnerOut(phone="", classification="unknown", home_count=None)
    classification = cast(OwnerClassification, contact.classification)
    return QueueOwnerOut(
        phone=contact.identifier if contact.kind == "phone" else "",
        classification=classification,
        home_count=contact.distinct_property_count_90d if classification == "agent" else None,
    )


def _state_out(
    prop: Property, user: User, check: PropertyCheck | None, now: datetime, assignee_name: str
) -> QueueStateOut:
    if (
        prop.assigned_agent_id is not None
        and prop.assignment_expires_at is not None
        and prop.assignment_expires_at > now
    ):
        if prop.assigned_agent_id == user.id:
            return QueueStateOut(kind="mine", until=prop.assignment_expires_at)
        return QueueStateOut(
            kind="locked", until=prop.assignment_expires_at, agent_name=assignee_name
        )
    return QueueStateOut(kind="retry" if is_retry(check) else "new")


def _last_activity(
    prop: Property, check: PropertyCheck | None, names: dict[uuid.UUID, str]
) -> LastActivityOut:
    if check is None:
        return LastActivityOut(text="Hech kim hali aloqa qilmagan", at=prop.last_seen_at)
    name = names.get(check.agent_id, "") if check.agent_id is not None else ""
    label = OUTCOME_LABEL_UZ.get(check.outcome, check.outcome)
    text = f"{name} — {label}" if name else label
    return LastActivityOut(text=text, at=check.created_at)


async def assemble_items(
    session: AsyncSession,
    props: list[tuple[Property, datetime]],
    user: User,
    now: datetime,
    checks: dict[uuid.UUID, PropertyCheck] | None = None,
) -> list[QueueItemOut]:
    """Turn queue-member property rows into `QueueItemOut`s, batching every follow-up read."""
    if not props:
        return []
    ids = [p.id for p, _ in props]
    if checks is None:
        checks = await latest_checks(session, ids)
    listings_map = await _listings_by_property(session, ids)

    owner_ids = {p.probable_owner_contact_id for p, _ in props if p.probable_owner_contact_id}
    owners: dict[uuid.UUID, Contact] = {}
    if owner_ids:
        owners = {
            c.id: c
            for c in (
                await session.execute(select(Contact).where(Contact.id.in_(owner_ids)))
            ).scalars()
        }

    user_ids: set[uuid.UUID] = set()
    for prop, _ in props:
        if (
            prop.assigned_agent_id is not None
            and prop.assignment_expires_at is not None
            and prop.assignment_expires_at > now
        ):
            user_ids.add(prop.assigned_agent_id)
    for chk in checks.values():
        if chk.agent_id is not None:
            user_ids.add(chk.agent_id)
    names: dict[uuid.UUID, str] = {}
    if user_ids:
        names = {
            u.id: u.name
            for u in (await session.execute(select(User).where(User.id.in_(user_ids)))).scalars()
        }

    items: list[QueueItemOut] = []
    for prop, _due in props:
        check = checks.get(prop.id)
        listings = listings_map.get(prop.id, [])
        best = _best_listing(listings)
        assignee_name = (
            names.get(prop.assigned_agent_id, "") if prop.assigned_agent_id is not None else ""
        )
        owner = (
            owners.get(prop.probable_owner_contact_id) if prop.probable_owner_contact_id else None
        )
        items.append(
            QueueItemOut(
                id=str(prop.id),
                property_id=prop.id,
                district=prop.district,
                sub_area=_sub_area(best.address_text if best else None, prop.district),
                rooms=prop.rooms,
                floor=prop.floor,
                total_floors=prop.total_floors,
                area_sqm=prop.area_sqm,
                price_usd=(prop.price_usd_min_minor // 100) if prop.price_usd_min_minor else 0,
                availability=AvailabilityOut(
                    status=_AVAILABILITY.get(prop.status, "unknown"),
                    at=prop.last_checked_at or prop.last_seen_at,
                ),
                owner=_owner_out(owner),
                last_activity=_last_activity(prop, check, names),
                state=_state_out(prop, user, check, now, assignee_name),
                source=_primary_source(listings),
            )
        )
    return items
