import { api, unwrap, type Schemas } from "@/shared/api";

export type BotChannelKind = "telegram" | "sms";
export type ChannelReadiness = "not_configured" | "ready";

/** «1» → vacant, «2» → taken, free text → unclear, sent but no reply yet → waiting, not sent
 * yet → queued, the send itself failed → error. */
export type OutreachResult = "vacant" | "taken" | "unclear" | "waiting" | "queued" | "error";

export interface ChannelStat {
  channel: BotChannelKind;
  enabled: boolean;
  status: ChannelReadiness;
  sentToday: number;
  /** Hourly send cap; null when the channel has none (SMS). */
  perHour: number | null;
  perDay: number | null;
}

export interface OutreachCounters {
  today: number;
  queued: number;
  replied: number;
  unclear: number;
  errors: number;
}

export interface OutreachRow {
  id: string;
  propertyId: string;
  district: string;
  rooms: number;
  priceUsdMinor: number | null;
  /** "" when the outreach contact isn't phone-kind (or unknown) — see entities/duplicate's
   * DuplicateListingSide.phone for the same convention. */
  phone: string;
  channel: BotChannelKind;
  sentAt: string | null;
  /** The contact's raw reply text — real inbound content, not UI copy. */
  replyText: string | null;
  repliedAt: string | null;
  /** Hours elapsed since sending with still no reply — derived from `sentAt` (mirrors
   * entities/dashboard/api.ts's daysSince), only set while `result` is "waiting". */
  noReplyHours: number | null;
  result: OutreachResult;
}

export interface BotOverview {
  channels: ChannelStat[];
  counters: OutreachCounters;
  rows: OutreachRow[];
}

const HOUR = 60 * 60 * 1000;
const hoursAgo = (n: number): string => new Date(Date.now() - n * HOUR).toISOString();

/**
 * Test fixture only — production reads {@link fetchBot}. Reshaped to the real API's fields: no
 * per-row street/assigned-agent and no per-channel account-phone/quiet-hours/do-not-contact (the
 * backend carries none of those — see the module docstring on backend's outreach/service.py),
 * dropped rather than faked (mirrors entities/duplicate/api.ts's MOCK_PAIRS reshape). Trimmed to
 * exercise the null-price and no-phone-contact gaps a static fixture never needed (o6), plus the
 * "error" status the original mock had no bucket for.
 */
export const MOCK_BOT_OVERVIEW: BotOverview = {
  channels: [
    { channel: "telegram", enabled: false, status: "not_configured", sentToday: 61, perHour: 12, perDay: 100 },
    { channel: "sms", enabled: false, status: "not_configured", sentToday: 35, perHour: null, perDay: 100 },
  ],
  counters: { today: 96, queued: 27, replied: 41, unclear: 3, errors: 2 },
  rows: [
    { id: "o1", propertyId: "pr-o1", district: "chilonzor", rooms: 2, priceUsdMinor: 45000, phone: "+998908112437", channel: "telegram", sentAt: hoursAgo(1), replyText: "1", repliedAt: hoursAgo(0.85), noReplyHours: null, result: "vacant" },
    { id: "o2", propertyId: "pr-o2", district: "yakkasaroy", rooms: 2, priceUsdMinor: 52000, phone: "+998912339014", channel: "sms", sentAt: hoursAgo(3), replyText: "2", repliedAt: hoursAgo(2.75), noReplyHours: null, result: "taken" },
    { id: "o3", propertyId: "pr-o3", district: "olmazor", rooms: 2, priceUsdMinor: 40000, phone: "+998996407721", channel: "telegram", sentAt: hoursAgo(2), replyText: "hozircha bor, lekin 420 ga", repliedAt: hoursAgo(1.5), noReplyHours: null, result: "unclear" },
    { id: "o4", propertyId: "pr-o4", district: "mirobod", rooms: 3, priceUsdMinor: 70000, phone: "+998977156002", channel: "sms", sentAt: hoursAgo(5), replyText: null, repliedAt: null, noReplyHours: 5, result: "waiting" },
    { id: "o5", propertyId: "pr-o5", district: "bektemir", rooms: 1, priceUsdMinor: 25000, phone: "+998905553108", channel: "telegram", sentAt: null, replyText: null, repliedAt: null, noReplyHours: null, result: "queued" },
    { id: "o6", propertyId: "pr-o6", district: "sergeli", rooms: 2, priceUsdMinor: null, phone: "", channel: "sms", sentAt: hoursAgo(1), replyText: null, repliedAt: null, noReplyHours: null, result: "error" },
  ],
};

