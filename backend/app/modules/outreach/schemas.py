"""Request/response models for the Bot Monitor screen (GET/POST /bot).

Snake_case throughout (like `properties.schemas` / `dashboard.schemas`); the web maps these
to the camelCase its Bot Monitor renders (see web/src/entities/bot/api.ts — channel cards,
counters, table rows). Closed value sets are `Literal`s so they land in the OpenAPI contract
as enums the web generates against. Every value is a real query result: sending is OFF this
milestone, so the honest shape is disabled channels, zero counters and no items.
"""

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel

OutreachChannel = Literal["telegram", "sms"]
# The message lifecycle: `queued` before send, `sent` once out, `answered` when a reply
# arrived, `no_reply` when the wait window elapsed, `error` when the send itself failed.
OutreachStatus = Literal["queued", "sent", "answered", "no_reply", "error"]
# `parse_reply`'s classification of a reply (also the manual resolve choice, minus `unclear`).
ParsedResult = Literal["vacant", "taken", "unclear"]
ResolveResult = Literal["vacant", "taken"]
# `not_configured`: no channel credentials (always, this milestone). `ready`: credentials
# present and sending enabled — emitted once `service.sending_enabled` flips true.
ChannelStatus = Literal["not_configured", "ready"]


class ChannelStatOut(BaseModel):
    channel: OutreachChannel
    enabled: bool  # false until channel credentials + an enable flag exist
    status: ChannelStatus
    sent_today: int  # messages actually sent today on this channel (0 until sending is wired)
    per_hour: int | None  # hourly send cap; null when the channel has none (SMS)
    per_day: int | None  # daily send cap


class OutreachCountersOut(BaseModel):
    today: int  # messages created today
    queued: int  # of today's, still awaiting send
    answered: int  # of today's, a reply arrived
    unclear: int  # of today's, a reply `parse_reply` could not classify
    errors: int  # of today's, the send failed


class OutreachItemOut(BaseModel):
    id: uuid.UUID
    property_id: uuid.UUID  # the linked property (open it from the monitor row)
    district: str | None
    rooms: int | None
    price_usd: int | None  # whole USD (price_usd_min_minor // 100), matching the dashboard
    phone: str | None  # the contact identifier when it is a phone, else null
    channel: OutreachChannel
    status: OutreachStatus
    sent_at: datetime | None
    reply_text: str | None  # the contact's raw inbound reply — real content, not UI copy
    reply_at: datetime | None
    result: ParsedResult | None  # parsed_result; null until a reply is classified


class OutreachMonitorOut(BaseModel):
    channels: list[ChannelStatOut]
    counters: OutreachCountersOut
    items: list[OutreachItemOut]


class ResolveIn(BaseModel):
    result: ResolveResult
