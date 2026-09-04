"""Read + resolve behind the Bot Monitor (GET /bot, POST /bot/{id}/resolve), plus the write
seam the real Telegram/SMS sender will use once wiring lands.

Every number the monitor shows is a real query over `outreach_messages`. Sending is OFF this
milestone (`sending_enabled` returns False and there are no channel credentials), so the
honest result today is disabled channels, zero counters and no items — never a fabricated
figure. `now` is a parameter so tests can freeze it, matching the availability / dashboard
services.
"""

import uuid
from datetime import UTC, datetime
from typing import cast

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.problems import ApiError
from app.core.settings import Settings
from app.modules.contacts.models import Contact
from app.modules.outreach.models import OutreachMessage
from app.modules.outreach.parser import parse_reply
from app.modules.outreach.schemas import (
    ChannelStatOut,
    OutreachChannel,
    OutreachCountersOut,
    OutreachItemOut,
    OutreachMonitorOut,
    OutreachStatus,
    ParsedResult,
    ResolveResult,
)
from app.modules.properties.models import Property

# Outreach channels the monitor shows, in card order (Telegram first, SMS second).
CHANNELS: tuple[OutreachChannel, ...] = ("telegram", "sms")
# Static (per_hour, per_day) send caps, mirroring the Settings mockup channel defaults
# (web/src/entities/setting/api.ts): Telegram is throttled 12/hour and 100/day; SMS goes
# through a provider with a 100/day cap and no hourly limit.
CHANNEL_LIMITS: dict[OutreachChannel, tuple[int | None, int | None]] = {
    "telegram": (12, 100),
    "sms": (None, 100),
}


def sending_enabled(settings: Settings) -> bool:
    # TODO(M1): return True once Telegram/SMS credentials and a team account are configured and
    # an explicit send flag is set. Sending is intentionally OFF this milestone, so the monitor
    # reports every channel disabled / not_configured.
    return False


def record_outbound(
    session: AsyncSession,
    *,
    property_id: uuid.UUID,
    contact_id: uuid.UUID | None,
    channel: OutreachChannel,
    body: str | None,
    now: datetime,
    sent_at: datetime | None = None,
) -> OutreachMessage:
    """Insert one `outreach_messages` row for a message the sender queued (sent_at None) or has
    just sent (sent_at set). TODO(M1-send): the real Telegram/SMS sender calls this once its
    credentials are wired — nothing in this milestone does, so no row is written here today."""
    message = OutreachMessage(
        property_id=property_id,
        contact_id=contact_id,
        channel=channel,
        status="sent" if sent_at is not None else "queued",
        body=body,
        sent_at=sent_at,
        created_at=now,
    )
    session.add(message)
    return message


def record_reply(message: OutreachMessage, reply_text: str, now: datetime) -> OutreachMessage:
    """Attach an inbound reply to a sent message and classify it with `parse_reply`.
    TODO(M1-send): the real reply-ingest path calls this — nothing in this milestone does."""
    message.reply_text = reply_text
    message.reply_at = now
    message.parsed_result = parse_reply(reply_text)
    message.status = "answered"
    return message


def _item_out(message: OutreachMessage, prop: Property, contact: Contact | None) -> OutreachItemOut:
    phone = contact.identifier if contact is not None and contact.kind == "phone" else None
    price_usd = prop.price_usd_min_minor // 100 if prop.price_usd_min_minor is not None else None
    return OutreachItemOut(
        id=message.id,
        property_id=message.property_id,
        district=prop.district,
        rooms=prop.rooms,
        price_usd=price_usd,
        phone=phone,
        channel=cast(OutreachChannel, message.channel),
        status=cast(OutreachStatus, message.status),
        sent_at=message.sent_at,
        reply_text=message.reply_text,
        reply_at=message.reply_at,
        result=cast(ParsedResult | None, message.parsed_result),
    )


async def _channels(session: AsyncSession, today_start: datetime) -> list[ChannelStatOut]:
    sent_by_channel: dict[str, int] = {
        str(channel): int(count)
        for channel, count in (
            await session.execute(
                select(OutreachMessage.channel, func.count())
                .where(OutreachMessage.sent_at >= today_start)
                .group_by(OutreachMessage.channel)
            )
        ).all()
    }
    channels: list[ChannelStatOut] = []
    for channel in CHANNELS:
        per_hour, per_day = CHANNEL_LIMITS[channel]
        # Always disabled / not_configured this milestone: there are no channel credentials.
        # Flips on when `sending_enabled` returns True and the sender lands (see the seam above).
        channels.append(
            ChannelStatOut(
                channel=channel,
                enabled=False,
                status="not_configured",
                sent_today=sent_by_channel.get(channel, 0),
                per_hour=per_hour,
                per_day=per_day,
            )
        )
    return channels


async def _counters(session: AsyncSession, today_start: datetime) -> OutreachCountersOut:
    row = (
        await session.execute(
            select(
                func.count(),
                func.count().filter(OutreachMessage.status == "queued"),
                func.count().filter(OutreachMessage.status == "answered"),
                func.count().filter(OutreachMessage.parsed_result == "unclear"),
                func.count().filter(OutreachMessage.status == "error"),
            ).where(OutreachMessage.created_at >= today_start)
        )
    ).one()
    return OutreachCountersOut(
        today=int(row[0]),
        queued=int(row[1]),
        answered=int(row[2]),
        unclear=int(row[3]),
        errors=int(row[4]),
    )


async def _items(session: AsyncSession, today_start: datetime) -> list[OutreachItemOut]:
    rows = (
        await session.execute(
            select(OutreachMessage, Property, Contact)
            .join(Property, Property.id == OutreachMessage.property_id)
            .outerjoin(Contact, Contact.id == OutreachMessage.contact_id)
            .where(OutreachMessage.created_at >= today_start)
            .order_by(OutreachMessage.created_at.desc(), OutreachMessage.id)
        )
    ).all()
    return [_item_out(message, prop, contact) for message, prop, contact in rows]


async def outreach_monitor(session: AsyncSession, now: datetime) -> OutreachMonitorOut:
    """The whole Bot Monitor payload from real data: channel cards, today's counters, and
    today's outreach rows. Empty/zero today because nothing has been sent — that is correct."""
    today_start = datetime(now.year, now.month, now.day, tzinfo=UTC)
    return OutreachMonitorOut(
        channels=await _channels(session, today_start),
        counters=await _counters(session, today_start),
        items=await _items(session, today_start),
    )


async def resolve_unclear(
    session: AsyncSession, message_id: uuid.UUID, result: ResolveResult, now: datetime
) -> OutreachItemOut:
    """Set the parsed result for a reply the parser marked `unclear` (the manual
    "Bo'sh"/"Topshirilgan" buttons). 404 if unknown; 409 if not awaiting resolution.

    `now` is accepted for signature symmetry with the other services (and a future
    resolved-at); the manual choice itself carries no timestamp today.
    """
    message = await session.get(OutreachMessage, message_id)
    if message is None:
        raise ApiError(404, "not_found", "outreach message not found")
    if message.parsed_result != "unclear":
        raise ApiError(
            409, "outreach.not_resolvable", "message is not awaiting manual classification"
        )
    message.parsed_result = result
    await session.flush()
    prop = await session.get(Property, message.property_id)
    if prop is None:  # FK CASCADE guarantees a property; guard the `-O` path anyway.
        raise RuntimeError(f"outreach message {message_id} has no property")
    contact = (
        await session.get(Contact, message.contact_id) if message.contact_id is not None else None
    )
    return _item_out(message, prop, contact)