// ---- real API ----
type ChannelStatOut = Schemas["ChannelStatOut"];
type OutreachItemOut = Schemas["OutreachItemOut"];
type OutreachCountersOut = Schemas["OutreachCountersOut"];

function mapChannel(o: ChannelStatOut): ChannelStat {
  return { channel: o.channel, enabled: o.enabled, status: o.status, sentToday: o.sent_today, perHour: o.per_hour, perDay: o.per_day };
}

/** The API's `answered` (a reply arrived, classified or not) is this screen's `replied`. */
function mapCounters(o: OutreachCountersOut): OutreachCounters {
  return { today: o.today, queued: o.queued, replied: o.answered, unclear: o.unclear, errors: o.errors };
}

/** Hours elapsed since `iso`, floored — mirrors entities/dashboard/api.ts's daysSince. */
function hoursSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / HOUR);
}

/** The API's five-way send `status` plus its `result` (only set once a reply is classified)
 * collapse onto the one bucket the table's badge and cells render off. `sent` and `no_reply`
 * both read as "waiting" — the backend gives no separate field to tell "still within the wait
 * window" from "window elapsed", and the mock's per-row follow-up scheduling has no API
 * equivalent either way (dropped, not faked — see MOCK_BOT_OVERVIEW's comment). */
function mapResult(o: OutreachItemOut): OutreachResult {
  switch (o.status) {
    case "queued": return "queued";
    case "sent":
    case "no_reply": return "waiting";
    case "error": return "error";
    case "answered": return o.result ?? "unclear";
    default: return "unclear";
  }
}

/** The API carries no sub-area/street or assigned-agent field for an outreach row (unlike the
 * original mock) — dropped rather than faked, see entities/duplicate/api.ts's mapSide for the
 * same "render what the API gives" convention. */
function mapItem(o: OutreachItemOut): OutreachRow {
  const result = mapResult(o);
  return {
    id: o.id,
    propertyId: o.property_id,
    district: o.district ?? "",
    rooms: o.rooms ?? 0,
    priceUsdMinor: o.price_usd === null ? null : o.price_usd * 100,
    phone: o.phone ?? "",
    channel: o.channel,
    sentAt: o.sent_at,
    replyText: o.reply_text,
    repliedAt: o.reply_at,
    noReplyHours: result === "waiting" && o.sent_at ? hoursSince(o.sent_at) : null,
    result,
  };
}

export function fetchBot(): Promise<BotOverview> {
  return unwrap(api.GET("/api/v1/bot")).then((o) => ({
    channels: o.channels.map(mapChannel),
    counters: mapCounters(o.counters),
    rows: o.items.map(mapItem),
  }));
}

/** Records the manual "Bo'sh"/"Topshirilgan" classification for a reply `parse_reply` couldn't
 * read automatically; rejects 409 `outreach.not_resolvable` if the message isn't (or is no
 * longer) awaiting one. */
export function resolveOutreachMessage(id: string, result: Extract<OutreachResult, "vacant" | "taken">): Promise<OutreachRow> {
  return unwrap(api.POST("/api/v1/bot/{message_id}/resolve", {
    params: { path: { message_id: id } },
    body: { result },
  })).then(mapItem);
}
